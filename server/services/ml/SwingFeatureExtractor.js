/**
 * Swing Feature Extractor
 * Extracts 20 swing-specific features for ML model training and inference
 *
 * Features Categories:
 * - Multi-TF Trend (6): dailyTrend, weeklyTrend, dailyMomentum, htfAlignment, daysInTrend, trendStartDistance
 * - Trend Strength (5): adx, adxSlope, diSeparation, trendConsistency, hurstExponent
 * - Price Structure (5): distanceToSwingHigh, distanceToSwingLow, swingRange, pricePositionInSwing, hhllPattern
 * - S/R & Fib (4): nearestSupportDistance, nearestResistanceDistance, atSupportResistance, fibLevel
 */

import { swingPointDetector } from '../analysis/SwingPointDetector.js'
import { fibonacciAnalyzer } from '../analysis/FibonacciAnalyzer.js'
import { hurstAnalyzer } from '../analysis/HurstAnalyzer.js'

class SwingFeatureExtractor {
  constructor() {
    this.featureNames = [
      // Multi-TF Trend (6)
      'dailyTrend',
      'weeklyTrend',
      'dailyMomentum',
      'htfAlignment',
      'daysInTrend',
      'trendStartDistance',
      // Trend Strength (5)
      'adx',
      'adxSlope',
      'diSeparation',
      'trendConsistency',
      'hurstExponent',
      // Price Structure (5)
      'distanceToSwingHigh',
      'distanceToSwingLow',
      'swingRange',
      'pricePositionInSwing',
      'hhllPattern',
      // S/R & Fib (4)
      'nearestSupportDistance',
      'nearestResistanceDistance',
      'atSupportResistance',
      'fibLevel'
    ]
  }

  /**
   * Extract all 20 swing features from market data
   * @param {string} pair - Currency pair
   * @param {Array} dailyCandles - Array of daily candles (oldest to newest)
   * @param {Array} weeklyCandles - Array of weekly candles (optional)
   * @param {Array} priceHistory - Tick-level price history
   * @param {Object} indicators - Technical indicators
   * @returns {Object} Extracted features
   */
  extractFeatures(pair, dailyCandles, weeklyCandles, priceHistory, indicators = {}) {
    if (!dailyCandles || dailyCandles.length < 20) {
      return this.getDefaultFeatures()
    }

    const currentPrice = dailyCandles[dailyCandles.length - 1].close

    // Extract each feature category
    const mtfFeatures = this.extractMultiTimeframeFeatures(dailyCandles, weeklyCandles)
    const trendFeatures = this.extractTrendStrengthFeatures(pair, priceHistory, indicators)
    const structureFeatures = this.extractPriceStructureFeatures(dailyCandles, currentPrice)
    const srFibFeatures = this.extractSRFibFeatures(dailyCandles, currentPrice)

    return {
      ...mtfFeatures,
      ...trendFeatures,
      ...structureFeatures,
      ...srFibFeatures,
      _meta: {
        pair,
        extractedAt: new Date().toISOString(),
        candleCount: dailyCandles.length,
        currentPrice
      }
    }
  }

  /**
   * Extract Multi-Timeframe Trend features (6)
   */
  extractMultiTimeframeFeatures(dailyCandles, weeklyCandles) {
    // Daily trend: Calculate from last 20 candles using simple regression
    const dailyTrend = this.calculateTrendSlope(dailyCandles.slice(-20))

    // Weekly trend: Calculate from weekly candles if available
    const weeklyTrend = weeklyCandles && weeklyCandles.length >= 10
      ? this.calculateTrendSlope(weeklyCandles.slice(-10))
      : dailyTrend // Fallback to daily if no weekly data

    // Daily momentum: Rate of change over 14 periods
    const dailyMomentum = this.calculateMomentum(dailyCandles, 14)

    // HTF alignment: How well daily and weekly trends agree
    // 1 = perfectly aligned, -1 = opposite, 0 = neutral
    const htfAlignment = this.calculateTrendAlignment(dailyTrend, weeklyTrend)

    // Days in current trend: Count consecutive days in same direction
    const daysInTrend = this.countDaysInTrend(dailyCandles)

    // Distance from trend start: Normalized distance from where current trend began
    const trendStartDistance = this.calculateTrendStartDistance(dailyCandles)

    return {
      dailyTrend: this.normalizeFeature(dailyTrend, -0.01, 0.01), // Normalize slope
      weeklyTrend: this.normalizeFeature(weeklyTrend, -0.01, 0.01),
      dailyMomentum: this.normalizeFeature(dailyMomentum, -5, 5), // % change
      htfAlignment,
      daysInTrend: this.normalizeFeature(daysInTrend, 0, 30),
      trendStartDistance: this.normalizeFeature(trendStartDistance, 0, 0.1)
    }
  }

  /**
   * Extract Trend Strength features (5)
   */
  extractTrendStrengthFeatures(pair, priceHistory, indicators) {
    // ADX value (normalized 0-100)
    const adx = indicators.adx ? indicators.adx / 100 : 0.25 // Default 25

    // ADX slope: Is trend strengthening or weakening?
    const adxSlope = indicators.adxSlope || 0

    // DI separation: DI+ minus DI- (normalized)
    const diSeparation = indicators.diPlus && indicators.diMinus
      ? (indicators.diPlus - indicators.diMinus) / 100
      : 0

    // Trend consistency: How often price moved in trend direction
    const trendConsistency = priceHistory && priceHistory.length >= 20
      ? this.calculateTrendConsistency(priceHistory.slice(-20))
      : 0.5

    // Hurst exponent from analysis
    let hurstExponent = 0.5 // Default (random walk)
    if (priceHistory && priceHistory.length >= 50) {
      try {
        const hurstResult = hurstAnalyzer.analyzeMarketCharacter(pair, priceHistory)
        if (hurstResult && hurstResult.hurst) {
          hurstExponent = hurstResult.hurst
        }
      } catch (e) {
        // Use default - log for debugging
        console.warn(`[SwingFeatureExtractor] Hurst analysis failed for ${pair}:`, e.message)
      }
    }

    return {
      adx,
      adxSlope: this.normalizeFeature(adxSlope, -2, 2),
      diSeparation,
      trendConsistency,
      hurstExponent
    }
  }

  /**
   * Extract Price Structure features (5)
   */
  extractPriceStructureFeatures(dailyCandles, currentPrice) {
    // Get swing point distances
    const swingInfo = swingPointDetector.getDistanceToSwings(currentPrice, dailyCandles)

    // Distance to swing high (normalized by price)
    const distanceToSwingHigh = swingInfo.distanceToSwingHigh || 0

    // Distance to swing low (normalized by price)
    const distanceToSwingLow = swingInfo.distanceToSwingLow || 0

    // Swing range (high - low as % of price)
    const swingRange = swingInfo.swingRange
      ? swingInfo.swingRange / currentPrice
      : 0

    // Price position within swing (0 = at low, 1 = at high)
    const pricePositionInSwing = swingInfo.pricePositionInSwing || 0.5

    // HH/HL/LH/LL pattern: Analyze market structure
    const marketStructure = swingPointDetector.analyzeMarketStructure(dailyCandles)
    let hhllPattern = 0 // Neutral
    if (marketStructure.pattern === 'HH_HL') {
      hhllPattern = 1 // Bullish structure
    } else if (marketStructure.pattern === 'LH_LL') {
      hhllPattern = -1 // Bearish structure
    }

    return {
      distanceToSwingHigh: this.normalizeFeature(distanceToSwingHigh, -0.05, 0.05),
      distanceToSwingLow: this.normalizeFeature(distanceToSwingLow, -0.05, 0.05),
      swingRange: this.normalizeFeature(swingRange, 0, 0.1),
      pricePositionInSwing,
      hhllPattern
    }
  }

  /**
   * Extract Support/Resistance and Fibonacci features (4)
   */
  extractSRFibFeatures(dailyCandles, currentPrice) {
    // Get key levels
    const keyLevels = swingPointDetector.findKeyLevels(dailyCandles)

    // Nearest support distance (as % of price)
    let nearestSupportDistance = 0
    if (keyLevels.nearestSupport) {
      nearestSupportDistance = (currentPrice - keyLevels.nearestSupport.center) / currentPrice
    }

    // Nearest resistance distance (as % of price)
    let nearestResistanceDistance = 0
    if (keyLevels.nearestResistance) {
      nearestResistanceDistance = (keyLevels.nearestResistance.center - currentPrice) / currentPrice
    }

    // At support or resistance (binary, with tolerance)
    const tolerance = 0.003 // 0.3%
    const atSupportResistance =
      (nearestSupportDistance >= 0 && nearestSupportDistance < tolerance) ||
      (nearestResistanceDistance >= 0 && nearestResistanceDistance < tolerance)
        ? 1 : 0

    // Fibonacci level: Get position in retracement
    const swingHighs = swingPointDetector.detectSwingHighs(dailyCandles)
    const swingLows = swingPointDetector.detectSwingLows(dailyCandles)

    let fibLevel = 0.5 // Default middle
    if (swingHighs.length > 0 && swingLows.length > 0) {
      const lastHigh = swingHighs[swingHighs.length - 1]
      const lastLow = swingLows[swingLows.length - 1]

      const fibAnalysis = fibonacciAnalyzer.analyzePosition(
        currentPrice,
        lastHigh.price,
        lastLow.price,
        lastHigh.index > lastLow.index ? 'DOWN' : 'UP' // Most recent determines direction
      )

      fibLevel = fibAnalysis.retracementRatio
    }

    return {
      nearestSupportDistance: this.normalizeFeature(nearestSupportDistance, -0.05, 0.05),
      nearestResistanceDistance: this.normalizeFeature(nearestResistanceDistance, -0.05, 0.05),
      atSupportResistance,
      fibLevel: this.clamp(fibLevel, 0, 1)
    }
  }

  /**
   * Helper: Calculate trend slope using linear regression
   */
  calculateTrendSlope(candles) {
    if (!candles || candles.length < 2) return 0

    const prices = candles.map(c => c.close)
    const n = prices.length

    // Simple linear regression
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    for (let i = 0; i < n; i++) {
      sumX += i
      sumY += prices[i]
      sumXY += i * prices[i]
      sumX2 += i * i
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    return slope / prices[0] // Normalize by starting price
  }

  /**
   * Helper: Calculate momentum (rate of change)
   */
  calculateMomentum(candles, period) {
    if (!candles || candles.length < period) return 0

    const current = candles[candles.length - 1].close
    const previous = candles[candles.length - period].close

    return ((current - previous) / previous) * 100
  }

  /**
   * Helper: Calculate trend alignment between two trend values
   */
  calculateTrendAlignment(trend1, trend2) {
    // Both positive or both negative = aligned
    if (trend1 > 0 && trend2 > 0) return 1
    if (trend1 < 0 && trend2 < 0) return 1
    // Opposite signs = misaligned
    if ((trend1 > 0 && trend2 < 0) || (trend1 < 0 && trend2 > 0)) return -1
    // One is neutral
    return 0
  }

  /**
   * Helper: Count consecutive days in current trend direction
   */
  countDaysInTrend(candles) {
    if (!candles || candles.length < 2) return 0

    let count = 1
    const currentDirection = candles[candles.length - 1].close > candles[candles.length - 2].close ? 'UP' : 'DOWN'

    for (let i = candles.length - 2; i > 0; i--) {
      const direction = candles[i].close > candles[i - 1].close ? 'UP' : 'DOWN'
      if (direction === currentDirection) {
        count++
      } else {
        break
      }
    }

    return count
  }

  /**
   * Helper: Calculate distance from current price to trend start
   */
  calculateTrendStartDistance(candles) {
    if (!candles || candles.length < 2) return 0

    // Find where trend started (last direction change)
    let trendStartIndex = candles.length - 1
    const currentDirection = candles[candles.length - 1].close > candles[candles.length - 2].close ? 'UP' : 'DOWN'

    for (let i = candles.length - 2; i > 0; i--) {
      const direction = candles[i].close > candles[i - 1].close ? 'UP' : 'DOWN'
      if (direction !== currentDirection) {
        trendStartIndex = i
        break
      }
    }

    const trendStartPrice = candles[trendStartIndex].close
    const currentPrice = candles[candles.length - 1].close

    return Math.abs(currentPrice - trendStartPrice) / trendStartPrice
  }

  /**
   * Helper: Calculate trend consistency (% of moves in trend direction)
   */
  calculateTrendConsistency(prices) {
    if (!prices || prices.length < 2) return 0.5

    // Determine overall trend direction
    const overallDirection = prices[prices.length - 1] > prices[0] ? 'UP' : 'DOWN'

    // Count moves in trend direction
    let consistentMoves = 0
    for (let i = 1; i < prices.length; i++) {
      const moveDirection = prices[i] > prices[i - 1] ? 'UP' : 'DOWN'
      if (moveDirection === overallDirection) {
        consistentMoves++
      }
    }

    return consistentMoves / (prices.length - 1)
  }

  /**
   * Helper: Normalize feature to -1 to 1 range
   */
  normalizeFeature(value, min, max) {
    if (value === null || value === undefined) return 0
    const normalized = (value - min) / (max - min) * 2 - 1
    return this.clamp(normalized, -1, 1)
  }

  /**
   * Helper: Clamp value to range
   */
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  /**
   * Get default features (all zeros/neutral) when data is insufficient
   */
  getDefaultFeatures() {
    const features = {}
    for (const name of this.featureNames) {
      features[name] = 0
    }
    return features
  }

  /**
   * Convert features to array for ML model input
   */
  featuresToArray(features) {
    return this.featureNames.map(name => features[name] || 0)
  }

  /**
   * Get feature names in order
   */
  getFeatureNames() {
    return [...this.featureNames]
  }

  /**
   * Get feature count
   */
  getFeatureCount() {
    return this.featureNames.length
  }
}

// Singleton instance
export const swingFeatureExtractor = new SwingFeatureExtractor()

export default SwingFeatureExtractor
