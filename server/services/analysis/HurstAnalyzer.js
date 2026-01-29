/**
 * Hurst Exponent Analyzer
 * Phase 3 Risk Improvement: Detect trending vs mean-reverting market behavior
 *
 * Implements:
 * - Rescaled Range (R/S) analysis for Hurst exponent
 * - Market character classification (trending/random/mean-reverting)
 * - Strategy recommendations based on Hurst value
 *
 * Hurst Exponent Interpretation:
 * - H > 0.5: Trending (persistent) - use trend-following strategies
 * - H = 0.5: Random walk - no edge
 * - H < 0.5: Mean-reverting (anti-persistent) - use mean reversion strategies
 */

import * as db from '../../database.js'

// Market character based on Hurst exponent
export const MarketCharacter = {
  STRONG_TREND: 'STRONG_TREND',       // H > 0.65
  TRENDING: 'TRENDING',               // H 0.55-0.65
  RANDOM: 'RANDOM',                   // H 0.45-0.55
  MEAN_REVERTING: 'MEAN_REVERTING',   // H 0.35-0.45
  STRONG_MEAN_REVERT: 'STRONG_MEAN_REVERT' // H < 0.35
}

// Strategy recommendations by market character
export const CharacterStrategy = {
  STRONG_TREND: {
    strategy: 'AGGRESSIVE_TREND',
    description: 'Strong persistence - aggressive trend following',
    confidenceBoost: 15,
    recommendedApproach: 'Follow breakouts, use wide trailing stops'
  },
  TRENDING: {
    strategy: 'TREND_FOLLOWING',
    description: 'Moderate persistence - standard trend following',
    confidenceBoost: 10,
    recommendedApproach: 'Follow trends with normal position sizing'
  },
  RANDOM: {
    strategy: 'NEUTRAL',
    description: 'Random walk - no statistical edge',
    confidenceBoost: -5,
    recommendedApproach: 'Reduce position size or skip'
  },
  MEAN_REVERTING: {
    strategy: 'MEAN_REVERSION',
    description: 'Anti-persistent - fade extremes',
    confidenceBoost: 10,
    recommendedApproach: 'Trade against extremes, tight targets'
  },
  STRONG_MEAN_REVERT: {
    strategy: 'AGGRESSIVE_REVERSION',
    description: 'Strong anti-persistence - aggressive mean reversion',
    confidenceBoost: 15,
    recommendedApproach: 'Fade all moves aggressively'
  }
}

// Default configuration
export const DEFAULT_HURST_CONFIG = {
  enabled: false,                     // Disabled by default for safety
  minDataPoints: 50,                  // Minimum prices for calculation
  defaultLookback: 100,               // Default lookback period
  strongTrendThreshold: 0.65,         // H > 0.65 = strong trend
  trendThreshold: 0.55,               // H > 0.55 = trending
  randomUpperThreshold: 0.55,         // H < 0.55 = not clearly trending
  randomLowerThreshold: 0.45,         // H > 0.45 = not clearly reverting
  meanRevertThreshold: 0.35,          // H < 0.35 = strong mean reversion
  adjustConfidenceByHurst: true,      // Apply confidence adjustments
  blockRandomTrades: false            // Optionally block trades in random markets
}

/**
 * HurstAnalyzer - Calculates Hurst exponent and classifies market character
 */
export class HurstAnalyzer {
  constructor() {
    this.config = { ...DEFAULT_HURST_CONFIG }
    this.hurstCache = new Map() // Cache Hurst values per pair
  }

  /**
   * Configure with custom settings
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_HURST_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      enabled: settings.hurstEnabled !== undefined
        ? settings.hurstEnabled
        : this.config.enabled,
      minDataPoints: settings.hurstMinDataPoints || this.config.minDataPoints,
      defaultLookback: settings.hurstLookback || this.config.defaultLookback,
      strongTrendThreshold: settings.hurstStrongTrendThreshold || this.config.strongTrendThreshold,
      trendThreshold: settings.hurstTrendThreshold || this.config.trendThreshold,
      randomUpperThreshold: settings.hurstRandomUpperThreshold || this.config.randomUpperThreshold,
      randomLowerThreshold: settings.hurstRandomLowerThreshold || this.config.randomLowerThreshold,
      meanRevertThreshold: settings.hurstMeanRevertThreshold || this.config.meanRevertThreshold,
      adjustConfidenceByHurst: settings.hurstAdjustConfidence !== undefined
        ? settings.hurstAdjustConfidence
        : this.config.adjustConfidenceByHurst,
      blockRandomTrades: settings.hurstBlockRandom || this.config.blockRandomTrades
    }
  }

  /**
   * Calculate log returns from price series
   */
  calculateLogReturns(prices) {
    const returns = []
    for (let i = 0; i < prices.length - 1; i++) {
      if (prices[i + 1] > 0 && prices[i] > 0) {
        returns.push(Math.log(prices[i] / prices[i + 1]))
      }
    }
    return returns
  }

  /**
   * Calculate mean of array
   */
  mean(arr) {
    if (arr.length === 0) return 0
    return arr.reduce((sum, v) => sum + v, 0) / arr.length
  }

  /**
   * Calculate standard deviation
   */
  standardDeviation(arr) {
    if (arr.length < 2) return 0
    const avg = this.mean(arr)
    const squaredDiffs = arr.map(v => Math.pow(v - avg, 2))
    return Math.sqrt(squaredDiffs.reduce((sum, d) => sum + d, 0) / arr.length)
  }

  /**
   * Calculate cumulative deviation from mean
   */
  cumulativeDeviation(arr) {
    const avg = this.mean(arr)
    let cumSum = 0
    const cumDevs = []

    for (const value of arr) {
      cumSum += (value - avg)
      cumDevs.push(cumSum)
    }

    return cumDevs
  }

  /**
   * Calculate Rescaled Range (R/S) for a given series
   */
  calculateRS(series) {
    if (series.length < 2) return 0

    const cumDev = this.cumulativeDeviation(series)
    const range = Math.max(...cumDev) - Math.min(...cumDev)
    const stdDev = this.standardDeviation(series)

    if (stdDev === 0) return 0
    return range / stdDev
  }

  /**
   * Calculate Hurst exponent using R/S analysis
   * @param {number[]} prices - Price array (newest first)
   * @param {number} lookback - Number of periods to analyze
   * @returns {Object} { hurst, character, confidence }
   */
  calculateHurst(prices, lookback = null) {
    const config = this.getConfig()
    const n = lookback || config.defaultLookback

    if (prices.length < config.minDataPoints) {
      return {
        hurst: 0.5,
        character: MarketCharacter.RANDOM,
        confidence: 0,
        insufficient: true,
        reason: `Need ${config.minDataPoints} data points, have ${prices.length}`
      }
    }

    // Use subset of prices
    const subset = prices.slice(0, Math.min(n, prices.length))
    const returns = this.calculateLogReturns(subset)

    if (returns.length < 20) {
      return {
        hurst: 0.5,
        character: MarketCharacter.RANDOM,
        confidence: 0,
        insufficient: true,
        reason: 'Insufficient returns for calculation'
      }
    }

    // Calculate R/S for different sub-periods
    const rsValues = []
    const nValues = []

    // Use powers of 2 for sub-period lengths
    const minPeriod = 8
    const maxPeriod = Math.floor(returns.length / 2)

    for (let period = minPeriod; period <= maxPeriod; period = Math.floor(period * 1.5)) {
      const numSubperiods = Math.floor(returns.length / period)
      if (numSubperiods < 2) continue

      let rsSum = 0
      for (let i = 0; i < numSubperiods; i++) {
        const start = i * period
        const subPeriod = returns.slice(start, start + period)
        rsSum += this.calculateRS(subPeriod)
      }

      const avgRS = rsSum / numSubperiods
      if (avgRS > 0) {
        rsValues.push(Math.log(avgRS))
        nValues.push(Math.log(period))
      }
    }

    if (rsValues.length < 3) {
      return {
        hurst: 0.5,
        character: MarketCharacter.RANDOM,
        confidence: 0,
        insufficient: true,
        reason: 'Insufficient R/S values for regression'
      }
    }

    // Linear regression to find Hurst exponent (slope of log(R/S) vs log(n))
    const hurst = this.linearRegressionSlope(nValues, rsValues)

    // Clamp Hurst to reasonable range
    const clampedHurst = Math.max(0, Math.min(1, hurst))

    // Calculate R-squared for confidence
    const rSquared = this.calculateRSquared(nValues, rsValues, hurst)
    const confidence = Math.round(rSquared * 100)

    return {
      hurst: clampedHurst,
      character: this.classifyCharacter(clampedHurst, config),
      confidence,
      rSquared,
      dataPoints: returns.length
    }
  }

  /**
   * Linear regression slope calculation
   */
  linearRegressionSlope(x, y) {
    const n = x.length
    if (n < 2) return 0.5

    const sumX = x.reduce((sum, v) => sum + v, 0)
    const sumY = y.reduce((sum, v) => sum + v, 0)
    const sumXY = x.reduce((sum, v, i) => sum + v * y[i], 0)
    const sumX2 = x.reduce((sum, v) => sum + v * v, 0)

    const denominator = n * sumX2 - sumX * sumX
    if (denominator === 0) return 0.5

    return (n * sumXY - sumX * sumY) / denominator
  }

  /**
   * Calculate R-squared for regression fit
   */
  calculateRSquared(x, y, slope) {
    const meanX = this.mean(x)
    const meanY = this.mean(y)
    const intercept = meanY - slope * meanX

    // Predicted values
    const predicted = x.map(xi => slope * xi + intercept)

    // Total sum of squares
    const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0)

    // Residual sum of squares
    const ssResidual = y.reduce((sum, yi, i) => sum + Math.pow(yi - predicted[i], 2), 0)

    if (ssTotal === 0) return 0
    return 1 - (ssResidual / ssTotal)
  }

  /**
   * Classify market character based on Hurst value
   */
  classifyCharacter(hurst, config) {
    if (hurst > config.strongTrendThreshold) {
      return MarketCharacter.STRONG_TREND
    } else if (hurst > config.trendThreshold) {
      return MarketCharacter.TRENDING
    } else if (hurst > config.randomLowerThreshold) {
      return MarketCharacter.RANDOM
    } else if (hurst > config.meanRevertThreshold) {
      return MarketCharacter.MEAN_REVERTING
    } else {
      return MarketCharacter.STRONG_MEAN_REVERT
    }
  }

  /**
   * Analyze market character for a currency pair
   */
  analyzeMarketCharacter(pair, priceHistory) {
    const config = this.getConfig()

    if (!config.enabled) {
      return {
        enabled: false,
        hurst: 0.5,
        character: MarketCharacter.RANDOM,
        reason: 'Hurst analysis disabled'
      }
    }

    const hurstResult = this.calculateHurst(priceHistory)

    if (hurstResult.insufficient) {
      return {
        enabled: true,
        ...hurstResult
      }
    }

    const strategy = CharacterStrategy[hurstResult.character]

    // Determine if trading should proceed
    const shouldTrade = !(
      hurstResult.character === MarketCharacter.RANDOM &&
      config.blockRandomTrades
    )

    // Cache result
    this.hurstCache.set(pair, {
      hurst: hurstResult.hurst,
      character: hurstResult.character,
      timestamp: Date.now()
    })

    return {
      pair,
      enabled: true,
      hurst: hurstResult.hurst,
      character: hurstResult.character,
      confidence: hurstResult.confidence,
      strategy,
      shouldTrade,
      blockReason: !shouldTrade ? 'Random walk market - no statistical edge' : null,
      confidenceAdjustment: config.adjustConfidenceByHurst ? strategy.confidenceBoost : 0,
      interpretation: this.interpretHurst(hurstResult.hurst)
    }
  }

  /**
   * Human-readable Hurst interpretation
   */
  interpretHurst(hurst) {
    if (hurst > 0.65) {
      return `H=${hurst.toFixed(3)}: Strong trending behavior - prices tend to continue in their direction`
    } else if (hurst > 0.55) {
      return `H=${hurst.toFixed(3)}: Moderate trending - some persistence in price movements`
    } else if (hurst > 0.45) {
      return `H=${hurst.toFixed(3)}: Random walk - no predictable pattern`
    } else if (hurst > 0.35) {
      return `H=${hurst.toFixed(3)}: Mean-reverting - prices tend to reverse direction`
    } else {
      return `H=${hurst.toFixed(3)}: Strong mean reversion - aggressive reversal tendency`
    }
  }

  /**
   * Adjust confidence based on Hurst analysis and trade direction strategy alignment
   */
  adjustConfidence(baseConfidence, hurstResult, tradeStrategy) {
    if (!hurstResult || hurstResult.character === MarketCharacter.RANDOM) {
      return baseConfidence - 5 // Penalty for random markets
    }

    const isTrendFollowing = tradeStrategy === 'TREND' || tradeStrategy === 'BREAKOUT'
    const isMeanReversion = tradeStrategy === 'REVERSION' || tradeStrategy === 'FADE'

    // Check alignment
    const isTrending = hurstResult.character === MarketCharacter.STRONG_TREND ||
                      hurstResult.character === MarketCharacter.TRENDING
    const isReverting = hurstResult.character === MarketCharacter.MEAN_REVERTING ||
                       hurstResult.character === MarketCharacter.STRONG_MEAN_REVERT

    let adjustment = 0

    if (isTrending && isTrendFollowing) {
      adjustment = CharacterStrategy[hurstResult.character].confidenceBoost
    } else if (isReverting && isMeanReversion) {
      adjustment = CharacterStrategy[hurstResult.character].confidenceBoost
    } else if (isTrending && isMeanReversion) {
      adjustment = -10 // Penalty for wrong strategy
    } else if (isReverting && isTrendFollowing) {
      adjustment = -10 // Penalty for wrong strategy
    }

    return Math.max(10, Math.min(95, baseConfidence + adjustment))
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const config = this.getConfig()
    const cachedValues = {}

    for (const [pair, data] of this.hurstCache.entries()) {
      cachedValues[pair] = {
        hurst: data.hurst.toFixed(3),
        character: data.character,
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      }
    }

    return {
      enabled: config.enabled,
      minDataPoints: config.minDataPoints,
      lookback: config.defaultLookback,
      thresholds: {
        strongTrend: config.strongTrendThreshold,
        trend: config.trendThreshold,
        random: `${config.randomLowerThreshold}-${config.randomUpperThreshold}`,
        meanRevert: config.meanRevertThreshold
      },
      blockRandomTrades: config.blockRandomTrades,
      cachedValues
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.hurstCache.clear()
  }
}

// Singleton instance
export const hurstAnalyzer = new HurstAnalyzer()
export default hurstAnalyzer
