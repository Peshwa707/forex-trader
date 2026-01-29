/**
 * Interactive Brokers Connector
 * Manages IB Gateway/TWS connection lifecycle with auto-reconnect
 */

import { IBApi, EventName } from '@stoqey/ib'
import * as db from '../../database.js'
import { IB_CONFIG, validateMode } from '../../config/ib.config.js'
import { errorHandler } from './IBErrorHandler.js'

// Connection states
export const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR'
}

/**
 * IBConnector - Manages IB API connection
 */
export class IBConnector {
  constructor() {
    this.ib = null
    this.state = ConnectionState.DISCONNECTED
    this.connectionAttempts = 0
    this.lastConnectTime = null
    this.lastDisconnectTime = null
    this.nextOrderId = 0
    this.reconnectTimer = null
    this.listeners = new Map()
    this.tradingMode = IB_CONFIG.mode.current
  }

  /**
   * Connect to IB Gateway/TWS
   */
  async connect(options = {}) {
    const config = {
      host: options.host || IB_CONFIG.connection.host,
      port: options.port || IB_CONFIG.connection.port,
      clientId: options.clientId || IB_CONFIG.connection.clientId
    }

    if (this.state === ConnectionState.CONNECTED) {
      console.log('Already connected to IB')
      return { success: true, alreadyConnected: true }
    }

    if (this.state === ConnectionState.CONNECTING) {
      console.log('Connection already in progress')
      return { success: false, reason: 'Connection in progress' }
    }

    this.setState(ConnectionState.CONNECTING)
    this.connectionAttempts++

    try {
      // Create new IB API instance
      this.ib = new IBApi({
        host: config.host,
        port: config.port,
        clientId: config.clientId
      })

      // Setup event handlers
      this.setupEventHandlers()

      // Connect
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'))
        }, 30000)

        this.ib.once(EventName.connected, () => {
          clearTimeout(timeout)
          resolve()
        })

        this.ib.once(EventName.error, (error) => {
          clearTimeout(timeout)
          reject(error)
        })

        this.ib.connect()
      })

      this.setState(ConnectionState.CONNECTED)
      this.lastConnectTime = new Date()
      this.connectionAttempts = 0

      // Request next valid order ID
      this.ib.reqIds()

      db.logActivity('IB_CONNECTED', `Connected to IB Gateway at ${config.host}:${config.port}`, {
        clientId: config.clientId,
        mode: this.tradingMode
      })

      console.log(`Connected to IB Gateway at ${config.host}:${config.port} (Client ID: ${config.clientId})`)

      return { success: true, mode: this.tradingMode }

    } catch (error) {
      this.setState(ConnectionState.ERROR)
      console.error('Failed to connect to IB:', error.message)

      db.logActivity('IB_CONNECTION_FAILED', error.message, {
        attempt: this.connectionAttempts,
        config
      })

      // Schedule reconnection if enabled
      if (IB_CONFIG.reconnect.enabled) {
        this.scheduleReconnect()
      }

      return { success: false, error: error.message }
    }
  }

  /**
   * Disconnect from IB
   */
  async disconnect() {
    this.cancelReconnect()

    if (!this.ib || this.state === ConnectionState.DISCONNECTED) {
      return { success: true, alreadyDisconnected: true }
    }

    try {
      this.ib.disconnect()
      this.setState(ConnectionState.DISCONNECTED)
      this.lastDisconnectTime = new Date()

      db.logActivity('IB_DISCONNECTED', 'Disconnected from IB Gateway')
      console.log('Disconnected from IB Gateway')

      return { success: true }
    } catch (error) {
      console.error('Error disconnecting from IB:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * Setup IB API event handlers
   */
  setupEventHandlers() {
    if (!this.ib) return

    // Connection events
    this.ib.on(EventName.connected, () => {
      this.setState(ConnectionState.CONNECTED)
      this.emit('connected')
    })

    this.ib.on(EventName.disconnected, () => {
      this.lastDisconnectTime = new Date()
      const previousState = this.state
      this.setState(ConnectionState.DISCONNECTED)
      this.emit('disconnected')

      // Auto-reconnect if enabled and wasn't intentional disconnect
      if (IB_CONFIG.reconnect.enabled && previousState === ConnectionState.CONNECTED) {
        console.log('Connection lost, scheduling reconnection...')
        this.scheduleReconnect()
      }
    })

    // Error handling
    this.ib.on(EventName.error, (error, code, reqId) => {
      const result = errorHandler.handleError(code, error?.message || String(error), reqId)

      if (result.shouldReconnect) {
        this.setState(ConnectionState.ERROR)
        this.scheduleReconnect()
      }

      this.emit('error', { error, code, reqId, ...result })
    })

    // Next valid order ID
    this.ib.on(EventName.nextValidId, (orderId) => {
      this.nextOrderId = orderId
      this.emit('nextOrderId', orderId)
      console.log('Next valid order ID:', orderId)
    })

    // Server time (heartbeat)
    this.ib.on(EventName.currentTime, (time) => {
      this.emit('serverTime', time)
    })

    // Account updates
    this.ib.on(EventName.updateAccountValue, (key, value, currency, accountName) => {
      this.emit('accountUpdate', { key, value, currency, accountName })
    })

    // Position updates
    this.ib.on(EventName.position, (account, contract, pos, avgCost) => {
      this.emit('position', { account, contract, pos, avgCost })
    })

    // Order status
    this.ib.on(EventName.orderStatus, (orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice) => {
      this.emit('orderStatus', {
        orderId, status, filled, remaining, avgFillPrice,
        permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice
      })
    })

    // Order fills (executions)
    this.ib.on(EventName.execDetails, (reqId, contract, execution) => {
      this.emit('execution', { reqId, contract, execution })
    })

    // Market data
    this.ib.on(EventName.tickPrice, (reqId, tickType, price, attribs) => {
      this.emit('tickPrice', { reqId, tickType, price, attribs })
    })

    this.ib.on(EventName.tickSize, (reqId, tickType, size) => {
      this.emit('tickSize', { reqId, tickType, size })
    })
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return // Already scheduled
    }

    if (this.connectionAttempts >= IB_CONFIG.reconnect.maxAttempts) {
      console.error('Max reconnection attempts reached')
      db.logActivity('IB_RECONNECT_FAILED', 'Max reconnection attempts reached', {
        attempts: this.connectionAttempts
      })
      return
    }

    const delay = Math.min(
      IB_CONFIG.reconnect.initialDelayMs * Math.pow(IB_CONFIG.reconnect.backoffMultiplier, this.connectionAttempts),
      IB_CONFIG.reconnect.maxDelayMs
    )

    this.setState(ConnectionState.RECONNECTING)
    console.log(`Scheduling reconnection in ${delay / 1000}s (attempt ${this.connectionAttempts + 1}/${IB_CONFIG.reconnect.maxAttempts})`)

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      console.log('Attempting to reconnect...')
      await this.connect()
    }, delay)
  }

  /**
   * Cancel scheduled reconnection
   */
  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * Set connection state and emit event
   */
  setState(newState) {
    const oldState = this.state
    this.state = newState
    this.emit('stateChange', { oldState, newState })
  }

  /**
   * Get next order ID and increment
   */
  getNextOrderId() {
    return this.nextOrderId++
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      state: this.state,
      isConnected: this.state === ConnectionState.CONNECTED,
      mode: this.tradingMode,
      connectionAttempts: this.connectionAttempts,
      lastConnectTime: this.lastConnectTime?.toISOString(),
      lastDisconnectTime: this.lastDisconnectTime?.toISOString(),
      nextOrderId: this.nextOrderId,
      reconnecting: !!this.reconnectTimer
    }
  }

  /**
   * Set trading mode
   */
  setMode(mode) {
    validateMode(mode)

    const oldMode = this.tradingMode
    this.tradingMode = mode

    // Save to settings
    db.saveSetting('tradingMode', mode)

    db.logActivity('MODE_CHANGED', `Trading mode changed from ${oldMode} to ${mode}`, {
      oldMode,
      newMode: mode
    })

    console.log(`Trading mode changed: ${oldMode} -> ${mode}`)

    return { success: true, mode }
  }

  /**
   * Get IB API instance (for direct access by other services)
   */
  getApi() {
    return this.ib
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.state === ConnectionState.CONNECTED
  }

  /**
   * Request server time (heartbeat)
   */
  requestServerTime() {
    if (this.isConnected()) {
      this.ib.reqCurrentTime()
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
export const ibConnector = new IBConnector()
export default ibConnector
