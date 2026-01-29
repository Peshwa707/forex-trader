/**
 * Multi-Timeframe Analyzer
 * Phase 2 Risk Improvement: Confirm signals across multiple timeframes
 *
 * Implements:
 * - Higher timeframe trend confirmation
 * - Multi-timeframe alignment scoring
 * - Timeframe-specific signal generation
 */

import * as db from '../../database.js'
import { calculateSMA, calculateEMA, calculateRSI, calculateMACD } from '../technicalAnalysis.js'

// Timeframe definitions (in minutes)
export const Timeframe = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440
}

// Default configuration
export const DEFAULT_MTF_CONFIG = {
  enabled: true,
  primaryTimeframe: 'H1',           // Main trading timeframe
  confirmationTimeframes: ['H4', 'D1'], // Higher timeframes for confirmation
  requireAllAligned: false,         // Require all timeframes agree
  minAlignmentScore: 60,            // Minimum alignment score (0-100)
  trendWeight: {
    M15: 0.1,
    M30: 0.15,
    H1: 0.25,
    H4: 0.25,
    D1: 0.25
  }
}

/**
 * MultiTimeframeAnalyzer - Analyzes multiple timeframes for trade confirmation
 */
export class MultiTimeframeAnalyzer {
  constructor() {
    this.config = { ...DEFAULT_MTF_CONFIG }
    this.timeframeData = new Map() // Store analysis per pair/timeframe
  }

  /**
   * Configure with custom settings
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_MTF_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      enabled: settings.mtfEnabled !== undefined ? settings.mtfEnabled : this.config.enabled,
      primaryTimeframe: settings.mtfPrimaryTimeframe || this.config.primaryTimeframe,
      confirmationTimeframes: settings.mtfConfirmationTimeframes || this.config.confirmationTimeframes,
      requireAllAligned: settings.mtfRequireAllAligned || this.config.requireAllAligned,
      minAlignmentScore: settings.mtfMinAlignmentScore || this.config.minAlignmentScore,
      trendWeight: settings.mtfTrendWeight || this.config.trendWeight
    }
  }

  /**
   * Resample price data to a higher timeframe
   * @param {number[]} prices - Price array (newest first)
   * @param {number} currentTfMinutes - Current timeframe in minutes
   * @param {number} targetTfMinutes - Target timeframe in minutes
   * @returns {number[]} Resampled prices
   */
  resamplePrices(prices, currentTfMinutes, targetTfMinutes) {
    const ratio = Math.ceil(targetTfMinutes / currentTfMinutes)

    if (ratio <= 1) {
      return prices
    }

    const resampled = []
    for (let i = 0; i < prices.length; i += ratio) {
      // Take the first price of each group (which is the most recent)
      resampled.push(prices[i])
    }

    return resampled
  }

  /**
   * Analyze trend direction for a single timeframe
   * @param {number[]} prices - Price array (newest first)
   * @returns {Object} Trend analysis
   */
  analyzeTrend(prices) {
    if (prices.length < 50) {
      return {
        direction: 'NEUTRAL',
        strength: 0,
        confidence: 0,
        insufficient: true
      }
    }

    const current = prices[0]

    // Calculate SMAs
    const sma20 = calculateSMA(prices.slice(0, 20), 20)
    const sma50 = calculateSMA(prices.slice(0, 50), 50)

    // Calculate EMAs for faster response
    const ema9 = calculateEMA(prices.slice(0, 20), 9)
    const ema21 = calculateEMA(prices.slice(0, 30), 21)

    // Calculate RSI
    const rsi = calculateRSI(prices.slice(0, 15), 14)

    // Calculate MACD
    const macd = calculateMACD(prices.slice(0, 30))

    // Score bullish/bearish signals
    let bullScore = 0
    let bearScore = 0
    let signalCount = 0

    // Price vs SMAs
    if (current > sma20) { bullScore += 1 } else { bearScore += 1 }
    if (current > sma50) { bullScore += 1 } else { bearScore += 1 }
    signalCount += 2

    // SMA alignment
    if (sma20 > sma50) { bullScore += 1.5 } else { bearScore += 1.5 }
    signalCount += 1.5

    // EMA alignment
    if (ema9 > ema21) { bullScore += 1 } else { bearScore += 1 }
    signalCount += 1

    // RSI
    if (rsi > 50) { bullScore += 0.5 } else { bearScore += 0.5 }
    if (rsi > 60) { bullScore += 0.5 }
    if (rsi < 40) { bearScore += 0.5 }
    signalCount += 1

    // MACD
    if (macd.macd > macd.signal) { bullScore += 1 } else { bearScore += 1 }
    if (macd.histogram > 0) { bullScore += 0.5 } else { bearScore += 0.5 }
    signalCount += 1.5

    // Determine direction and strength
    const totalScore = bullScore + bearScore
    const direction = bullScore > bearScore ? 'UP' : bullScore < bearScore ? 'DOWN' : 'NEUTRAL'
    const dominantScore = Math.max(bullScore, bearScore)
    const strength = totalScore > 0 ? (dominantScore / totalScore) * 100 : 50

    // Confidence based on agreement
    const agreement = Math.abs(bullScore - bearScore) / signalCount
    const confidence = Math.min(95, agreement * 100 + 30)

    return {
      direction,
      strength,
      confidence,
      bullScore,
      bearScore,
      indicators: {
        sma20,
        sma50,
        ema9,
        ema21,
        rsi,
        macd: macd.macd,
        signal: macd.signal,
        histogram: macd.histogram
      }
    }
  }

  /**
   * Analyze multiple timeframes for a currency pair
   * @param {string} pair - Currency pair
   * @param {number[]} prices - Price history (assumed H1 timeframe, newest first)
   * @param {number} baseTfMinutes - Base timeframe of input data (default 60 for H1)
   * @returns {Object} Multi-timeframe analysis
   */
  analyzeMultipleTimeframes(pair, prices, baseTfMinutes = 60) {
    const config = this.getConfig()

    if (!config.enabled) {
      return {
        enabled: false,
        alignment: 100,
        direction: 'NEUTRAL',
        reason: 'Multi-timeframe analysis disabled'
      }
    }

    const analyses = {}
    const directions = []
    let weightedBullish = 0
    let weightedBearish = 0
    let totalWeight = 0

    // Analyze each timeframe
    const timeframesToAnalyze = [config.primaryTimeframe, ...config.confirmationTimeframes]

    for (const tfName of timeframesToAnalyze) {
      const tfMinutes = Timeframe[tfName]
      if (!tfMinutes) continue

      // Resample prices to this timeframe
      const resampledPrices = this.resamplePrices(prices, baseTfMinutes, tfMinutes)

      if (resampledPrices.length < 50) {
        analyses[tfName] = {
          direction: 'NEUTRAL',
          strength: 0,
          confidence: 0,
          insufficient: true
        }
        continue
      }

      // Analyze trend
      const analysis = this.analyzeTrend(resampledPrices)
      analyses[tfName] = analysis

      // Track directions
      directions.push({
        timeframe: tfName,
        direction: analysis.direction,
        strength: analysis.strength
      })

      // Weight the scores
      const weight = config.trendWeight[tfName] || 0.2
      if (analysis.direction === 'UP') {
        weightedBullish += weight * (analysis.strength / 100)
      } else if (analysis.direction === 'DOWN') {
        weightedBearish += weight * (analysis.strength / 100)
      }
      totalWeight += weight
    }

    // Calculate overall direction
    const normalizedBullish = totalWeight > 0 ? weightedBullish / totalWeight : 0.5
    const normalizedBearish = totalWeight > 0 ? weightedBearish / totalWeight : 0.5

    let overallDirection
    if (normalizedBullish > normalizedBearish + 0.1) {
      overallDirection = 'UP'
    } else if (normalizedBearish > normalizedBullish + 0.1) {
      overallDirection = 'DOWN'
    } else {
      overallDirection = 'NEUTRAL'
    }

    // Calculate alignment score
    const alignedCount = directions.filter(d => d.direction === overallDirection).length
    const alignmentScore = (alignedCount / directions.length) * 100

    // Check if all required timeframes align
    const confirmationAligned = config.confirmationTimeframes.every(tf => {
      const analysis = analyses[tf]
      return analysis && (analysis.direction === overallDirection || analysis.direction === 'NEUTRAL')
    })

    // Determine if we should trade
    const passesAlignment = alignmentScore >= config.minAlignmentScore
    const passesConfirmation = !config.requireAllAligned || confirmationAligned

    const shouldTrade = passesAlignment && passesConfirmation

    // Store analysis
    this.timeframeData.set(pair, {
      analyses,
      timestamp: Date.now()
    })

    return {
      pair,
      enabled: true,
      overallDirection,
      alignmentScore,
      alignedTimeframes: alignedCount,
      totalTimeframes: directions.length,
      analyses,
      weightedBullish: normalizedBullish * 100,
      weightedBearish: normalizedBearish * 100,
      shouldTrade,
      reason: shouldTrade
        ? `${alignedCount}/${directions.length} timeframes aligned (${alignmentScore.toFixed(0)}%)`
        : `Insufficient alignment: ${alignmentScore.toFixed(0)}% < ${config.minAlignmentScore}%`,
      confidenceAdjustment: this.calculateConfidenceAdjustment(alignmentScore, overallDirection)
    }
  }

  /**
   * Calculate confidence adjustment based on MTF alignment
   */
  calculateConfidenceAdjustment(alignmentScore, direction) {
    if (direction === 'NEUTRAL') {
      return -10 // Penalty for no clear direction
    }

    if (alignmentScore >= 90) {
      return 15 // Strong boost for high alignment
    } else if (alignmentScore >= 75) {
      return 10
    } else if (alignmentScore >= 60) {
      return 5
    } else if (alignmentScore >= 40) {
      return 0
    } else {
      return -10 // Penalty for poor alignment
    }
  }

  /**
   * Check if a prediction aligns with higher timeframes
   * @param {string} pair - Currency pair
   * @param {string} predictionDirection - 'UP' or 'DOWN'
   * @param {number[]} prices - Price history
   * @returns {Object} Alignment check result
   */
  checkAlignment(pair, predictionDirection, prices) {
    const mtfAnalysis = this.analyzeMultipleTimeframes(pair, prices)

    const aligned = mtfAnalysis.overallDirection === predictionDirection ||
                   mtfAnalysis.overallDirection === 'NEUTRAL'

    return {
      aligned,
      mtfDirection: mtfAnalysis.overallDirection,
      alignmentScore: mtfAnalysis.alignmentScore,
      shouldProceed: mtfAnalysis.shouldTrade && aligned,
      reason: aligned
        ? `Prediction aligns with MTF trend (${mtfAnalysis.alignmentScore.toFixed(0)}%)`
        : `Prediction conflicts with MTF: ${predictionDirection} vs ${mtfAnalysis.overallDirection}`,
      confidenceAdjustment: aligned
        ? mtfAnalysis.confidenceAdjustment
        : mtfAnalysis.confidenceAdjustment - 10 // Extra penalty for counter-trend
    }
  }

  /**
   * Get cached analysis for a pair
   */
  getCachedAnalysis(pair) {
    return this.timeframeData.get(pair)
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const config = this.getConfig()
    const cachedPairs = {}

    for (const [pair, data] of this.timeframeData.entries()) {
      cachedPairs[pair] = {
        timeframes: Object.keys(data.analyses),
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      }
    }

    return {
      enabled: config.enabled,
      primaryTimeframe: config.primaryTimeframe,
      confirmationTimeframes: config.confirmationTimeframes,
      requireAllAligned: config.requireAllAligned,
      minAlignmentScore: config.minAlignmentScore,
      cachedPairs
    }
  }

  /**
   * Clear cached data
   */
  clearCache() {
    this.timeframeData.clear()
  }
}

// Singleton instance
export const mtfAnalyzer = new MultiTimeframeAnalyzer()
export default mtfAnalyzer
