/**
 * Interactive Brokers Market Data Service
 * Streams real-time forex prices from IB
 */

import { IBApiTickType } from '@stoqey/ib'
import * as db from '../../database.js'
import { ibConnector } from './IBConnector.js'
import { createForexContract, contractToPair, getSupportedPairs, formatPrice } from './IBContractResolver.js'
import { IB_CONFIG } from '../../config/ib.config.js'

/**
 * IBMarketData - Manages real-time market data subscriptions
 */
export class IBMarketData {
  constructor() {
    this.subscriptions = new Map()  // reqId -> { pair, contract, lastPrice, lastUpdate }
    this.priceListeners = new Set()
    this.nextReqId = 1000           // Start request IDs at 1000 for market data
    this.isStreaming = false

    // Price cache for quick lookup
    this.priceCache = new Map()     // pair -> { bid, ask, last, mid, timestamp }
  }

  /**
   * Initialize market data service
   */
  initialize() {
    if (!ibConnector.isConnected()) {
      console.log('IBMarketData: IB not connected, skipping initialization')
      return
    }

    // Setup event handlers from connector
    ibConnector.on('tickPrice', this.handleTickPrice.bind(this))
    ibConnector.on('tickSize', this.handleTickSize.bind(this))
    ibConnector.on('disconnected', this.handleDisconnect.bind(this))

    console.log('IBMarketData service initialized')
  }

  /**
   * Subscribe to market data for a forex pair
   */
  subscribe(pair) {
    if (!ibConnector.isConnected()) {
      throw new Error('Not connected to IB')
    }

    // Check if already subscribed
    for (const [reqId, sub] of this.subscriptions) {
      if (sub.pair === pair) {
        console.log(`Already subscribed to ${pair} (reqId: ${reqId})`)
        return reqId
      }
    }

    const contract = createForexContract(pair)
    const reqId = this.nextReqId++

    // Store subscription info
    this.subscriptions.set(reqId, {
      pair,
      contract,
      bid: null,
      ask: null,
      last: null,
      bidSize: null,
      askSize: null,
      lastUpdate: null
    })

    // Request market data from IB
    const ib = ibConnector.getApi()
    ib.reqMktData(
      reqId,
      contract,
      IB_CONFIG.marketData.genericTickList,
      IB_CONFIG.marketData.snapshot,
      IB_CONFIG.marketData.regulatorySnapshot
    )

    console.log(`Subscribed to ${pair} market data (reqId: ${reqId})`)

    db.logActivity('MARKET_DATA_SUBSCRIBED', `Subscribed to ${pair}`, { reqId, pair })

    return reqId
  }

  /**
   * Subscribe to all supported forex pairs
   */
  subscribeAll() {
    const pairs = getSupportedPairs()
    const reqIds = []

    for (const pair of pairs) {
      try {
        const reqId = this.subscribe(pair)
        reqIds.push({ pair, reqId })
      } catch (error) {
        console.error(`Failed to subscribe to ${pair}:`, error.message)
      }
    }

    this.isStreaming = true
    return reqIds
  }

  /**
   * Unsubscribe from market data
   */
  unsubscribe(reqId) {
    const sub = this.subscriptions.get(reqId)
    if (!sub) {
      return false
    }

    if (ibConnector.isConnected()) {
      const ib = ibConnector.getApi()
      ib.cancelMktData(reqId)
    }

    this.subscriptions.delete(reqId)
    console.log(`Unsubscribed from ${sub.pair} market data (reqId: ${reqId})`)

    db.logActivity('MARKET_DATA_UNSUBSCRIBED', `Unsubscribed from ${sub.pair}`, { reqId })

    return true
  }

  /**
   * Unsubscribe from all market data
   */
  unsubscribeAll() {
    for (const reqId of this.subscriptions.keys()) {
      this.unsubscribe(reqId)
    }
    this.isStreaming = false
    this.priceCache.clear()
  }

  /**
   * Handle tick price updates from IB
   */
  handleTickPrice({ reqId, tickType, price, attribs }) {
    const sub = this.subscriptions.get(reqId)
    if (!sub || price <= 0) return

    // Update subscription data based on tick type
    switch (tickType) {
      case IBApiTickType.BID:
        sub.bid = price
        break
      case IBApiTickType.ASK:
        sub.ask = price
        break
      case IBApiTickType.LAST:
        sub.last = price
        break
      case IBApiTickType.CLOSE:
        sub.close = price
        break
    }

    sub.lastUpdate = Date.now()

    // Calculate mid price
    const mid = sub.bid && sub.ask ? (sub.bid + sub.ask) / 2 : sub.last || sub.bid || sub.ask

    // Update price cache
    this.priceCache.set(sub.pair, {
      bid: sub.bid,
      ask: sub.ask,
      last: sub.last,
      mid,
      spread: sub.bid && sub.ask ? sub.ask - sub.bid : null,
      timestamp: sub.lastUpdate
    })

    // Notify listeners
    this.notifyPriceUpdate(sub.pair, {
      pair: sub.pair,
      bid: sub.bid,
      ask: sub.ask,
      last: sub.last,
      mid,
      timestamp: sub.lastUpdate
    })
  }

  /**
   * Handle tick size updates from IB
   */
  handleTickSize({ reqId, tickType, size }) {
    const sub = this.subscriptions.get(reqId)
    if (!sub) return

    switch (tickType) {
      case IBApiTickType.BID_SIZE:
        sub.bidSize = size
        break
      case IBApiTickType.ASK_SIZE:
        sub.askSize = size
        break
    }
  }

  /**
   * Handle disconnection
   */
  handleDisconnect() {
    console.log('IBMarketData: IB disconnected, clearing subscriptions')
    this.subscriptions.clear()
    this.isStreaming = false
  }

  /**
   * Get current price for a pair
   */
  getPrice(pair) {
    return this.priceCache.get(pair) || null
  }

  /**
   * Alias for getPrice - backwards compatibility
   * @param {string} pair - Currency pair
   * @returns {Object|null} Price data with bid, ask, etc.
   */
  getQuote(pair) {
    return this.getPrice(pair)
  }

  /**
   * Get all current prices
   */
  getAllPrices() {
    const prices = {}
    for (const [pair, data] of this.priceCache) {
      prices[pair] = data
    }
    return prices
  }

  /**
   * Get prices in the format expected by the trading bot
   */
  getRatesForBot() {
    const rates = []

    for (const [pair, data] of this.priceCache) {
      if (data.mid) {
        rates.push({
          pair,
          rate: parseFloat(formatPrice(pair, data.mid)),
          bid: data.bid,
          ask: data.ask,
          spread: data.spread,
          change: 0, // Would need historical data for this
          timestamp: data.timestamp,
          source: 'IB'
        })
      }
    }

    return rates
  }

  /**
   * Get price map for quick lookups (pair -> mid price)
   */
  getPriceMap() {
    const map = {}
    for (const [pair, data] of this.priceCache) {
      if (data.mid) {
        map[pair] = data.mid
      }
    }
    return map
  }

  /**
   * Add price update listener
   */
  onPriceUpdate(callback) {
    this.priceListeners.add(callback)
    return () => this.priceListeners.delete(callback)
  }

  /**
   * Notify all price listeners
   */
  notifyPriceUpdate(pair, priceData) {
    for (const listener of this.priceListeners) {
      try {
        listener(pair, priceData)
      } catch (error) {
        console.error('Error in price listener:', error)
      }
    }
  }

  /**
   * Get subscription status
   */
  getStatus() {
    const subscriptions = []

    for (const [reqId, sub] of this.subscriptions) {
      subscriptions.push({
        reqId,
        pair: sub.pair,
        bid: sub.bid,
        ask: sub.ask,
        last: sub.last,
        lastUpdate: sub.lastUpdate ? new Date(sub.lastUpdate).toISOString() : null
      })
    }

    return {
      isStreaming: this.isStreaming,
      subscriptionCount: this.subscriptions.size,
      subscriptions,
      cachedPairs: Array.from(this.priceCache.keys())
    }
  }

  /**
   * Check if we have recent data for a pair
   */
  hasRecentData(pair, maxAgeMs = 60000) {
    const data = this.priceCache.get(pair)
    if (!data || !data.timestamp) return false
    return Date.now() - data.timestamp < maxAgeMs
  }

  /**
   * Check if all pairs have recent data
   */
  hasAllRecentData(pairs = null, maxAgeMs = 60000) {
    const pairsToCheck = pairs || getSupportedPairs()
    return pairsToCheck.every(pair => this.hasRecentData(pair, maxAgeMs))
  }
}

// Singleton instance
export const ibMarketData = new IBMarketData()
export default ibMarketData
