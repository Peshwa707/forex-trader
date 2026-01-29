/**
 * Swing Data Collector
 * Captures training data for the swing direction ML model
 * Records features at entry and outcomes after exit
 */

import {
  getAllSettings,
  createSwingTrainingRecord,
  updateSwingTrainingOutcome,
  getSwingTrainingDataCount
} from '../../database.js'
import { swingFeatureExtractor } from './SwingFeatureExtractor.js'

class SwingDataCollector {
  constructor() {
    // Track active trades being monitored
    this.activeTradeRecords = new Map()
  }

  /**
   * Record entry data for a new swing trade
   * @param {Object} trade - The trade object
   * @param {string} pair - Currency pair
   * @param {Array} dailyCandles - Daily candles at entry
   * @param {Array} priceHistory - Tick price history at entry
   * @param {Object} indicators - Technical indicators at entry
   * @param {string} strategy - Strategy used for entry
   * @returns {number} Training record ID
   */
  async recordEntry(trade, pair, dailyCandles, priceHistory, indicators, strategy) {
    const settings = getAllSettings()

    if (!settings.swingTradingEnabled) {
      return null
    }

    try {
      // Extract features at entry time
      const features = swingFeatureExtractor.extractFeatures(
        pair,
        dailyCandles,
        null, // Weekly candles optional
        priceHistory,
        indicators
      )

      // Create training record
      const recordId = createSwingTrainingRecord({
        tradeId: trade.id,
        pair,
        // Multi-TF features
        dailyTrend: features.dailyTrend,
        weeklyTrend: features.weeklyTrend,
        dailyMomentum: features.dailyMomentum,
        htfAlignment: features.htfAlignment,
        daysInTrend: Math.round(features.daysInTrend * 30), // Denormalize
        trendStartDistance: features.trendStartDistance,
        // Trend strength features
        adx: features.adx * 100, // Denormalize
        adxSlope: features.adxSlope,
        diSeparation: features.diSeparation,
        trendConsistency: features.trendConsistency,
        hurstExponent: features.hurstExponent,
        // Price structure features
        distanceToSwingHigh: features.distanceToSwingHigh,
        distanceToSwingLow: features.distanceToSwingLow,
        swingRange: features.swingRange,
        pricePositionInSwing: features.pricePositionInSwing,
        hhllPattern: features.hhllPattern,
        // S/R and Fib features
        nearestSupportDistance: features.nearestSupportDistance,
        nearestResistanceDistance: features.nearestResistanceDistance,
        atSupportResistance: features.atSupportResistance,
        fibLevel: features.fibLevel,
        // Entry metadata
        entryDate: new Date().toISOString().split('T')[0],
        entryPrice: trade.entry_price,
        strategyUsed: strategy
      })

      // Track for later outcome recording
      this.activeTradeRecords.set(trade.id, {
        recordId,
        entryDate: new Date(),
        entryPrice: trade.entry_price,
        direction: trade.direction,
        maxFavorable: 0,
        maxAdverse: 0,
        dailyPrices: [trade.entry_price] // Track daily closes for optimal exit analysis
      })

      console.log(`[SwingDataCollector] Recorded entry for trade ${trade.id}, record ${recordId}`)

      return recordId
    } catch (error) {
      console.error('[SwingDataCollector] Error recording entry:', error.message)
      return null
    }
  }

  /**
   * Update tracking data during trade (called daily or on price updates)
   * @param {number} tradeId - Trade ID
   * @param {number} currentPrice - Current price
   */
  updateTradeTracking(tradeId, currentPrice) {
    const record = this.activeTradeRecords.get(tradeId)
    if (!record) return

    const entryPrice = record.entryPrice
    const direction = record.direction

    // Calculate excursion
    let favorable, adverse
    if (direction === 'UP') {
      favorable = currentPrice - entryPrice
      adverse = entryPrice - currentPrice
    } else {
      favorable = entryPrice - currentPrice
      adverse = currentPrice - entryPrice
    }

    // Update max excursions
    if (favorable > record.maxFavorable) {
      record.maxFavorable = favorable
      record.maxFavorableDay = Math.floor((new Date() - record.entryDate) / (1000 * 60 * 60 * 24))
    }
    if (adverse > record.maxAdverse) {
      record.maxAdverse = adverse
    }

    // Track daily close
    record.dailyPrices.push(currentPrice)
  }

  /**
   * Record exit data when a swing trade closes
   * @param {Object} trade - The closed trade object
   */
  async recordExit(trade) {
    const record = this.activeTradeRecords.get(trade.id)
    if (!record) {
      console.log(`[SwingDataCollector] No active record for trade ${trade.id}`)
      return
    }

    try {
      const entryPrice = record.entryPrice
      const exitPrice = trade.current_price || trade.exit_price
      const direction = record.direction

      // Calculate magnitude in pips
      const pipValue = trade.pair?.includes('JPY') ? 0.01 : 0.0001
      const priceDiff = direction === 'UP'
        ? exitPrice - entryPrice
        : entryPrice - exitPrice
      const magnitudePips = priceDiff / pipValue

      // Calculate hold days
      const entryDate = record.entryDate
      const exitDate = trade.closed_at ? new Date(trade.closed_at) : new Date()
      const holdDays = Math.floor((exitDate - entryDate) / (1000 * 60 * 60 * 24))

      // Determine direction label based on actual outcome
      let directionLabel = 'NEUTRAL'
      if (magnitudePips > 20) directionLabel = 'UP'
      else if (magnitudePips < -20) directionLabel = 'DOWN'

      // Determine outcome
      const outcome = trade.pnl >= 0 ? 'WIN' : 'LOSS'

      // Find optimal exit day (day with max favorable excursion)
      const optimalExitDay = record.maxFavorableDay || holdDays

      // Update training record with outcome
      updateSwingTrainingOutcome(trade.id, {
        directionLabel,
        magnitudePips,
        holdDays,
        maxFavorableDays: record.maxFavorableDay || holdDays,
        optimalExitDay,
        outcome,
        exitDate: exitDate.toISOString().split('T')[0],
        exitPrice
      })

      // Clean up
      this.activeTradeRecords.delete(trade.id)

      console.log(`[SwingDataCollector] Recorded exit for trade ${trade.id}: ${outcome}, ${magnitudePips.toFixed(1)} pips, ${holdDays} days`)

    } catch (error) {
      console.error('[SwingDataCollector] Error recording exit:', error.message)
    }
  }

  /**
   * Generate synthetic training data from historical candles
   * This can be used to bootstrap the model before live trading
   * @param {string} pair - Currency pair
   * @param {Array} historicalCandles - Array of historical daily candles
   * @param {number} lookforward - Days to look forward for labeling (default 7)
   * @returns {Object} Generation results
   */
  async generateSyntheticData(pair, historicalCandles, lookforward = 7) {
    if (!historicalCandles || historicalCandles.length < 50) {
      return {
        success: false,
        reason: 'Insufficient historical data (need 50+ candles)'
      }
    }

    let generated = 0
    let skipped = 0

    // Process each candle as a potential entry point
    for (let i = 30; i < historicalCandles.length - lookforward; i++) {
      // Use candles up to this point for feature extraction
      const candlesAtEntry = historicalCandles.slice(0, i + 1)
      const entryCandle = historicalCandles[i]

      // Simple price array from closes
      const priceHistory = candlesAtEntry.map(c => c.close)

      // Extract features
      const features = swingFeatureExtractor.extractFeatures(
        pair,
        candlesAtEntry,
        null,
        priceHistory,
        {} // No indicators for synthetic data
      )

      // Look forward to determine outcome
      const futureCandles = historicalCandles.slice(i + 1, i + 1 + lookforward)
      if (futureCandles.length < lookforward) {
        skipped++
        continue
      }

      // Calculate outcome
      const entryPrice = entryCandle.close
      const futurePrices = futureCandles.map(c => c.close)
      const maxPrice = Math.max(...futurePrices)
      const minPrice = Math.min(...futurePrices)
      const finalPrice = futurePrices[futurePrices.length - 1]

      const pipValue = pair.includes('JPY') ? 0.01 : 0.0001
      const magnitudePips = (finalPrice - entryPrice) / pipValue

      // Determine direction
      let directionLabel = 'NEUTRAL'
      if (magnitudePips > 30) directionLabel = 'UP'
      else if (magnitudePips < -30) directionLabel = 'DOWN'

      // Determine outcome (simplified: positive magnitude = win)
      const outcome = magnitudePips > 0 ? 'WIN' : 'LOSS'

      // Find optimal exit day
      let optimalExitDay = lookforward
      let maxFavorable = 0
      for (let d = 0; d < futurePrices.length; d++) {
        const favorable = Math.abs(futurePrices[d] - entryPrice)
        if (favorable > maxFavorable) {
          maxFavorable = favorable
          optimalExitDay = d + 1
        }
      }

      // Create record
      try {
        createSwingTrainingRecord({
          tradeId: null, // Synthetic, no actual trade
          pair,
          dailyTrend: features.dailyTrend,
          weeklyTrend: features.weeklyTrend,
          dailyMomentum: features.dailyMomentum,
          htfAlignment: features.htfAlignment,
          daysInTrend: Math.round(features.daysInTrend * 30),
          trendStartDistance: features.trendStartDistance,
          adx: features.adx * 100,
          adxSlope: features.adxSlope,
          diSeparation: features.diSeparation,
          trendConsistency: features.trendConsistency,
          hurstExponent: features.hurstExponent,
          distanceToSwingHigh: features.distanceToSwingHigh,
          distanceToSwingLow: features.distanceToSwingLow,
          swingRange: features.swingRange,
          pricePositionInSwing: features.pricePositionInSwing,
          hhllPattern: features.hhllPattern,
          nearestSupportDistance: features.nearestSupportDistance,
          nearestResistanceDistance: features.nearestResistanceDistance,
          atSupportResistance: features.atSupportResistance,
          fibLevel: features.fibLevel,
          entryDate: entryCandle.date,
          entryPrice,
          strategyUsed: 'SYNTHETIC'
        })

        // Immediately update with outcome
        // Note: This is a simplified approach - in real implementation,
        // you'd need to track the trade_id from createSwingTrainingRecord
        generated++

      } catch (error) {
        skipped++
      }
    }

    return {
      success: true,
      generated,
      skipped,
      total: historicalCandles.length - 30 - lookforward,
      totalTrainingData: getSwingTrainingDataCount()
    }
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    return {
      activeRecords: this.activeTradeRecords.size,
      totalTrainingData: getSwingTrainingDataCount(),
      activeTradeIds: [...this.activeTradeRecords.keys()]
    }
  }

  /**
   * Clear all tracking (useful for testing)
   */
  clear() {
    this.activeTradeRecords.clear()
  }
}

// Singleton instance
export const swingDataCollector = new SwingDataCollector()

export default SwingDataCollector
