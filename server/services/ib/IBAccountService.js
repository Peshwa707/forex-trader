/**
 * Interactive Brokers Account Service
 * Manages account information, positions, and P&L from IB
 */

import { EventName } from '@stoqey/ib'
import * as db from '../../database.js'
import { ibConnector } from './IBConnector.js'
import { contractToPair, unitsToLots } from './IBContractResolver.js'

/**
 * IBAccountService - Manages account data from IB
 */
export class IBAccountService {
  constructor() {
    this.accountId = null
    this.accountValues = new Map()    // key_currency -> value
    this.positions = new Map()        // pair -> position data
    this.listeners = new Map()
    this.isSubscribed = false
  }

  /**
   * Initialize account service
   */
  initialize() {
    if (!ibConnector.isConnected()) {
      console.log('IBAccountService: IB not connected, skipping initialization')
      return
    }

    // Setup event handlers
    ibConnector.on('accountUpdate', this.handleAccountUpdate.bind(this))
    ibConnector.on('position', this.handlePosition.bind(this))
    ibConnector.on('disconnected', this.handleDisconnect.bind(this))

    console.log('IBAccountService initialized')
  }

  /**
   * Subscribe to account updates
   */
  subscribe(accountId = '') {
    if (!ibConnector.isConnected()) {
      throw new Error('Not connected to IB')
    }

    this.accountId = accountId
    const ib = ibConnector.getApi()

    // Request account updates
    ib.reqAccountUpdates(true, accountId)

    // Request positions
    ib.reqPositions()

    this.isSubscribed = true

    db.logActivity('ACCOUNT_SUBSCRIBED', `Subscribed to account updates`, { accountId })
    console.log(`Subscribed to account updates for: ${accountId || 'all accounts'}`)

    return { success: true, accountId }
  }

  /**
   * Unsubscribe from account updates
   */
  unsubscribe() {
    if (!ibConnector.isConnected()) {
      return
    }

    const ib = ibConnector.getApi()
    ib.reqAccountUpdates(false, this.accountId || '')
    ib.cancelPositions()

    this.isSubscribed = false
    console.log('Unsubscribed from account updates')
  }

  /**
   * Handle account value updates from IB
   */
  handleAccountUpdate({ key, value, currency, accountName }) {
    if (!this.accountId) {
      this.accountId = accountName
    }

    const fullKey = currency ? `${key}_${currency}` : key
    this.accountValues.set(fullKey, {
      key,
      value,
      currency,
      accountName,
      timestamp: Date.now()
    })

    // Save to database
    db.updateIBAccountValue(accountName, key, value, currency)

    // Notify listeners for important values
    const importantKeys = ['NetLiquidation', 'AvailableFunds', 'BuyingPower', 'UnrealizedPnL', 'RealizedPnL']
    if (importantKeys.includes(key)) {
      this.emit('accountUpdate', { key, value, currency, accountName })
    }
  }

  /**
   * Handle position updates from IB
   */
  handlePosition({ account, contract, pos, avgCost }) {
    // Convert contract to pair
    const pair = contractToPair(contract)
    const lots = unitsToLots(Math.abs(pos))

    const positionData = {
      account,
      pair,
      position: pos,
      lots,
      direction: pos > 0 ? 'LONG' : pos < 0 ? 'SHORT' : 'FLAT',
      avgCost,
      contract,
      timestamp: Date.now()
    }

    this.positions.set(pair, positionData)

    // Save to database
    db.updateIBPosition(account, pair, pos, avgCost)

    // Notify listeners
    this.emit('position', positionData)

    console.log(`Position update: ${pair} ${positionData.direction} ${lots} lots @ ${avgCost}`)
  }

  /**
   * Handle disconnection
   */
  handleDisconnect() {
    this.isSubscribed = false
    console.log('IBAccountService: IB disconnected')
  }

  /**
   * Get account summary
   */
  getAccountSummary() {
    const summary = {
      accountId: this.accountId,
      timestamp: Date.now(),
      values: {}
    }

    for (const [key, data] of this.accountValues) {
      summary.values[key] = data.value
    }

    return summary
  }

  /**
   * Get specific account value
   */
  getValue(key, currency = 'USD') {
    const fullKey = currency ? `${key}_${currency}` : key
    const data = this.accountValues.get(fullKey)
    return data ? data.value : null
  }

  /**
   * Get net liquidation value (account total)
   */
  getNetLiquidation(currency = 'USD') {
    return parseFloat(this.getValue('NetLiquidation', currency)) || 0
  }

  /**
   * Get available funds for trading
   */
  getAvailableFunds(currency = 'USD') {
    return parseFloat(this.getValue('AvailableFunds', currency)) || 0
  }

  /**
   * Get buying power
   */
  getBuyingPower(currency = 'USD') {
    return parseFloat(this.getValue('BuyingPower', currency)) || 0
  }

  /**
   * Get unrealized P&L
   */
  getUnrealizedPnL(currency = 'USD') {
    return parseFloat(this.getValue('UnrealizedPnL', currency)) || 0
  }

  /**
   * Get realized P&L
   */
  getRealizedPnL(currency = 'USD') {
    return parseFloat(this.getValue('RealizedPnL', currency)) || 0
  }

  /**
   * Get all positions
   */
  getAllPositions() {
    const positions = []
    for (const [pair, data] of this.positions) {
      positions.push(data)
    }
    return positions
  }

  /**
   * Get position for a specific pair
   */
  getPosition(pair) {
    return this.positions.get(pair) || null
  }

  /**
   * Check if we have a position in a pair
   */
  hasPosition(pair) {
    const pos = this.positions.get(pair)
    return pos && pos.position !== 0
  }

  /**
   * Get open forex positions only
   */
  getOpenPositions() {
    return this.getAllPositions().filter(p => p.position !== 0)
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isSubscribed: this.isSubscribed,
      accountId: this.accountId,
      positionCount: this.positions.size,
      openPositions: this.getOpenPositions().length,
      netLiquidation: this.getNetLiquidation(),
      availableFunds: this.getAvailableFunds(),
      unrealizedPnL: this.getUnrealizedPnL(),
      lastUpdate: Date.now()
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
export const ibAccountService = new IBAccountService()
export default ibAccountService
