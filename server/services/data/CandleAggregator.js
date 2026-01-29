/**
 * Candle Aggregator Service
 * Aggregates tick-level price data into daily OHLC candles for swing trading
 */

import * as db from '../../database.js'

/**
 * @typedef {Object} DailyCandle
 * @property {string} pair - Currency pair (e.g., 'EUR/USD')
 * @property {string} date - Date in YYYY-MM-DD format
 * @property {number} open - Opening price
 * @property {number} high - Highest price
 * @property {number} low - Lowest price
 * @property {number} close - Closing price
 * @property {number} swingHigh - 1 if this is a swing high, 0 otherwise
 * @property {number} swingLow - 1 if this is a swing low, 0 otherwise
 */

class CandleAggregator {
  constructor() {
    // In-memory current day candles for real-time updates
    this.currentDayCandles = new Map()
    this.initialized = false
  }

  /**
   * Initialize the aggregator, ensuring tables exist
   */
  async initialize() {
    if (this.initialized) return

    // Tables are created in database.js initDatabase()
    this.initialized = true
    console.log('[CandleAggregator] Initialized')
  }

  /**
   * Get the current UTC date string
   * @returns {string} Date in YYYY-MM-DD format
   */
  getCurrentDateUTC() {
    const now = new Date()
    return now.toISOString().split('T')[0]
  }

  /**
   * Update the current day's candle with a new price tick
   * Called on each price update in the bot cycle
   * @param {string} pair - Currency pair
   * @param {number} price - Current price
   * @param {Date} [timestamp] - Optional timestamp (defaults to now)
   */
  updateCurrentDayCandle(pair, price, timestamp = new Date()) {
    const date = timestamp.toISOString().split('T')[0]
    const key = `${pair}:${date}`

    let candle = this.currentDayCandles.get(key)

    if (!candle) {
      // Check if we have this candle in the database already
      const existing = db.getDailyCandle(pair, date)
      if (existing) {
        candle = {
          pair,
          date,
          open: existing.open,
          high: existing.high,
          low: existing.low,
          close: existing.close
        }
      } else {
        // New candle
        candle = {
          pair,
          date,
          open: price,
          high: price,
          low: price,
          close: price
        }
      }
      this.currentDayCandles.set(key, candle)
    }

    // Update OHLC
    candle.high = Math.max(candle.high, price)
    candle.low = Math.min(candle.low, price)
    candle.close = price

    return candle
  }

  /**
   * Finalize and save the current day candles to database
   * Called at end of trading day or when day changes
   * @param {string} [pair] - Optional pair to finalize (all if not specified)
   */
  finalizeDayCandles(pair = null) {
    const today = this.getCurrentDateUTC()
    const finalized = []

    for (const [key, candle] of this.currentDayCandles.entries()) {
      // Skip if not the pair we want (when pair specified)
      if (pair && !key.startsWith(pair + ':')) continue

      // Skip today's candle (it's still being updated)
      if (candle.date === today) continue

      // Save to database
      db.saveDailyCandle(candle)
      finalized.push(candle)

      // Remove from current tracking
      this.currentDayCandles.delete(key)
    }

    if (finalized.length > 0) {
      console.log(`[CandleAggregator] Finalized ${finalized.length} candles`)
    }

    return finalized
  }

  /**
   * Aggregate historical tick data to daily candles
   * @param {string} pair - Currency pair
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {DailyCandle[]} Aggregated candles
   */
  aggregateTicksToDaily(pair, startDate, endDate) {
    // Get price history from database
    const priceHistory = db.getPriceHistoryByDateRange(pair, startDate, endDate)

    if (priceHistory.length === 0) {
      console.log(`[CandleAggregator] No price history found for ${pair} from ${startDate} to ${endDate}`)
      return []
    }

    // Group by date
    const byDate = new Map()

    for (const entry of priceHistory) {
      const date = new Date(entry.timestamp).toISOString().split('T')[0]

      if (!byDate.has(date)) {
        byDate.set(date, [])
      }
      byDate.get(date).push(entry.price)
    }

    // Create candles
    const candles = []

    for (const [date, prices] of byDate.entries()) {
      if (prices.length === 0) continue

      const candle = {
        pair,
        date,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        swingHigh: 0,
        swingLow: 0
      }

      candles.push(candle)
    }

    // Sort by date
    candles.sort((a, b) => a.date.localeCompare(b.date))

    return candles
  }

  /**
   * Backfill daily candles from historical tick data
   * @param {string} pair - Currency pair
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Object} Result with count and any errors
   */
  backfillDailyCandles(pair, startDate, endDate) {
    const candles = this.aggregateTicksToDaily(pair, startDate, endDate)

    let saved = 0
    let skipped = 0
    const errors = []

    for (const candle of candles) {
      try {
        // Check if already exists
        const existing = db.getDailyCandle(pair, candle.date)
        if (existing) {
          skipped++
          continue
        }

        db.saveDailyCandle(candle)
        saved++
      } catch (error) {
        errors.push({ date: candle.date, error: error.message })
      }
    }

    console.log(`[CandleAggregator] Backfilled ${pair}: ${saved} saved, ${skipped} skipped, ${errors.length} errors`)

    return {
      pair,
      startDate,
      endDate,
      total: candles.length,
      saved,
      skipped,
      errors
    }
  }

  /**
   * Get daily candles for a pair
   * @param {string} pair - Currency pair
   * @param {number} [limit=100] - Maximum number of candles to return
   * @returns {DailyCandle[]} Array of daily candles (newest first)
   */
  getDailyCandles(pair, limit = 100) {
    return db.getDailyCandles(pair, limit)
  }

  /**
   * Get daily candles within a date range
   * @param {string} pair - Currency pair
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {DailyCandle[]} Array of daily candles
   */
  getDailyCandlesByRange(pair, startDate, endDate) {
    return db.getDailyCandlesByRange(pair, startDate, endDate)
  }

  /**
   * Get the most recent N candles for technical analysis
   * Includes current day's partial candle if available
   * @param {string} pair - Currency pair
   * @param {number} count - Number of candles to retrieve
   * @returns {DailyCandle[]} Array of candles (oldest to newest for analysis)
   */
  getCandlesForAnalysis(pair, count) {
    // Get completed candles from database
    const candles = db.getDailyCandles(pair, count)

    // Add current day's partial candle if available
    const today = this.getCurrentDateUTC()
    const currentKey = `${pair}:${today}`
    const currentCandle = this.currentDayCandles.get(currentKey)

    if (currentCandle) {
      // Check if we already have today in the list
      const hasToday = candles.some(c => c.date === today)
      if (!hasToday) {
        candles.unshift({ ...currentCandle, isPartial: true })
      }
    }

    // Return in chronological order (oldest first) for analysis
    return candles.slice(0, count).reverse()
  }

  /**
   * Mark swing points on existing candles
   * @param {string} pair - Currency pair
   * @param {number} lookback - Number of bars to look back/forward for swing confirmation
   */
  async markSwingPoints(pair, lookback = 5) {
    const candles = this.getDailyCandles(pair, 500) // Get enough history

    if (candles.length < lookback * 2 + 1) {
      console.log(`[CandleAggregator] Not enough candles to mark swing points for ${pair}`)
      return
    }

    // Candles are newest first, reverse for chronological analysis
    const chronological = [...candles].reverse()
    let markedCount = 0

    for (let i = lookback; i < chronological.length - lookback; i++) {
      const current = chronological[i]
      let isSwingHigh = true
      let isSwingLow = true

      // Check lookback bars on each side
      for (let j = 1; j <= lookback; j++) {
        const before = chronological[i - j]
        const after = chronological[i + j]

        // Swing high: current high is higher than surrounding highs
        if (current.high <= before.high || current.high <= after.high) {
          isSwingHigh = false
        }

        // Swing low: current low is lower than surrounding lows
        if (current.low >= before.low || current.low >= after.low) {
          isSwingLow = false
        }
      }

      // Update if swing point status changed
      const newSwingHigh = isSwingHigh ? 1 : 0
      const newSwingLow = isSwingLow ? 1 : 0

      if (current.swing_high !== newSwingHigh || current.swing_low !== newSwingLow) {
        db.updateDailyCandle(pair, current.date, {
          swing_high: newSwingHigh,
          swing_low: newSwingLow
        })
        markedCount++
      }
    }

    console.log(`[CandleAggregator] Marked ${markedCount} swing points for ${pair}`)
  }

  /**
   * Get current state for status reporting
   * @returns {Object} Current state
   */
  getStatus() {
    return {
      initialized: this.initialized,
      currentDayCandles: this.currentDayCandles.size,
      pairs: [...new Set([...this.currentDayCandles.keys()].map(k => k.split(':')[0]))]
    }
  }
}

// Singleton instance
export const candleAggregator = new CandleAggregator()

export default CandleAggregator
