/**
 * ATR-Based Trailing Stop Manager
 * Phase 1 Risk Improvement: Dynamic trailing stops based on market volatility
 *
 * Implements:
 * - Chandelier Exit (ATR-based trailing from swing highs/lows)
 * - Parabolic SAR style acceleration
 * - Standard ATR trailing stop
 */

import * as db from '../../database.js'

// Trailing stop algorithms
export const TrailingStopAlgorithm = {
  FIXED: 'FIXED',           // Original fixed pip trailing
  ATR: 'ATR',               // ATR-based trailing
  CHANDELIER: 'CHANDELIER', // Chandelier Exit
  PARABOLIC: 'PARABOLIC'    // Parabolic SAR style
}

// Default configuration
export const DEFAULT_TRAILING_CONFIG = {
  algorithm: TrailingStopAlgorithm.ATR,
  atrPeriod: 14,
  atrMultiplier: 2.5,        // 2.5 ATR for trailing stop distance
  chandelierMultiplier: 3.0, // 3 ATR for Chandelier Exit
  parabolicStep: 0.02,       // SAR acceleration factor
  parabolicMax: 0.2,         // Max SAR acceleration
  activationThreshold: 1.0,  // Activate after 1R profit (ATR-based)
  minStopDistance: 10,       // Minimum stop distance in pips
  enabled: true
}

/**
 * TrailingStopManager - Manages dynamic trailing stops for all active trades
 */
export class TrailingStopManager {
  constructor() {
    this.config = { ...DEFAULT_TRAILING_CONFIG }
    this.tradeStates = new Map() // Track per-trade trailing state
  }

  /**
   * Initialize with custom configuration
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_TRAILING_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database settings
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      algorithm: settings.trailingStopAlgorithm || this.config.algorithm,
      atrPeriod: settings.trailingStopAtrPeriod || this.config.atrPeriod,
      atrMultiplier: settings.trailingStopAtrMultiplier || this.config.atrMultiplier,
      chandelierMultiplier: settings.chandelierMultiplier || this.config.chandelierMultiplier,
      parabolicStep: settings.parabolicStep || this.config.parabolicStep,
      parabolicMax: settings.parabolicMax || this.config.parabolicMax,
      activationThreshold: settings.trailingActivationThreshold || this.config.activationThreshold,
      minStopDistance: settings.trailingMinStopDistance || this.config.minStopDistance,
      enabled: settings.useAdvancedTrailing !== undefined ? settings.useAdvancedTrailing : this.config.enabled
    }
  }

  /**
   * Calculate ATR for a price series
   * @param {number[]} highs - High prices
   * @param {number[]} lows - Low prices
   * @param {number[]} closes - Close prices
   * @param {number} period - ATR period
   * @returns {number} ATR value
   */
  calculateATR(highs, lows, closes, period = 14) {
    if (closes.length < period + 1) {
      // Fallback: use simple range average
      const ranges = highs.slice(0, period).map((h, i) => h - lows[i])
      return ranges.reduce((sum, r) => sum + r, 0) / ranges.length
    }

    // Calculate True Range
    const trueRanges = []
    for (let i = 1; i < closes.length && i <= period; i++) {
      const high = highs[i] || closes[i]
      const low = lows[i] || closes[i]
      const prevClose = closes[i - 1]

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )
      trueRanges.push(tr)
    }

    // Simple Moving Average of TR (could use EMA for smoother)
    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length
    return atr
  }

  /**
   * Calculate ATR from price history (simplified - assumes close prices only)
   * For forex, we estimate high/low from close volatility
   */
  calculateATRFromCloses(prices, period = 14) {
    if (prices.length < period + 1) {
      // Use recent volatility as proxy
      const returns = []
      for (let i = 1; i < prices.length; i++) {
        returns.push(Math.abs(prices[i] - prices[i - 1]))
      }
      if (returns.length === 0) return 0.001 // Fallback
      return returns.reduce((sum, r) => sum + r, 0) / returns.length * 1.5 // Approximate TR
    }

    // Estimate true range from close-to-close changes
    const trueRanges = []
    for (let i = 1; i <= period && i < prices.length; i++) {
      // Estimate intraday range as ~1.5x close-to-close move
      const change = Math.abs(prices[i] - prices[i - 1])
      trueRanges.push(change * 1.5)
    }

    return trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length
  }

  /**
   * Calculate new trailing stop for a trade
   * @param {Object} trade - Trade object
   * @param {number} currentPrice - Current market price
   * @param {number[]} priceHistory - Recent price history (newest first)
   * @returns {Object} { newStop, reason, activated }
   */
  calculateTrailingStop(trade, currentPrice, priceHistory = []) {
    const config = this.getConfig()

    if (!config.enabled) {
      return { newStop: null, reason: 'Advanced trailing disabled', activated: false }
    }

    const current = parseFloat(currentPrice)
    const entry = parseFloat(trade.entry_price)
    const originalStop = parseFloat(trade.stop_loss)
    const currentStop = parseFloat(trade.trailing_stop || trade.stop_loss)
    const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

    // Calculate ATR
    const atr = priceHistory.length > 0
      ? this.calculateATRFromCloses(priceHistory, config.atrPeriod)
      : Math.abs(entry - originalStop) / 2 // Fallback: use original SL distance

    // Calculate current P/L in ATR units
    const pnlInAtr = trade.direction === 'UP'
      ? (current - entry) / atr
      : (entry - current) / atr

    // Check if trailing should activate
    if (pnlInAtr < config.activationThreshold) {
      return {
        newStop: null,
        reason: `Not activated: ${pnlInAtr.toFixed(2)}R < ${config.activationThreshold}R threshold`,
        activated: false,
        atr,
        pnlInAtr
      }
    }

    // Get or initialize trade state for Parabolic SAR
    let tradeState = this.tradeStates.get(trade.id) || {
      af: config.parabolicStep,
      extremePoint: trade.direction === 'UP' ? entry : entry,
      activated: false
    }

    let newStop = null
    let reason = ''

    switch (config.algorithm) {
      case TrailingStopAlgorithm.ATR: {
        newStop = this.calculateATRStop(trade, current, atr, config)
        reason = `ATR trailing: ${config.atrMultiplier}x ATR (${(atr / pipValue).toFixed(1)} pips)`
        break
      }

      case TrailingStopAlgorithm.CHANDELIER: {
        newStop = this.calculateChandelierStop(trade, current, atr, priceHistory, config)
        reason = `Chandelier: ${config.chandelierMultiplier}x ATR from high/low`
        break
      }

      case TrailingStopAlgorithm.PARABOLIC: {
        const parabolicResult = this.calculateParabolicStop(trade, current, tradeState, config)
        newStop = parabolicResult.stop
        tradeState = parabolicResult.state
        reason = `Parabolic SAR: AF=${tradeState.af.toFixed(3)}`
        break
      }

      default: {
        // Fixed trailing (original behavior)
        const settings = db.getAllSettings()
        const trailingPips = settings.trailingStopPips || 30
        if (trade.direction === 'UP') {
          newStop = current - (trailingPips * pipValue)
        } else {
          newStop = current + (trailingPips * pipValue)
        }
        reason = `Fixed: ${trailingPips} pips`
      }
    }

    // Ensure stop only moves in favorable direction
    if (newStop !== null) {
      if (trade.direction === 'UP') {
        if (newStop <= currentStop) {
          newStop = null
          reason = 'Stop not moved: new stop not better than current'
        }
      } else {
        if (newStop >= currentStop) {
          newStop = null
          reason = 'Stop not moved: new stop not better than current'
        }
      }
    }

    // Enforce minimum stop distance
    if (newStop !== null) {
      const minDistance = config.minStopDistance * pipValue
      const distance = trade.direction === 'UP'
        ? current - newStop
        : newStop - current

      if (distance < minDistance) {
        newStop = trade.direction === 'UP'
          ? current - minDistance
          : current + minDistance
        reason += ` (adjusted to min ${config.minStopDistance} pips)`
      }
    }

    // Update trade state
    tradeState.activated = true
    this.tradeStates.set(trade.id, tradeState)

    return {
      newStop,
      reason,
      activated: true,
      atr,
      atrPips: atr / pipValue,
      pnlInAtr
    }
  }

  /**
   * ATR-based trailing stop
   */
  calculateATRStop(trade, currentPrice, atr, config) {
    const distance = atr * config.atrMultiplier

    if (trade.direction === 'UP') {
      return currentPrice - distance
    } else {
      return currentPrice + distance
    }
  }

  /**
   * Chandelier Exit - trails from highest high (long) or lowest low (short)
   */
  calculateChandelierStop(trade, currentPrice, atr, priceHistory, config) {
    const lookback = Math.min(22, priceHistory.length) // 22-day lookback typical
    const recentPrices = priceHistory.slice(0, lookback)

    const distance = atr * config.chandelierMultiplier

    if (trade.direction === 'UP') {
      // Trail from highest high
      const highestHigh = Math.max(...recentPrices, currentPrice)
      return highestHigh - distance
    } else {
      // Trail from lowest low
      const lowestLow = Math.min(...recentPrices, currentPrice)
      return lowestLow + distance
    }
  }

  /**
   * Parabolic SAR style trailing with acceleration
   */
  calculateParabolicStop(trade, currentPrice, state, config) {
    let { af, extremePoint } = state

    // Update extreme point
    if (trade.direction === 'UP') {
      if (currentPrice > extremePoint) {
        extremePoint = currentPrice
        af = Math.min(af + config.parabolicStep, config.parabolicMax)
      }
    } else {
      if (currentPrice < extremePoint) {
        extremePoint = currentPrice
        af = Math.min(af + config.parabolicStep, config.parabolicMax)
      }
    }

    // Calculate new SAR
    const currentStop = parseFloat(trade.trailing_stop || trade.stop_loss)
    let newStop

    if (trade.direction === 'UP') {
      newStop = currentStop + af * (extremePoint - currentStop)
    } else {
      newStop = currentStop - af * (currentStop - extremePoint)
    }

    return {
      stop: newStop,
      state: { af, extremePoint, activated: true }
    }
  }

  /**
   * Clean up state when trade closes
   */
  removeTrade(tradeId) {
    this.tradeStates.delete(tradeId)
  }

  /**
   * Get trailing stop status for dashboard
   */
  getStatus() {
    const config = this.getConfig()
    return {
      enabled: config.enabled,
      algorithm: config.algorithm,
      atrMultiplier: config.atrMultiplier,
      activationThreshold: config.activationThreshold,
      activeTrades: this.tradeStates.size
    }
  }
}

// Singleton instance
export const trailingStopManager = new TrailingStopManager()
export default trailingStopManager
