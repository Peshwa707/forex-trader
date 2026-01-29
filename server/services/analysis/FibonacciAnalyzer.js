/**
 * Fibonacci Analyzer Service
 * Calculates Fibonacci retracement and extension levels for swing trading
 */

import { getAllSettings } from '../../database.js'

/**
 * Standard Fibonacci retracement levels
 */
export const FIB_RETRACEMENT_LEVELS = {
  0: 0,
  236: 0.236,
  382: 0.382,
  500: 0.5,
  618: 0.618,
  786: 0.786,
  1000: 1.0
}

/**
 * Standard Fibonacci extension levels
 */
export const FIB_EXTENSION_LEVELS = {
  1272: 1.272,
  1414: 1.414,
  1618: 1.618,
  2000: 2.0,
  2618: 2.618
}

/**
 * @typedef {Object} FibLevel
 * @property {string} name - Level name (e.g., '38.2%')
 * @property {number} ratio - The Fibonacci ratio (e.g., 0.382)
 * @property {number} price - The price at this level
 * @property {string} type - 'RETRACEMENT' or 'EXTENSION'
 */

class FibonacciAnalyzer {
  constructor() {
    this.cache = new Map()
  }

  /**
   * Calculate Fibonacci retracement levels between a swing high and swing low
   * @param {number} swingHigh - The swing high price
   * @param {number} swingLow - The swing low price
   * @param {string} direction - 'UP' (measuring from low to high) or 'DOWN' (measuring from high to low)
   * @returns {FibLevel[]} Array of Fibonacci levels with prices
   */
  calculateRetracementLevels(swingHigh, swingLow, direction = 'UP') {
    if (swingHigh <= swingLow) {
      console.warn('[FibonacciAnalyzer] Invalid swing points: high must be greater than low')
      return []
    }

    const range = swingHigh - swingLow
    const levels = []

    // In an uptrend, retracements are measured down from the high
    // In a downtrend, retracements are measured up from the low
    for (const [key, ratio] of Object.entries(FIB_RETRACEMENT_LEVELS)) {
      let price
      if (direction === 'UP') {
        // Uptrend: retracement levels below the high
        price = swingHigh - (range * ratio)
      } else {
        // Downtrend: retracement levels above the low
        price = swingLow + (range * ratio)
      }

      levels.push({
        name: `${(ratio * 100).toFixed(1)}%`,
        ratio,
        price,
        type: 'RETRACEMENT',
        key: parseInt(key)
      })
    }

    return levels
  }

  /**
   * Calculate Fibonacci extension levels for profit targets
   * @param {number} swingHigh - The swing high price
   * @param {number} swingLow - The swing low price
   * @param {string} direction - 'UP' (extending above high) or 'DOWN' (extending below low)
   * @returns {FibLevel[]} Array of extension levels with prices
   */
  calculateExtensionLevels(swingHigh, swingLow, direction = 'UP') {
    if (swingHigh <= swingLow) {
      console.warn('[FibonacciAnalyzer] Invalid swing points')
      return []
    }

    const range = swingHigh - swingLow
    const levels = []

    for (const [key, ratio] of Object.entries(FIB_EXTENSION_LEVELS)) {
      let price
      if (direction === 'UP') {
        // Uptrend: extension levels above the high
        price = swingLow + (range * ratio)
      } else {
        // Downtrend: extension levels below the low
        price = swingHigh - (range * ratio)
      }

      levels.push({
        name: `${(ratio * 100).toFixed(1)}%`,
        ratio,
        price,
        type: 'EXTENSION',
        key: parseInt(key)
      })
    }

    return levels
  }

  /**
   * Calculate all Fibonacci levels (both retracement and extension)
   * @param {number} swingHigh - Swing high price
   * @param {number} swingLow - Swing low price
   * @param {string} direction - Trend direction
   * @returns {Object} Object with retracement and extension levels
   */
  calculateAllLevels(swingHigh, swingLow, direction = 'UP') {
    return {
      swingHigh,
      swingLow,
      range: swingHigh - swingLow,
      direction,
      retracement: this.calculateRetracementLevels(swingHigh, swingLow, direction),
      extension: this.calculateExtensionLevels(swingHigh, swingLow, direction)
    }
  }

  /**
   * Find the nearest Fibonacci level to a given price
   * @param {number} price - Current price
   * @param {FibLevel[]} levels - Array of Fibonacci levels
   * @returns {Object} Nearest level with distance info
   */
  findNearestFibLevel(price, levels) {
    if (!levels || levels.length === 0) {
      return null
    }

    let nearest = null
    let minDistance = Infinity

    for (const level of levels) {
      const distance = Math.abs(price - level.price)
      if (distance < minDistance) {
        minDistance = distance
        nearest = level
      }
    }

    return {
      level: nearest,
      distance: minDistance,
      distancePercent: (minDistance / price * 100).toFixed(3) + '%',
      isAbove: price > nearest.price
    }
  }

  /**
   * Check if price is at a Fibonacci level within tolerance
   * @param {number} price - Current price
   * @param {FibLevel[]} levels - Array of Fibonacci levels
   * @param {number} tolerance - Tolerance as percentage (default 0.1% = 0.001)
   * @returns {Object|null} The level if at one, null otherwise
   */
  isAtFibLevel(price, levels, tolerance = 0.001) {
    if (!levels || levels.length === 0) {
      return null
    }

    for (const level of levels) {
      const distance = Math.abs(price - level.price) / price
      if (distance <= tolerance) {
        return {
          level,
          exactDistance: distance,
          exactDistancePercent: (distance * 100).toFixed(3) + '%',
          withinTolerance: true
        }
      }
    }

    return null
  }

  /**
   * Get Fibonacci levels for pullback entry zones
   * Returns levels typically used for pullback entries (38.2%, 50%, 61.8%)
   * @param {number} swingHigh - Swing high price
   * @param {number} swingLow - Swing low price
   * @param {string} direction - Trend direction
   * @returns {FibLevel[]} Entry zone levels
   */
  getPullbackEntryZones(swingHigh, swingLow, direction = 'UP') {
    const settings = getAllSettings()
    const targetRatios = settings.swingPullbackFibLevels || [0.382, 0.5, 0.618]

    const allLevels = this.calculateRetracementLevels(swingHigh, swingLow, direction)
    return allLevels.filter(level => targetRatios.includes(level.ratio))
  }

  /**
   * Analyze price position relative to Fibonacci levels
   * @param {number} currentPrice - Current price
   * @param {number} swingHigh - Swing high
   * @param {number} swingLow - Swing low
   * @param {string} direction - Trend direction
   * @returns {Object} Detailed position analysis
   */
  analyzePosition(currentPrice, swingHigh, swingLow, direction = 'UP') {
    const allLevels = this.calculateAllLevels(swingHigh, swingLow, direction)
    const entryZones = this.getPullbackEntryZones(swingHigh, swingLow, direction)

    const nearest = this.findNearestFibLevel(currentPrice, allLevels.retracement)
    const atLevel = this.isAtFibLevel(currentPrice, allLevels.retracement, 0.002)
    const inEntryZone = this.isAtFibLevel(currentPrice, entryZones, 0.003)

    // Calculate position within the swing range
    const range = swingHigh - swingLow
    const positionRatio = direction === 'UP'
      ? (swingHigh - currentPrice) / range  // How much it has retraced
      : (currentPrice - swingLow) / range

    // Determine if it's a good entry based on position
    let entryQuality = 'POOR'
    if (positionRatio >= 0.382 && positionRatio <= 0.786) {
      if (positionRatio >= 0.5 && positionRatio <= 0.618) {
        entryQuality = 'EXCELLENT'  // Golden zone
      } else {
        entryQuality = 'GOOD'
      }
    } else if (positionRatio > 0.786) {
      entryQuality = 'RISKY'  // Deep retracement, might be trend reversal
    }

    return {
      currentPrice,
      swingHigh,
      swingLow,
      direction,
      range,
      retracementRatio: positionRatio,
      retracementPercent: (positionRatio * 100).toFixed(1) + '%',
      nearestLevel: nearest,
      atFibLevel: atLevel,
      inEntryZone: !!inEntryZone,
      entryZoneLevel: inEntryZone?.level,
      entryQuality,
      allLevels: allLevels.retracement,
      extensionLevels: allLevels.extension,
      entryZoneLevels: entryZones,
      analysis: this.generateAnalysis(positionRatio, direction, atLevel, inEntryZone)
    }
  }

  /**
   * Generate human-readable analysis
   */
  generateAnalysis(positionRatio, direction, atLevel, inEntryZone) {
    const percentRetraced = (positionRatio * 100).toFixed(1)

    if (inEntryZone) {
      const levelName = inEntryZone.level.name
      return `Price at ${levelName} Fibonacci level - potential ${direction === 'UP' ? 'long' : 'short'} entry zone`
    }

    if (positionRatio < 0.236) {
      return `Shallow retracement (${percentRetraced}%) - may continue or deepen`
    } else if (positionRatio >= 0.236 && positionRatio < 0.382) {
      return `Approaching 38.2% level (${percentRetraced}% retraced) - watch for support/resistance`
    } else if (positionRatio >= 0.382 && positionRatio < 0.5) {
      return `In lower entry zone (${percentRetraced}% retraced) - decent entry opportunity`
    } else if (positionRatio >= 0.5 && positionRatio < 0.618) {
      return `In golden zone (${percentRetraced}% retraced) - optimal entry opportunity`
    } else if (positionRatio >= 0.618 && positionRatio < 0.786) {
      return `Deep retracement (${percentRetraced}%) - higher risk entry`
    } else if (positionRatio >= 0.786) {
      return `Very deep retracement (${percentRetraced}%) - trend may be reversing`
    }

    return `${percentRetraced}% retraced`
  }

  /**
   * Calculate take profit levels using Fibonacci extensions
   * @param {number} entryPrice - Entry price
   * @param {number} stopLoss - Stop loss price
   * @param {string} direction - Trade direction
   * @returns {Object} Take profit levels
   */
  calculateTPLevels(entryPrice, stopLoss, direction = 'UP') {
    const riskAmount = Math.abs(entryPrice - stopLoss)

    const tpLevels = {
      tp1: direction === 'UP'
        ? entryPrice + riskAmount  // 1:1 R:R
        : entryPrice - riskAmount,
      tp2: direction === 'UP'
        ? entryPrice + (riskAmount * 1.618)  // 1.618:1 R:R
        : entryPrice - (riskAmount * 1.618),
      tp3: direction === 'UP'
        ? entryPrice + (riskAmount * 2.618)  // 2.618:1 R:R
        : entryPrice - (riskAmount * 2.618)
    }

    return {
      ...tpLevels,
      riskAmount,
      direction,
      tp1RR: 1.0,
      tp2RR: 1.618,
      tp3RR: 2.618
    }
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const settings = getAllSettings()
    return {
      enabled: settings.swingTradingEnabled,
      pullbackLevels: settings.swingPullbackFibLevels || [0.382, 0.5, 0.618],
      cacheSize: this.cache.size
    }
  }
}

// Singleton instance
export const fibonacciAnalyzer = new FibonacciAnalyzer()

// Named export for class
export { FibonacciAnalyzer }

export default FibonacciAnalyzer
