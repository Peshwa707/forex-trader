/**
 * Volatility-Adjusted Position Sizing
 * Phase 1 Risk Improvement: Dynamic position sizing based on market conditions
 *
 * Implements:
 * - Volatility-adjusted sizing (reduce size in high volatility)
 * - Kelly Criterion (optional, capped)
 * - Fixed Fractional (base method)
 * - Risk Parity (equal risk across trades)
 */

import * as db from '../../database.js'

// Position sizing methods
export const SizingMethod = {
  FIXED_FRACTIONAL: 'FIXED_FRACTIONAL',   // Original: fixed % risk
  VOLATILITY_ADJUSTED: 'VOLATILITY_ADJUSTED', // Adjust for volatility
  KELLY: 'KELLY',                          // Kelly Criterion (capped)
  RISK_PARITY: 'RISK_PARITY'              // Equal volatility contribution
}

// Default configuration
export const DEFAULT_SIZING_CONFIG = {
  method: SizingMethod.VOLATILITY_ADJUSTED,
  baseRiskPercent: 1.0,           // Base risk per trade
  maxRiskPercent: 2.0,            // Max risk even in low vol
  minRiskPercent: 0.25,           // Min risk even in high vol
  volatilityLookback: 20,         // Days for volatility calc
  volatilityTargetPercent: 1.0,   // Target daily volatility
  kellyFraction: 0.25,            // Use 25% of Kelly (quarter Kelly)
  atrPeriod: 14,
  enabled: true
}

/**
 * PositionSizer - Calculates optimal position sizes based on volatility
 */
export class PositionSizer {
  constructor() {
    this.config = { ...DEFAULT_SIZING_CONFIG }
    this.volatilityCache = new Map() // Cache volatility per pair
    this.performanceStats = null     // For Kelly calculation
  }

  /**
   * Configure with custom settings
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_SIZING_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      method: settings.positionSizingMethod || this.config.method,
      baseRiskPercent: settings.riskPerTrade || this.config.baseRiskPercent,
      maxRiskPercent: settings.maxRiskPerTrade || this.config.maxRiskPercent,
      minRiskPercent: settings.minRiskPerTrade || this.config.minRiskPercent,
      volatilityLookback: settings.volatilityLookback || this.config.volatilityLookback,
      volatilityTargetPercent: settings.volatilityTarget || this.config.volatilityTargetPercent,
      kellyFraction: settings.kellyFraction || this.config.kellyFraction,
      atrPeriod: settings.atrPeriod || this.config.atrPeriod,
      enabled: settings.useVolatilitySizing !== undefined ? settings.useVolatilitySizing : this.config.enabled
    }
  }

  /**
   * Calculate historical volatility from price series
   * @param {number[]} prices - Price history (newest first)
   * @param {number} lookback - Number of periods
   * @returns {number} Annualized volatility as decimal
   */
  calculateVolatility(prices, lookback = 20) {
    if (prices.length < lookback + 1) {
      return 0.01 // Default 1% if not enough data
    }

    // Calculate daily returns
    const returns = []
    for (let i = 0; i < lookback && i < prices.length - 1; i++) {
      const dailyReturn = (prices[i] - prices[i + 1]) / prices[i + 1]
      returns.push(dailyReturn)
    }

    // Standard deviation of returns
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2))
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / returns.length
    const dailyStdDev = Math.sqrt(variance)

    // Annualize (forex trades ~252 days)
    const annualizedVol = dailyStdDev * Math.sqrt(252)

    return annualizedVol
  }

  /**
   * Calculate ATR-based volatility
   */
  calculateATRVolatility(prices, atrPeriod = 14) {
    if (prices.length < atrPeriod + 1) {
      return 0.001
    }

    // Estimate true ranges from close prices
    const trueRanges = []
    for (let i = 0; i < atrPeriod && i < prices.length - 1; i++) {
      const change = Math.abs(prices[i] - prices[i + 1])
      trueRanges.push(change * 1.5) // Estimate TR
    }

    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length
    const currentPrice = prices[0]

    // Return ATR as percentage of price
    return atr / currentPrice
  }

  /**
   * Calculate Kelly Criterion position size
   * Kelly % = (Win Rate × Avg Win) - (Loss Rate × Avg Loss) / Avg Win
   */
  calculateKellyFraction() {
    // Load performance stats from database
    const closedTrades = db.getClosedTrades(100) // Last 100 trades

    if (closedTrades.length < 20) {
      return this.config.kellyFraction // Not enough data, use default
    }

    const wins = closedTrades.filter(t => t.pnl > 0)
    const losses = closedTrades.filter(t => t.pnl < 0)

    if (wins.length === 0 || losses.length === 0) {
      return this.config.kellyFraction
    }

    const winRate = wins.length / closedTrades.length
    const lossRate = 1 - winRate
    const avgWin = wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length
    const avgLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length)

    // Kelly formula
    const kellyPercent = (winRate - (lossRate / (avgWin / avgLoss)))

    // Cap at configured fraction of full Kelly (typically 25%)
    const cappedKelly = Math.max(0, Math.min(kellyPercent * this.config.kellyFraction, this.config.maxRiskPercent / 100))

    return cappedKelly
  }

  /**
   * Calculate position size for a trade
   * @param {Object} params
   * @param {number} params.accountBalance - Account balance
   * @param {number} params.stopLossPips - Stop loss distance in pips
   * @param {string} params.pair - Currency pair
   * @param {number[]} params.priceHistory - Recent price history
   * @param {Object} params.settings - Trading settings
   * @returns {Object} { lots, riskPercent, method, reason }
   */
  calculatePositionSize({
    accountBalance,
    stopLossPips,
    pair,
    priceHistory = [],
    settings = {}
  }) {
    // Validate balance before calculating position size
    if (!accountBalance || accountBalance <= 0) {
      console.warn('[PositionSizer] Invalid account balance:', accountBalance)
      return {
        lots: 0,
        riskPercent: 0,
        riskAmount: 0,
        method: 'REJECTED',
        reason: 'Invalid or zero account balance',
        stopLossPips
      }
    }

    // Validate stop loss distance
    if (!stopLossPips || stopLossPips <= 0) {
      console.warn('[PositionSizer] Invalid stop loss pips:', stopLossPips)
      return {
        lots: 0,
        riskPercent: 0,
        riskAmount: 0,
        method: 'REJECTED',
        reason: 'Invalid or zero stop loss distance',
        stopLossPips
      }
    }

    const config = this.getConfig()

    // Calculate base position using fixed fractional
    const pipValuePerLot = pair.includes('JPY') ? 1000 : 10
    let riskPercent = config.baseRiskPercent

    if (!config.enabled) {
      // Use simple fixed fractional
      const riskAmount = accountBalance * (riskPercent / 100)
      let lots = riskAmount / (stopLossPips * pipValuePerLot)

      return {
        lots: this.constrainLots(lots, accountBalance, settings),
        riskPercent,
        method: 'FIXED_FRACTIONAL',
        reason: 'Volatility sizing disabled'
      }
    }

    let method = config.method
    let reason = ''

    switch (method) {
      case SizingMethod.VOLATILITY_ADJUSTED: {
        const volResult = this.calculateVolatilityAdjustedRisk(priceHistory, config)
        riskPercent = volResult.riskPercent
        reason = volResult.reason
        break
      }

      case SizingMethod.KELLY: {
        const kellyFraction = this.calculateKellyFraction()
        riskPercent = kellyFraction * 100
        reason = `Kelly: ${(kellyFraction * 100).toFixed(2)}% (${this.config.kellyFraction * 100}% of full)`
        break
      }

      case SizingMethod.RISK_PARITY: {
        const rpResult = this.calculateRiskParitySize(priceHistory, accountBalance, config)
        riskPercent = rpResult.riskPercent
        reason = rpResult.reason
        break
      }

      default:
        reason = `Fixed: ${riskPercent}%`
    }

    // Ensure within bounds
    riskPercent = Math.max(config.minRiskPercent, Math.min(config.maxRiskPercent, riskPercent))

    // Calculate lots
    const riskAmount = accountBalance * (riskPercent / 100)
    let lots = riskAmount / (stopLossPips * pipValuePerLot)

    // Apply Shariah leverage constraint if enabled
    lots = this.constrainLots(lots, accountBalance, settings)

    return {
      lots,
      riskPercent,
      riskAmount: riskAmount,
      method,
      reason,
      stopLossPips
    }
  }

  /**
   * Calculate volatility-adjusted risk percentage
   */
  calculateVolatilityAdjustedRisk(priceHistory, config) {
    const currentVol = this.calculateATRVolatility(priceHistory, config.atrPeriod)
    const targetVol = config.volatilityTargetPercent / 100

    // Volatility ratio: if current vol > target, reduce position
    const volRatio = targetVol / Math.max(currentVol, 0.001)

    // Scale risk by volatility ratio
    let adjustedRisk = config.baseRiskPercent * Math.min(2, Math.max(0.25, volRatio))

    const reason = currentVol > targetVol
      ? `Vol-adjusted: ${(currentVol * 100).toFixed(2)}% > ${(targetVol * 100).toFixed(2)}% target → reduced to ${adjustedRisk.toFixed(2)}%`
      : `Vol-adjusted: ${(currentVol * 100).toFixed(2)}% < ${(targetVol * 100).toFixed(2)}% target → ${adjustedRisk.toFixed(2)}%`

    return {
      riskPercent: adjustedRisk,
      currentVolatility: currentVol,
      targetVolatility: targetVol,
      volRatio,
      reason
    }
  }

  /**
   * Calculate risk parity position size
   * Each position should contribute equal volatility to portfolio
   */
  calculateRiskParitySize(priceHistory, _accountBalance, config) {
    const maxConcurrent = config.maxConcurrentTrades || 6

    // Target volatility per position
    const totalRiskBudget = config.baseRiskPercent
    const perPositionRisk = totalRiskBudget / maxConcurrent

    // Adjust for current volatility
    const currentVol = this.calculateATRVolatility(priceHistory, config.atrPeriod)
    const avgVol = 0.01 // Assume 1% average vol for forex

    const volAdjustedRisk = perPositionRisk * (avgVol / Math.max(currentVol, 0.001))

    return {
      riskPercent: Math.max(config.minRiskPercent, Math.min(config.maxRiskPercent, volAdjustedRisk)),
      reason: `Risk parity: ${perPositionRisk.toFixed(2)}% base × vol adj → ${volAdjustedRisk.toFixed(2)}%`
    }
  }

  /**
   * Constrain lots based on leverage limits
   */
  constrainLots(lots, accountBalance, settings) {
    // Shariah compliance: Enforce max leverage
    if (settings.shariahCompliant) {
      const maxLeverage = settings.shariahMaxLeverage || 5
      const standardLotValue = 100000
      const maxPositionValue = accountBalance * maxLeverage
      const maxLots = maxPositionValue / standardLotValue

      if (lots > maxLots) {
        lots = maxLots
      }
    }

    // General constraints
    lots = Math.min(Math.max(0.01, parseFloat(lots.toFixed(2))), 1)

    return lots
  }

  /**
   * Get sizing status for dashboard
   */
  getStatus() {
    const config = this.getConfig()
    return {
      enabled: config.enabled,
      method: config.method,
      baseRiskPercent: config.baseRiskPercent,
      minRiskPercent: config.minRiskPercent,
      maxRiskPercent: config.maxRiskPercent,
      volatilityTarget: config.volatilityTargetPercent
    }
  }
}

// Singleton instance
export const positionSizer = new PositionSizer()
export default positionSizer
