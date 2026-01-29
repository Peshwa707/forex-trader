/**
 * Interactive Brokers Order Service
 * Handles order placement, modification, and cancellation via IB
 */

import { OrderAction, OrderType, TimeInForce } from './ib-loader.js'
import * as db from '../../database.js'
import { ibConnector } from './IBConnector.js'
import { createForexContract, lotsToUnits, getPipValue, formatPrice } from './IBContractResolver.js'
import { IB_CONFIG, getPositionLimits } from '../../config/ib.config.js'

// Slippage and retry configuration
const ORDER_CONFIG = {
  maxSlippagePips: 5,        // Max acceptable slippage in pips
  maxRetryAttempts: 3,       // Max retry attempts for transient errors
  retryDelayMs: 1000,        // Base delay between retries (exponential backoff)
  retryableErrors: [         // Error codes that warrant retry
    'TIMEOUT',
    'CONNECTION_LOST',
    'SERVER_BUSY',
    162,                     // Historical data farm connection restored
    1100,                    // Connectivity lost
    1102,                    // Connectivity restored
    2104,                    // Market data farm connection is OK
    2106,                    // HMDS data farm connection is OK
  ]
}

// Order status mapping
const ORDER_STATUS = {
  PendingSubmit: 'PENDING',
  PendingCancel: 'PENDING_CANCEL',
  PreSubmitted: 'PENDING',
  Submitted: 'SUBMITTED',
  ApiCancelled: 'CANCELLED',
  Cancelled: 'CANCELLED',
  Filled: 'FILLED',
  Inactive: 'INACTIVE'
}

/**
 * IBOrderService - Manages orders via IB
 */
// Order TTL for memory cleanup (24 hours)
const ORDER_TTL_MS = 24 * 60 * 60 * 1000

export class IBOrderService {
  constructor() {
    this.pendingOrders = new Map()  // orderId -> order details
    this.orderCallbacks = new Map() // orderId -> { resolve, reject, timeout }
    this.listeners = new Map()
    this.initialized = false  // Prevent duplicate event listener registration

    // Cleanup stale orders every hour
    this.cleanupInterval = setInterval(() => this.cleanupStaleOrders(), 60 * 60 * 1000)
  }

  /**
   * Cleanup stale orders from memory to prevent memory leak
   */
  cleanupStaleOrders() {
    const now = Date.now()
    let cleaned = 0

    for (const [orderId, order] of this.pendingOrders) {
      const placedAtMs = order.placedAt ? new Date(order.placedAt).getTime() : 0
      const orderAge = placedAtMs ? now - placedAtMs : ORDER_TTL_MS + 1  // Treat missing date as expired
      const isTerminal = ['FILLED', 'CANCELLED', 'ERROR', 'INACTIVE'].includes(order.status)

      // Remove terminal orders older than 1 hour, or any orders older than TTL
      if ((isTerminal && orderAge > 60 * 60 * 1000) || orderAge > ORDER_TTL_MS || isNaN(orderAge)) {
        this.pendingOrders.delete(orderId)
        cleaned++
      }
    }

    if (cleaned > 0) {
      console.log(`[IBOrderService] Cleaned up ${cleaned} stale orders from memory`)
    }
  }

  /**
   * Initialize order service
   */
  initialize() {
    if (!ibConnector.isConnected()) {
      console.log('IBOrderService: IB not connected, skipping initialization')
      return
    }

    // Prevent duplicate event listener registration
    if (this.initialized) {
      console.log('IBOrderService: Already initialized, skipping')
      return
    }

    // Setup event handlers
    ibConnector.on('orderStatus', this.handleOrderStatus.bind(this))
    ibConnector.on('execution', this.handleExecution.bind(this))
    ibConnector.on('error', this.handleError.bind(this))
    ibConnector.on('disconnected', this.handleDisconnect.bind(this))

    this.initialized = true
    console.log('IBOrderService initialized')
  }

  /**
   * Place a market order for a forex pair
   */
  async placeMarketOrder(pair, direction, quantity, localTradeId = null) {
    if (!ibConnector.isConnected()) {
      throw new Error('Not connected to IB')
    }

    // Validate mode and limits
    const mode = db.getSetting('tradingMode') || 'SIMULATION'
    const limits = getPositionLimits(mode)

    if (quantity > limits.maxLots) {
      throw new Error(`Quantity ${quantity} exceeds max ${limits.maxLots} lots for ${mode} mode`)
    }

    // Create contract
    const contract = createForexContract(pair)

    // Create order
    const orderId = ibConnector.getNextOrderId()
    const order = {
      action: direction === 'UP' || direction === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
      orderType: OrderType.MKT,
      totalQuantity: lotsToUnits(quantity),
      tif: TimeInForce.GTC,
      // Forex trades 24h - enable outside regular trading hours
      outsideRth: true,
      // Always transmit immediately (don't hold for bracket attachment)
      transmit: true
    }

    // Store order info
    const orderInfo = {
      orderId,
      pair,
      direction,
      quantity,
      units: order.totalQuantity,
      orderType: 'MKT',
      status: 'PENDING',
      localTradeId,
      placedAt: new Date().toISOString()
    }

    this.pendingOrders.set(orderId, orderInfo)

    // Save to database
    db.createIBOrder({
      ibOrderId: orderId,
      localTradeId,
      pair,
      direction: order.action,
      orderType: 'MKT',
      quantity
    })

    // Place order via IB API
    const ib = ibConnector.getApi()
    ib.placeOrder(orderId, contract, order)

    db.logActivity('IB_ORDER_PLACED', `Placed ${order.action} order for ${pair}`, orderInfo)
    console.log(`Placed order ${orderId}: ${order.action} ${quantity} lots ${pair}`)

    // For paper trading, return immediately after placing order
    // Fill confirmation will be handled asynchronously via callbacks
    // Set up callback for when fill comes through
    const fillPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Don't reject on timeout for paper trading - just log and resolve with pending status
        console.log(`Order ${orderId} timeout - assuming filled at market`)
        this.orderCallbacks.delete(orderId)
        resolve({ ...orderInfo, status: 'ASSUMED_FILLED' })
      }, 5000) // 5 second timeout for paper trading

      this.orderCallbacks.set(orderId, { resolve, reject, timeout, orderInfo })
    })

    // Return immediately with order info, don't wait for fill
    return { ...orderInfo, status: 'SUBMITTED', fillPromise }
  }

  /**
   * Place a limit order
   */
  async placeLimitOrder(pair, direction, quantity, limitPrice, localTradeId = null) {
    if (!ibConnector.isConnected()) {
      throw new Error('Not connected to IB')
    }

    const contract = createForexContract(pair)
    const orderId = ibConnector.getNextOrderId()

    const order = {
      action: direction === 'UP' || direction === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
      orderType: OrderType.LMT,
      totalQuantity: lotsToUnits(quantity),
      lmtPrice: limitPrice,
      tif: TimeInForce.GTC,
      // Forex trades 24h - enable outside regular trading hours
      outsideRth: true,
      // Always transmit immediately
      transmit: true
    }

    const orderInfo = {
      orderId,
      pair,
      direction,
      quantity,
      limitPrice,
      orderType: 'LMT',
      status: 'PENDING',
      localTradeId,
      placedAt: new Date().toISOString()
    }

    this.pendingOrders.set(orderId, orderInfo)

    db.createIBOrder({
      ibOrderId: orderId,
      localTradeId,
      pair,
      direction: order.action,
      orderType: 'LMT',
      quantity,
      limitPrice
    })

    const ib = ibConnector.getApi()
    ib.placeOrder(orderId, contract, order)

    db.logActivity('IB_ORDER_PLACED', `Placed limit order for ${pair} @ ${limitPrice}`, orderInfo)

    return { orderId, ...orderInfo }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId) {
    if (!ibConnector.isConnected()) {
      throw new Error('Not connected to IB')
    }

    const ib = ibConnector.getApi()
    ib.cancelOrder(orderId)

    db.updateIBOrder(orderId, { status: 'PENDING_CANCEL' })
    db.logActivity('IB_ORDER_CANCEL_REQUESTED', `Cancel requested for order ${orderId}`)

    return { orderId, status: 'PENDING_CANCEL' }
  }

  /**
   * Cancel all open orders
   */
  async cancelAllOrders() {
    if (!ibConnector.isConnected()) {
      throw new Error('Not connected to IB')
    }

    const ib = ibConnector.getApi()
    ib.reqGlobalCancel()

    db.logActivity('IB_CANCEL_ALL_ORDERS', 'Requested cancellation of all orders')

    return { success: true, message: 'Cancel all orders requested' }
  }

  /**
   * Handle order status updates from IB
   */
  handleOrderStatus({ orderId, status, filled, remaining, avgFillPrice, permId }) {
    const mappedStatus = ORDER_STATUS[status] || status

    // Update pending order
    const orderInfo = this.pendingOrders.get(orderId)
    if (orderInfo) {
      orderInfo.status = mappedStatus
      orderInfo.filled = filled
      orderInfo.remaining = remaining
      orderInfo.avgFillPrice = avgFillPrice
      orderInfo.permId = permId
    }

    // Update database
    const updates = {
      status: mappedStatus,
      filledQuantity: filled,
      avgFillPrice
    }

    if (mappedStatus === 'FILLED') {
      updates.filledAt = new Date().toISOString()
    } else if (mappedStatus === 'CANCELLED') {
      updates.cancelledAt = new Date().toISOString()
    }

    db.updateIBOrder(orderId, updates)

    // Notify callback if order is filled
    const callback = this.orderCallbacks.get(orderId)
    if (callback && mappedStatus === 'FILLED') {
      clearTimeout(callback.timeout)
      callback.resolve({
        orderId,
        status: mappedStatus,
        filled,
        avgFillPrice,
        permId,
        ...callback.orderInfo
      })
      this.orderCallbacks.delete(orderId)
    } else if (callback && mappedStatus === 'CANCELLED') {
      clearTimeout(callback.timeout)
      callback.reject(new Error(`Order ${orderId} was cancelled`))
      this.orderCallbacks.delete(orderId)
    }

    // Emit event
    this.emit('orderStatus', { orderId, status: mappedStatus, filled, remaining, avgFillPrice })

    // Clean up terminal orders from memory after a short delay
    // (allow any pending listeners to process the status change first)
    if (['FILLED', 'CANCELLED', 'INACTIVE'].includes(mappedStatus)) {
      setTimeout(() => {
        if (this.pendingOrders.get(orderId)?.status === mappedStatus) {
          this.pendingOrders.delete(orderId)
        }
      }, 5000) // 5 second delay before cleanup
    }

    console.log(`Order ${orderId} status: ${mappedStatus} (filled: ${filled}, remaining: ${remaining})`)
  }

  /**
   * Handle execution reports from IB
   */
  handleExecution({ reqId, contract, execution }) {
    const pair = `${contract.symbol}/${contract.currency}`

    const executionInfo = {
      orderId: execution.orderId,
      execId: execution.execId,
      pair,
      side: execution.side,
      shares: execution.shares,
      price: execution.price,
      avgPrice: execution.avgPrice,
      time: execution.time
    }

    db.logActivity('IB_EXECUTION', `Executed ${execution.side} ${execution.shares} ${pair} @ ${execution.price}`, executionInfo)

    // Emit event
    this.emit('execution', executionInfo)

    console.log(`Execution: ${execution.side} ${execution.shares} ${pair} @ ${execution.price}`)
  }

  /**
   * Handle errors related to orders
   */
  handleError({ error, code, reqId }) {
    // IB warning codes that are informational and should NOT reject the order
    // 2109: "Outside Regular Trading Hours" attribute ignored - normal for forex
    // 2104-2106: Market data farm connection messages
    const warningCodes = [2104, 2105, 2106, 2109, 2158]

    if (warningCodes.includes(code)) {
      console.log(`[IB WARNING] [${code}] ${error}`)
      return // Don't reject order for informational warnings
    }

    // Check if this is an order-related error
    const callback = this.orderCallbacks.get(reqId)
    if (callback) {
      clearTimeout(callback.timeout)
      callback.reject(new Error(`Order error [${code}]: ${error}`))
      this.orderCallbacks.delete(reqId)
    }

    // Update order in database if it exists
    const order = this.pendingOrders.get(reqId)
    if (order) {
      db.updateIBOrder(reqId, {
        status: 'ERROR',
        errorMessage: `[${code}] ${error}`
      })
      // Clean up errored order from memory after delay
      setTimeout(() => {
        this.pendingOrders.delete(reqId)
      }, 5000)
    }
  }

  /**
   * Handle disconnection
   */
  handleDisconnect() {
    // Reject all pending order callbacks
    for (const [orderId, callback] of this.orderCallbacks) {
      clearTimeout(callback.timeout)
      callback.reject(new Error('IB disconnected'))
    }
    this.orderCallbacks.clear()

    console.log('IBOrderService: IB disconnected')
  }

  /**
   * Get pending orders
   */
  getPendingOrders() {
    const orders = []
    for (const [orderId, info] of this.pendingOrders) {
      if (info.status === 'PENDING' || info.status === 'SUBMITTED') {
        orders.push(info)
      }
    }
    return orders
  }

  /**
   * Get order by ID
   */
  getOrder(orderId) {
    return this.pendingOrders.get(orderId) || null
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      pendingOrders: this.getPendingOrders().length,
      totalOrders: this.pendingOrders.size
    }
  }

  /**
   * Check if slippage is acceptable
   * @param {string} pair - Currency pair
   * @param {number} expectedPrice - Expected fill price
   * @param {number} actualPrice - Actual fill price
   * @returns {{ acceptable: boolean, slippagePips: number }}
   */
  checkSlippage(pair, expectedPrice, actualPrice) {
    const pipValue = getPipValue(pair)
    const slippagePips = Math.abs(actualPrice - expectedPrice) / pipValue

    const acceptable = slippagePips <= ORDER_CONFIG.maxSlippagePips
    if (!acceptable) {
      console.warn(`Slippage warning for ${pair}: ${slippagePips.toFixed(1)} pips (max: ${ORDER_CONFIG.maxSlippagePips})`)
      db.logActivity('SLIPPAGE_WARNING', `Slippage ${slippagePips.toFixed(1)} pips on ${pair}`, {
        pair,
        expectedPrice,
        actualPrice,
        slippagePips
      })
    }

    return { acceptable, slippagePips }
  }

  /**
   * Check if error is retryable
   * @param {Error|object} error - The error to check
   * @returns {boolean}
   */
  isRetryableError(error) {
    if (!error) return false

    const errorCode = error.code || error.errorCode
    const errorMsg = error.message || String(error)

    // Check if error code is in retryable list
    if (ORDER_CONFIG.retryableErrors.includes(errorCode)) {
      return true
    }

    // Check for retryable error patterns in message
    const retryablePatterns = ['timeout', 'connection', 'network', 'busy', 'temporarily']
    return retryablePatterns.some(pattern =>
      errorMsg.toLowerCase().includes(pattern)
    )
  }

  /**
   * Place market order with retry logic
   * @param {string} pair - Currency pair
   * @param {string} direction - Trade direction
   * @param {number} quantity - Lot size
   * @param {number|null} localTradeId - Local trade ID
   * @param {number} expectedPrice - Expected price for slippage check
   * @param {number} attempt - Current attempt number
   */
  async placeMarketOrderWithRetry(pair, direction, quantity, localTradeId = null, expectedPrice = null, attempt = 1) {
    try {
      const result = await this.placeMarketOrder(pair, direction, quantity, localTradeId)

      // If we have an expected price and fill price, check slippage
      if (expectedPrice && result.avgFillPrice) {
        const slippageCheck = this.checkSlippage(pair, expectedPrice, result.avgFillPrice)
        result.slippageCheck = slippageCheck

        if (!slippageCheck.acceptable) {
          console.warn(`Order ${result.orderId} had excessive slippage: ${slippageCheck.slippagePips.toFixed(1)} pips`)
        }
      }

      return result

    } catch (error) {
      const isRetryable = this.isRetryableError(error)
      const canRetry = attempt < ORDER_CONFIG.maxRetryAttempts

      if (isRetryable && canRetry) {
        const delayMs = ORDER_CONFIG.retryDelayMs * Math.pow(2, attempt - 1) // Exponential backoff
        console.log(`Order failed (attempt ${attempt}/${ORDER_CONFIG.maxRetryAttempts}), retrying in ${delayMs}ms: ${error.message}`)

        db.logActivity('ORDER_RETRY', `Retrying order for ${pair} (attempt ${attempt + 1})`, {
          pair,
          direction,
          quantity,
          attempt,
          error: error.message,
          nextRetryMs: delayMs
        })

        await new Promise(resolve => setTimeout(resolve, delayMs))
        return this.placeMarketOrderWithRetry(pair, direction, quantity, localTradeId, expectedPrice, attempt + 1)
      }

      // Not retryable or max attempts reached
      db.logActivity('ORDER_FAILED', `Order failed after ${attempt} attempts: ${error.message}`, {
        pair,
        direction,
        quantity,
        attempts: attempt,
        error: error.message,
        retryable: isRetryable
      })

      throw error
    }
  }

  /**
   * Place limit order with retry logic
   * Phase C: Better Execution - Limit orders for better fills
   *
   * @param {string} pair - Currency pair
   * @param {string} direction - Trade direction
   * @param {number} quantity - Lot size
   * @param {number} limitPrice - Limit price
   * @param {number|null} localTradeId - Local trade ID
   * @param {number} attempt - Current attempt number
   */
  async placeLimitOrderWithRetry(pair, direction, quantity, limitPrice, localTradeId = null, attempt = 1) {
    try {
      const result = await this.placeLimitOrder(pair, direction, quantity, limitPrice, localTradeId)
      return result

    } catch (error) {
      const isRetryable = this.isRetryableError(error)
      const canRetry = attempt < ORDER_CONFIG.maxRetryAttempts

      if (isRetryable && canRetry) {
        const delayMs = ORDER_CONFIG.retryDelayMs * Math.pow(2, attempt - 1) // Exponential backoff
        console.log(`Limit order failed (attempt ${attempt}/${ORDER_CONFIG.maxRetryAttempts}), retrying in ${delayMs}ms: ${error.message}`)

        db.logActivity('ORDER_RETRY', `Retrying limit order for ${pair} @ ${limitPrice} (attempt ${attempt + 1})`, {
          pair,
          direction,
          quantity,
          limitPrice,
          attempt,
          error: error.message,
          nextRetryMs: delayMs
        })

        await new Promise(resolve => setTimeout(resolve, delayMs))
        return this.placeLimitOrderWithRetry(pair, direction, quantity, limitPrice, localTradeId, attempt + 1)
      }

      // Not retryable or max attempts reached
      db.logActivity('ORDER_FAILED', `Limit order failed after ${attempt} attempts: ${error.message}`, {
        pair,
        direction,
        quantity,
        limitPrice,
        attempts: attempt,
        error: error.message,
        retryable: isRetryable
      })

      throw error
    }
  }

  // Event emitter methods
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add(callback)
    return () => this.off(event, callback)
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.delete(callback)
    }
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in ${event} listener:`, error)
        }
      }
    }
  }
}

// Singleton instance
export const ibOrderService = new IBOrderService()
export default ibOrderService
