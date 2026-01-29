/**
 * Market Regime Detector
 * Phase 2 Risk Improvement: ADX-based trending vs ranging market detection
 *
 * Implements:
 * - ADX (Average Directional Index) calculation
 * - DI+ and DI- (Directional Indicators)
 * - Market regime classification (TRENDING, RANGING, VOLATILE)
 * - Strategy selection based on regime
 */

import * as db from '../../database.js'

// Market regime types
export const MarketRegime = {
  STRONG_TREND: 'STRONG_TREND',     // ADX > 40, clear DI dominance
  TRENDING: 'TRENDING',             // ADX 25-40, one DI dominant
  WEAK_TREND: 'WEAK_TREND',         // ADX 20-25, slight DI separation
  RANGING: 'RANGING',               // ADX < 20, DI lines close
  VOLATILE: 'VOLATILE'              // High ATR but low ADX
}

// Strategy recommendations by regime
export const RegimeStrategy = {
  STRONG_TREND: {
    strategy: 'TREND_FOLLOWING',
    description: 'Strong trend - ride the momentum, wider stops',
    trailingRecommendation: 'ATR',
    stopMultiplier: 2.5,
    confidenceBoost: 15
  },
  TRENDING: {
    strategy: 'TREND_FOLLOWING',
    description: 'Moderate trend - follow direction with caution',
    trailingRecommendation: 'ATR',
    stopMultiplier: 2.0,
    confidenceBoost: 10
  },
  WEAK_TREND: {
    strategy: 'CAUTIOUS',
    description: 'Weak trend - smaller positions, tighter stops',
    trailingRecommendation: 'CHANDELIER',
    stopMultiplier: 1.5,
    confidenceBoost: 0
  },
  RANGING: {
    strategy: 'MEAN_REVERSION',
    description: 'Range-bound - fade extremes, tight targets',
    trailingRecommendation: 'FIXED',
    stopMultiplier: 1.0,
    confidenceBoost: -10
  },
  VOLATILE: {
    strategy: 'AVOID',
    description: 'High volatility without direction - dangerous',
    trailingRecommendation: 'PARABOLIC',
    stopMultiplier: 3.0,
    confidenceBoost: -20
  }
}

// Default configuration
export const DEFAULT_REGIME_CONFIG = {
  adxPeriod: 14,
  strongTrendThreshold: 40,    // ADX > 40 = strong trend
  trendThreshold: 25,          // ADX 25-40 = trending
  weakTrendThreshold: 20,      // ADX 20-25 = weak trend
  diSeparationMin: 5,          // Minimum DI+/DI- separation for trend
  volatilityThreshold: 2.0,    // ATR % threshold for high volatility
  enabled: true,
  blockRangingTrades: false,   // Optionally block trades in ranging markets
  blockVolatileTrades: false   // Optionally block trades in volatile markets
}

/**
 * RegimeDetector - Detects market regime using ADX and directional indicators
 */
export class RegimeDetector {
  constructor() {
    this.config = { ...DEFAULT_REGIME_CONFIG }
    this.regimeCache = new Map() // Cache regime per pair
  }

  /**
   * Configure with custom settings
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_REGIME_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      adxPeriod: settings.adxPeriod || this.config.adxPeriod,
      strongTrendThreshold: settings.strongTrendThreshold || this.config.strongTrendThreshold,
      trendThreshold: settings.trendThreshold || this.config.trendThreshold,
      weakTrendThreshold: settings.weakTrendThreshold || this.config.weakTrendThreshold,
      diSeparationMin: settings.diSeparationMin || this.config.diSeparationMin,
      volatilityThreshold: settings.volatilityThreshold || this.config.volatilityThreshold,
      enabled: settings.regimeDetectionEnabled !== undefined
        ? settings.regimeDetectionEnabled
        : this.config.enabled,
      blockRangingTrades: settings.blockRangingTrades || this.config.blockRangingTrades,
      blockVolatileTrades: settings.blockVolatileTrades || this.config.blockVolatileTrades
    }
  }

  /**
   * Calculate True Range
   */
  calculateTR(high, low, prevClose) {
    return Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
  }

  /**
   * Calculate +DM (Positive Directional Movement)
   */
  calculatePlusDM(high, prevHigh, low, prevLow) {
    const upMove = high - prevHigh
    const downMove = prevLow - low

    if (upMove > downMove && upMove > 0) {
      return upMove
    }
    return 0
  }

  /**
   * Calculate -DM (Negative Directional Movement)
   */
  calculateMinusDM(high, prevHigh, low, prevLow) {
    const upMove = high - prevHigh
    const downMove = prevLow - low

    if (downMove > upMove && downMove > 0) {
      return downMove
    }
    return 0
  }

  /**
   * Smooth using Wilder's smoothing method
   */
  wilderSmooth(values, period) {
    if (values.length < period) {
      return values.reduce((sum, v) => sum + v, 0) / values.length
    }

    // First value is SMA
    let smoothed = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period

    // Subsequent values use Wilder's smoothing
    for (let i = period; i < values.length; i++) {
      smoothed = smoothed - (smoothed / period) + values[i]
    }

    return smoothed
  }

  /**
   * Calculate ADX, +DI, -DI from price data
   * @param {number[]} highs - High prices (newest first)
   * @param {number[]} lows - Low prices (newest first)
   * @param {number[]} closes - Close prices (newest first)
   * @param {number} period - ADX period (default 14)
   * @returns {Object} { adx, plusDI, minusDI, dx }
   */
  calculateADX(highs, lows, closes, period = 14) {
    // Need at least period + 1 data points
    if (closes.length < period + 1) {
      return {
        adx: 25, // Neutral default
        plusDI: 25,
        minusDI: 25,
        dx: 0,
        insufficient: true
      }
    }

    // Reverse arrays to oldest-first for calculation
    const h = [...highs].reverse()
    const l = [...lows].reverse()
    const c = [...closes].reverse()

    // Calculate TR, +DM, -DM for each period
    const trValues = []
    const plusDMValues = []
    const minusDMValues = []

    for (let i = 1; i < c.length; i++) {
      trValues.push(this.calculateTR(h[i], l[i], c[i - 1]))
      plusDMValues.push(this.calculatePlusDM(h[i], h[i - 1], l[i], l[i - 1]))
      minusDMValues.push(this.calculateMinusDM(h[i], h[i - 1], l[i], l[i - 1]))
    }

    // Smooth TR, +DM, -DM
    const smoothedTR = this.wilderSmooth(trValues, period)
    const smoothedPlusDM = this.wilderSmooth(plusDMValues, period)
    const smoothedMinusDM = this.wilderSmooth(minusDMValues, period)

    // Calculate +DI and -DI
    const plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0
    const minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0

    // Calculate DX
    const diSum = plusDI + minusDI
    const dx = diSum > 0 ? Math.abs(plusDI - minusDI) / diSum * 100 : 0

    // Calculate ADX (smoothed DX)
    // For simplicity, we'll use the current DX as ADX
    // In a full implementation, we'd smooth DX over the period
    const adx = dx

    return {
      adx,
      plusDI,
      minusDI,
      dx,
      smoothedTR
    }
  }

  /**
   * Calculate ADX from close prices only (estimates high/low)
   */
  calculateADXFromCloses(prices, period = 14) {
    if (prices.length < period + 2) {
      return {
        adx: 25,
        plusDI: 25,
        minusDI: 25,
        dx: 0,
        insufficient: true
      }
    }

    // Estimate highs and lows from close prices
    // This is an approximation - true OHLC data would be better
    const highs = []
    const lows = []

    for (let i = 0; i < prices.length; i++) {
      // Estimate high/low as ±0.3% of close (typical forex range)
      const volatilityFactor = 0.003
      highs.push(prices[i] * (1 + volatilityFactor))
      lows.push(prices[i] * (1 - volatilityFactor))
    }

    return this.calculateADX(highs, lows, prices, period)
  }

  /**
   * Detect market regime for a currency pair
   * @param {string} pair - Currency pair
   * @param {number[]} priceHistory - Recent price history (newest first)
   * @param {Object} ohlcData - Optional OHLC data { highs, lows, closes }
   * @returns {Object} Regime analysis result
   */
  detectRegime(pair, priceHistory, ohlcData = null) {
    const config = this.getConfig()

    if (!config.enabled) {
      return {
        regime: MarketRegime.TRENDING,
        reason: 'Regime detection disabled',
        strategy: RegimeStrategy.TRENDING,
        enabled: false
      }
    }

    // Calculate ADX
    let adxResult
    if (ohlcData && ohlcData.highs && ohlcData.lows && ohlcData.closes) {
      adxResult = this.calculateADX(
        ohlcData.highs,
        ohlcData.lows,
        ohlcData.closes,
        config.adxPeriod
      )
    } else {
      adxResult = this.calculateADXFromCloses(priceHistory, config.adxPeriod)
    }

    const { adx, plusDI, minusDI, insufficient } = adxResult

    if (insufficient) {
      return {
        regime: MarketRegime.TRENDING,
        reason: 'Insufficient data for ADX calculation',
        adx,
        plusDI,
        minusDI,
        strategy: RegimeStrategy.TRENDING,
        confidence: 50
      }
    }

    // Calculate volatility (ATR as % of price)
    const atrPercent = this.calculateVolatilityPercent(priceHistory)

    // Determine regime
    let regime
    let reason

    // Check for high volatility without direction
    if (atrPercent > config.volatilityThreshold && adx < config.weakTrendThreshold) {
      regime = MarketRegime.VOLATILE
      reason = `High volatility (${atrPercent.toFixed(2)}%) but low ADX (${adx.toFixed(1)})`
    }
    // Strong trend
    else if (adx > config.strongTrendThreshold) {
      regime = MarketRegime.STRONG_TREND
      const direction = plusDI > minusDI ? 'bullish' : 'bearish'
      reason = `Strong ${direction} trend: ADX ${adx.toFixed(1)}, +DI ${plusDI.toFixed(1)}, -DI ${minusDI.toFixed(1)}`
    }
    // Moderate trend
    else if (adx >= config.trendThreshold) {
      regime = MarketRegime.TRENDING
      const direction = plusDI > minusDI ? 'bullish' : 'bearish'
      reason = `Moderate ${direction} trend: ADX ${adx.toFixed(1)}`
    }
    // Weak trend
    else if (adx >= config.weakTrendThreshold) {
      regime = MarketRegime.WEAK_TREND
      reason = `Weak trend: ADX ${adx.toFixed(1)} (DI separation: ${Math.abs(plusDI - minusDI).toFixed(1)})`
    }
    // Ranging
    else {
      regime = MarketRegime.RANGING
      reason = `Range-bound market: ADX ${adx.toFixed(1)} < ${config.weakTrendThreshold}`
    }

    // Get strategy recommendation
    const strategy = RegimeStrategy[regime]

    // Determine trend direction from DI
    const trendDirection = plusDI > minusDI ? 'UP' : 'DOWN'
    const diSeparation = Math.abs(plusDI - minusDI)

    // Cache result
    this.regimeCache.set(pair, {
      regime,
      timestamp: Date.now()
    })

    return {
      pair,
      regime,
      reason,
      adx,
      plusDI,
      minusDI,
      diSeparation,
      trendDirection,
      volatilityPercent: atrPercent,
      strategy,
      shouldTrade: this.shouldTrade(regime, config),
      confidenceAdjustment: strategy.confidenceBoost
    }
  }

  /**
   * Calculate volatility as percentage of price
   */
  calculateVolatilityPercent(prices) {
    if (prices.length < 2) return 1.0

    const returns = []
    for (let i = 0; i < prices.length - 1 && i < 20; i++) {
      returns.push(Math.abs(prices[i] - prices[i + 1]) / prices[i + 1] * 100)
    }

    return returns.reduce((sum, r) => sum + r, 0) / returns.length
  }

  /**
   * Determine if trading should proceed based on regime
   */
  shouldTrade(regime, config) {
    if (regime === MarketRegime.RANGING && config.blockRangingTrades) {
      return { allowed: false, reason: 'Ranging market - trades blocked' }
    }
    if (regime === MarketRegime.VOLATILE && config.blockVolatileTrades) {
      return { allowed: false, reason: 'Volatile market - trades blocked' }
    }
    return { allowed: true }
  }

  /**
   * Adjust prediction confidence based on regime
   */
  adjustConfidence(baseConfidence, regime, predictionDirection) {
    const regimeData = this.regimeCache.get(regime.pair) || regime
    const strategy = RegimeStrategy[regimeData.regime] || RegimeStrategy.TRENDING

    let adjustment = strategy.confidenceBoost

    // Additional adjustment if prediction aligns with trend
    if (regimeData.trendDirection === predictionDirection) {
      if (regimeData.regime === MarketRegime.STRONG_TREND) {
        adjustment += 5 // Bonus for trading with strong trend
      } else if (regimeData.regime === MarketRegime.TRENDING) {
        adjustment += 3
      }
    } else {
      // Penalty for counter-trend trades
      if (regimeData.regime === MarketRegime.STRONG_TREND) {
        adjustment -= 15 // Big penalty for fighting strong trend
      } else if (regimeData.regime === MarketRegime.TRENDING) {
        adjustment -= 8
      }
    }

    return Math.max(10, Math.min(95, baseConfidence + adjustment))
  }

  /**
   * Get regime status for dashboard
   */
  getStatus() {
    const config = this.getConfig()
    const cachedRegimes = {}

    for (const [pair, data] of this.regimeCache.entries()) {
      cachedRegimes[pair] = {
        regime: data.regime,
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      }
    }

    return {
      enabled: config.enabled,
      adxPeriod: config.adxPeriod,
      thresholds: {
        strongTrend: config.strongTrendThreshold,
        trend: config.trendThreshold,
        weakTrend: config.weakTrendThreshold
      },
      blockRangingTrades: config.blockRangingTrades,
      blockVolatileTrades: config.blockVolatileTrades,
      cachedRegimes
    }
  }

  /**
   * Clear regime cache (useful when settings change)
   */
  clearCache() {
    this.regimeCache.clear()
  }
}

// Singleton instance
export const regimeDetector = new RegimeDetector()
export default regimeDetector
