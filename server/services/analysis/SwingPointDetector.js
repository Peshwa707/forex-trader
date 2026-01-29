/**
 * Swing Point Detector Service
 * Identifies swing highs, swing lows, and market structure (HH/HL/LH/LL)
 * for swing trading analysis
 */

import { getAllSettings } from '../../database.js'

/**
 * @typedef {Object} SwingPoint
 * @property {string} type - 'HIGH' or 'LOW'
 * @property {number} price - The swing point price
 * @property {string} date - The date of the swing point
 * @property {number} index - Index in the candle array
 */

/**
 * @typedef {Object} MarketStructure
 * @property {string} trend - 'UPTREND', 'DOWNTREND', or 'RANGING'
 * @property {string} pattern - 'HH_HL' (higher highs, higher lows) or 'LH_LL' (lower highs, lower lows)
 * @property {number} strength - Trend strength 0-100
 * @property {SwingPoint[]} recentSwings - Recent swing points
 */

class SwingPointDetector {
  constructor() {
    this.cache = new Map()
    this.cacheTimeout = 60000 // 1 minute cache
  }

  /**
   * Detect swing highs from candle data
   * A swing high is a candle whose high is higher than lookback candles before AND after
   * @param {Array} candles - Array of candles (oldest to newest for analysis)
   * @param {number} lookback - Number of candles to look back/forward (default 5)
   * @returns {SwingPoint[]} Array of swing high points
   */
  detectSwingHighs(candles, lookback = 5) {
    if (!candles || candles.length < lookback * 2 + 1) {
      return []
    }

    const swingHighs = []

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i]
      let isSwingHigh = true

      // Check lookback candles on each side
      for (let j = 1; j <= lookback; j++) {
        const before = candles[i - j]
        const after = candles[i + j]

        if (!before || !after) {
          isSwingHigh = false
          break
        }

        // Swing high: current high is higher than surrounding highs
        if (current.high <= before.high || current.high <= after.high) {
          isSwingHigh = false
          break
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          type: 'HIGH',
          price: current.high,
          date: current.date,
          index: i,
          candle: current
        })
      }
    }

    return swingHighs
  }

  /**
   * Detect swing lows from candle data
   * A swing low is a candle whose low is lower than lookback candles before AND after
   * @param {Array} candles - Array of candles (oldest to newest for analysis)
   * @param {number} lookback - Number of candles to look back/forward (default 5)
   * @returns {SwingPoint[]} Array of swing low points
   */
  detectSwingLows(candles, lookback = 5) {
    if (!candles || candles.length < lookback * 2 + 1) {
      return []
    }

    const swingLows = []

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i]
      let isSwingLow = true

      // Check lookback candles on each side
      for (let j = 1; j <= lookback; j++) {
        const before = candles[i - j]
        const after = candles[i + j]

        if (!before || !after) {
          isSwingLow = false
          break
        }

        // Swing low: current low is lower than surrounding lows
        if (current.low >= before.low || current.low >= after.low) {
          isSwingLow = false
          break
        }
      }

      if (isSwingLow) {
        swingLows.push({
          type: 'LOW',
          price: current.low,
          date: current.date,
          index: i,
          candle: current
        })
      }
    }

    return swingLows
  }

  /**
   * Detect all swing points (highs and lows) and return sorted by date
   * @param {Array} candles - Array of candles
   * @param {number} lookback - Lookback period
   * @returns {SwingPoint[]} All swing points sorted by date
   */
  detectAllSwingPoints(candles, lookback = 5) {
    const highs = this.detectSwingHighs(candles, lookback)
    const lows = this.detectSwingLows(candles, lookback)

    const allSwings = [...highs, ...lows]
    allSwings.sort((a, b) => a.index - b.index)

    return allSwings
  }

  /**
   * Analyze market structure based on swing points
   * Determines if market is making HH/HL (uptrend) or LH/LL (downtrend)
   * @param {Array} candles - Array of candles (oldest to newest)
   * @param {number} lookback - Lookback period for swing detection
   * @returns {MarketStructure} Market structure analysis
   */
  analyzeMarketStructure(candles, lookback = 5) {
    const swingPoints = this.detectAllSwingPoints(candles, lookback)

    if (swingPoints.length < 4) {
      return {
        trend: 'INSUFFICIENT_DATA',
        pattern: 'UNKNOWN',
        strength: 0,
        recentSwings: swingPoints,
        analysis: 'Not enough swing points for structure analysis'
      }
    }

    // Get recent highs and lows
    const recentHighs = swingPoints.filter(s => s.type === 'HIGH').slice(-4)
    const recentLows = swingPoints.filter(s => s.type === 'LOW').slice(-4)

    if (recentHighs.length < 2 || recentLows.length < 2) {
      return {
        trend: 'INSUFFICIENT_DATA',
        pattern: 'UNKNOWN',
        strength: 0,
        recentSwings: swingPoints.slice(-8),
        analysis: 'Not enough consecutive highs/lows'
      }
    }

    // Analyze highs pattern
    let higherHighs = 0
    let lowerHighs = 0
    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i].price > recentHighs[i - 1].price) {
        higherHighs++
      } else {
        lowerHighs++
      }
    }

    // Analyze lows pattern
    let higherLows = 0
    let lowerLows = 0
    for (let i = 1; i < recentLows.length; i++) {
      if (recentLows[i].price > recentLows[i - 1].price) {
        higherLows++
      } else {
        lowerLows++
      }
    }

    // Determine trend and pattern
    let trend = 'RANGING'
    let pattern = 'MIXED'
    let strength = 0

    const totalHighComparisons = higherHighs + lowerHighs
    const totalLowComparisons = higherLows + lowerLows

    // Uptrend: Higher Highs + Higher Lows
    if (higherHighs > lowerHighs && higherLows > lowerLows) {
      trend = 'UPTREND'
      pattern = 'HH_HL'
      strength = ((higherHighs / totalHighComparisons) + (higherLows / totalLowComparisons)) / 2 * 100
    }
    // Downtrend: Lower Highs + Lower Lows
    else if (lowerHighs > higherHighs && lowerLows > higherLows) {
      trend = 'DOWNTREND'
      pattern = 'LH_LL'
      strength = ((lowerHighs / totalHighComparisons) + (lowerLows / totalLowComparisons)) / 2 * 100
    }
    // Ranging: Mixed pattern
    else {
      trend = 'RANGING'
      pattern = 'MIXED'
      // Calculate how indecisive the market is
      const highIndecision = Math.abs(higherHighs - lowerHighs) / Math.max(totalHighComparisons, 1)
      const lowIndecision = Math.abs(higherLows - lowerLows) / Math.max(totalLowComparisons, 1)
      strength = (1 - (highIndecision + lowIndecision) / 2) * 100 // Higher = more range-bound
    }

    return {
      trend,
      pattern,
      strength: Math.round(strength),
      recentSwings: swingPoints.slice(-8),
      higherHighs,
      lowerHighs,
      higherLows,
      lowerLows,
      lastHigh: recentHighs[recentHighs.length - 1],
      lastLow: recentLows[recentLows.length - 1],
      analysis: this.generateStructureAnalysis(trend, pattern, strength)
    }
  }

  /**
   * Generate human-readable structure analysis
   */
  generateStructureAnalysis(trend, pattern, strength) {
    if (trend === 'UPTREND') {
      if (strength > 75) {
        return 'Strong uptrend with clear higher highs and higher lows'
      } else if (strength > 50) {
        return 'Moderate uptrend, structure mostly intact'
      } else {
        return 'Weak uptrend, structure may be breaking down'
      }
    } else if (trend === 'DOWNTREND') {
      if (strength > 75) {
        return 'Strong downtrend with clear lower highs and lower lows'
      } else if (strength > 50) {
        return 'Moderate downtrend, structure mostly intact'
      } else {
        return 'Weak downtrend, structure may be breaking down'
      }
    } else {
      return 'Ranging market with no clear directional bias'
    }
  }

  /**
   * Find key support and resistance levels by clustering swing points
   * @param {Array} candles - Array of candles
   * @param {number} lookback - Swing point lookback
   * @param {number} tolerance - Price tolerance for clustering (as percentage)
   * @returns {Object} Key levels with support and resistance zones
   */
  findKeyLevels(candles, lookback = 5, tolerance = 0.002) {
    const swingHighs = this.detectSwingHighs(candles, lookback)
    const swingLows = this.detectSwingLows(candles, lookback)

    // Cluster swing highs into resistance zones
    const resistanceZones = this.clusterLevels(
      swingHighs.map(s => s.price),
      tolerance
    )

    // Cluster swing lows into support zones
    const supportZones = this.clusterLevels(
      swingLows.map(s => s.price),
      tolerance
    )

    // Get current price for distance calculation
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0

    return {
      resistance: resistanceZones.map(zone => ({
        level: zone.center,
        strength: zone.touches,
        distance: currentPrice > 0 ? ((zone.center - currentPrice) / currentPrice * 100).toFixed(2) + '%' : 'N/A'
      })),
      support: supportZones.map(zone => ({
        level: zone.center,
        strength: zone.touches,
        distance: currentPrice > 0 ? ((currentPrice - zone.center) / currentPrice * 100).toFixed(2) + '%' : 'N/A'
      })),
      nearestResistance: resistanceZones.find(z => z.center > currentPrice),
      nearestSupport: supportZones.slice().reverse().find(z => z.center < currentPrice)
    }
  }

  /**
   * Cluster price levels that are within tolerance of each other
   * @param {number[]} prices - Array of prices
   * @param {number} tolerance - Tolerance as percentage (0.002 = 0.2%)
   * @returns {Array} Clustered zones with center price and touch count
   */
  clusterLevels(prices, tolerance = 0.002) {
    if (prices.length === 0) return []

    // Sort prices
    const sorted = [...prices].sort((a, b) => a - b)
    const zones = []
    let currentZone = { prices: [sorted[0]], center: sorted[0] }

    for (let i = 1; i < sorted.length; i++) {
      const price = sorted[i]
      const diff = Math.abs(price - currentZone.center) / currentZone.center

      if (diff <= tolerance) {
        // Add to current zone
        currentZone.prices.push(price)
        currentZone.center = currentZone.prices.reduce((a, b) => a + b, 0) / currentZone.prices.length
      } else {
        // Save current zone and start new one
        zones.push({
          center: currentZone.center,
          touches: currentZone.prices.length,
          range: {
            low: Math.min(...currentZone.prices),
            high: Math.max(...currentZone.prices)
          }
        })
        currentZone = { prices: [price], center: price }
      }
    }

    // Don't forget the last zone
    zones.push({
      center: currentZone.center,
      touches: currentZone.prices.length,
      range: {
        low: Math.min(...currentZone.prices),
        high: Math.max(...currentZone.prices)
      }
    })

    // Sort by number of touches (most significant first)
    return zones.sort((a, b) => b.touches - a.touches)
  }

  /**
   * Calculate distance to nearest swing points from current price
   * @param {number} currentPrice - Current price
   * @param {Array} candles - Candle data
   * @param {number} lookback - Swing point lookback
   * @returns {Object} Distances to nearest swing high and low
   */
  getDistanceToSwings(currentPrice, candles, lookback = 5) {
    const highs = this.detectSwingHighs(candles, lookback)
    const lows = this.detectSwingLows(candles, lookback)

    // Find nearest swing high above current price
    const swingHighAbove = highs
      .filter(h => h.price > currentPrice)
      .sort((a, b) => a.price - b.price)[0]

    // Find nearest swing low below current price
    const swingLowBelow = lows
      .filter(l => l.price < currentPrice)
      .sort((a, b) => b.price - a.price)[0]

    // Find the most recent swing high and low regardless of position
    const mostRecentHigh = highs[highs.length - 1]
    const mostRecentLow = lows[lows.length - 1]

    return {
      distanceToSwingHigh: swingHighAbove
        ? (swingHighAbove.price - currentPrice) / currentPrice
        : mostRecentHigh
          ? (mostRecentHigh.price - currentPrice) / currentPrice
          : null,
      distanceToSwingLow: swingLowBelow
        ? (currentPrice - swingLowBelow.price) / currentPrice
        : mostRecentLow
          ? (currentPrice - mostRecentLow.price) / currentPrice
          : null,
      nearestSwingHigh: swingHighAbove || mostRecentHigh,
      nearestSwingLow: swingLowBelow || mostRecentLow,
      swingRange: mostRecentHigh && mostRecentLow
        ? mostRecentHigh.price - mostRecentLow.price
        : null,
      pricePositionInSwing: mostRecentHigh && mostRecentLow
        ? (currentPrice - mostRecentLow.price) / (mostRecentHigh.price - mostRecentLow.price)
        : null
    }
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const settings = getAllSettings()
    return {
      enabled: settings.swingTradingEnabled,
      cacheSize: this.cache.size,
      defaultLookback: settings.swingSwingPointLookback || 5
    }
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear()
  }
}

// Singleton instance
export const swingPointDetector = new SwingPointDetector()

// Named export for class
export { SwingPointDetector }

export default SwingPointDetector
