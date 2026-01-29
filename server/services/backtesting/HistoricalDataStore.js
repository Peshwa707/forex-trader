/**
 * Historical Data Store
 * Part of Phase A: Trust Foundation - Backtesting System
 *
 * Fetches and caches historical OHLC data for backtesting
 */

import { getDb } from '../../database.js'

// Supported pairs for backtesting
const FOREX_PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD']

/**
 * Initialize the historical data table
 */
export function initHistoricalDataTable() {
  const db = getDb()

  db.run(`
    CREATE TABLE IF NOT EXISTS historical_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL DEFAULT 0,
      source TEXT DEFAULT 'generated',
      UNIQUE(pair, timestamp)
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_historical_pair_time ON historical_prices(pair, timestamp)`)
}

/**
 * Get historical data for a pair within a date range
 */
export function getHistoricalData(pair, startDate, endDate) {
  const db = getDb()
  const startTs = new Date(startDate).getTime()
  const endTs = new Date(endDate).getTime()

  const results = db.exec(`
    SELECT timestamp, open, high, low, close, volume
    FROM historical_prices
    WHERE pair = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `, [pair, startTs, endTs])

  if (!results.length) return []

  return results[0].values.map(row => ({
    timestamp: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5]
  }))
}

/**
 * Store historical OHLC data
 */
export function storeHistoricalData(pair, candles, source = 'api') {
  const db = getDb()

  for (const candle of candles) {
    try {
      db.run(`
        INSERT OR REPLACE INTO historical_prices (pair, timestamp, open, high, low, close, volume, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [pair, candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume || 0, source])
    } catch (err) {
      console.warn(`Failed to store candle for ${pair}:`, err.message)
    }
  }
}

/**
 * Generate synthetic historical data for backtesting
 * Uses random walk with realistic forex characteristics
 */
export function generateSyntheticData(pair, startDate, endDate, intervalMinutes = 60) {
  const candles = []
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  const intervalMs = intervalMinutes * 60 * 1000

  // Starting prices based on pair
  const basePrices = {
    'EUR/USD': 1.0850,
    'GBP/USD': 1.2700,
    'USD/JPY': 149.50,
    'USD/CHF': 0.8800,
    'AUD/USD': 0.6550,
    'USD/CAD': 1.3600
  }

  let price = basePrices[pair] || 1.0000
  const isJPY = pair.includes('JPY')
  const pipSize = isJPY ? 0.01 : 0.0001

  // Volatility settings per pair (ATR in pips)
  const volatility = isJPY ? 50 : 10 // Daily ATR in pips

  for (let ts = start; ts <= end; ts += intervalMs) {
    const date = new Date(ts)
    const hour = date.getUTCHours()
    const dayOfWeek = date.getUTCDay()

    // Skip weekends (forex market closed)
    if (dayOfWeek === 0 || dayOfWeek === 6) continue

    // Volatility multiplier based on session
    let sessionMultiplier = 0.7 // Default (Asian)
    if (hour >= 7 && hour < 16) sessionMultiplier = 1.2 // London
    if (hour >= 13 && hour < 17) sessionMultiplier = 1.5 // London-NY overlap
    if (hour >= 13 && hour < 22) sessionMultiplier = 1.0 // NY

    // Generate OHLC
    const hourlyVolatility = (volatility / 24) * sessionMultiplier * pipSize
    const drift = (Math.random() - 0.5) * hourlyVolatility * 2

    const open = price
    const change1 = (Math.random() - 0.5) * hourlyVolatility
    const change2 = (Math.random() - 0.5) * hourlyVolatility
    const change3 = drift

    const high = open + Math.abs(change1) + Math.abs(change2) * 0.5
    const low = open - Math.abs(change1) - Math.abs(change2) * 0.5
    const close = open + change3

    price = close // For next candle

    candles.push({
      timestamp: ts,
      open: roundPrice(open, pair),
      high: roundPrice(Math.max(open, high, close), pair),
      low: roundPrice(Math.min(open, low, close), pair),
      close: roundPrice(close, pair),
      volume: Math.floor(Math.random() * 1000000) + 100000
    })
  }

  return candles
}

function roundPrice(price, pair) {
  const decimals = pair.includes('JPY') ? 3 : 5
  return parseFloat(price.toFixed(decimals))
}

/**
 * Ensure historical data exists for backtesting period
 * Generates synthetic data if no real data available
 */
export function ensureHistoricalData(pair, startDate, endDate, intervalMinutes = 60) {
  initHistoricalDataTable()

  const existing = getHistoricalData(pair, startDate, endDate)

  if (existing.length < 100) {
    console.log(`Generating synthetic data for ${pair} (${startDate} to ${endDate})`)
    const syntheticData = generateSyntheticData(pair, startDate, endDate, intervalMinutes)
    storeHistoricalData(pair, syntheticData, 'synthetic')
    return syntheticData
  }

  return existing
}

/**
 * Get available date range for a pair
 */
export function getAvailableDateRange(pair) {
  const db = getDb()
  const results = db.exec(`
    SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts, COUNT(*) as count
    FROM historical_prices
    WHERE pair = ?
  `, [pair])

  if (!results.length || !results[0].values[0][0]) {
    return { minDate: null, maxDate: null, count: 0 }
  }

  const row = results[0].values[0]
  return {
    minDate: new Date(row[0]),
    maxDate: new Date(row[1]),
    count: row[2]
  }
}

/**
 * Get all available pairs with data
 */
export function getAvailablePairs() {
  const db = getDb()
  const results = db.exec(`
    SELECT pair, COUNT(*) as candles, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
    FROM historical_prices
    GROUP BY pair
  `)

  if (!results.length) return []

  return results[0].values.map(row => ({
    pair: row[0],
    candles: row[1],
    minDate: new Date(row[2]),
    maxDate: new Date(row[3])
  }))
}

/**
 * Clear all historical data (for testing)
 */
export function clearHistoricalData() {
  const db = getDb()
  db.run('DELETE FROM historical_prices')
}

export { FOREX_PAIRS }
