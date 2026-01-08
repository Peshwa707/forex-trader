/**
 * SQLite Database for Forex Trading Bot
 * Persistent storage for 24/7 operation
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/forex.db')

// Ensure data directory exists
import fs from 'fs'
const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

// Initialize tables
db.exec(`
  -- Bot settings
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Active trades
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    signal TEXT NOT NULL,
    entry_price REAL NOT NULL,
    current_price REAL,
    stop_loss REAL NOT NULL,
    take_profit REAL NOT NULL,
    trailing_stop REAL,
    position_size REAL NOT NULL,
    confidence INTEGER,
    reasoning TEXT,
    status TEXT DEFAULT 'OPEN',
    pnl_pips REAL DEFAULT 0,
    pnl REAL DEFAULT 0,
    close_reason TEXT,
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    last_update DATETIME
  );

  -- Prediction logs
  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL,
    signal TEXT NOT NULL,
    confidence INTEGER,
    entry_price REAL,
    stop_loss REAL,
    take_profit REAL,
    reasoning TEXT,
    outcome TEXT,
    correct INTEGER,
    pnl_pips REAL,
    price_at_resolution REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  );

  -- Price history for ML
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    price REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Bot activity log
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Create indexes
  CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
  CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(pair);
  CREATE INDEX IF NOT EXISTS idx_predictions_pair ON predictions(pair);
  CREATE INDEX IF NOT EXISTS idx_price_history_pair ON price_history(pair, timestamp);
`)

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  maxOpenTrades: 3,
  riskPerTrade: 1,
  accountBalance: 10000,
  minConfidence: 60,
  maxDailyTrades: 10,
  maxDailyLoss: 5,
  allowedPairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'EUR/GBP'],
  tradingHours: { start: 0, end: 24 }, // 24/7 for server
  useTrailingStop: true,
  trailingStopPips: 20,
  updateIntervalMs: 60000 // 1 minute
}

// Settings functions
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (row) {
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  }
  return DEFAULT_SETTINGS[key]
}

export function getAllSettings() {
  const settings = { ...DEFAULT_SETTINGS }
  const rows = db.prepare('SELECT key, value FROM settings').all()
  rows.forEach(row => {
    try {
      settings[row.key] = JSON.parse(row.value)
    } catch {
      settings[row.key] = row.value
    }
  })
  return settings
}

export function saveSetting(key, value) {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `)
  const val = typeof value === 'object' ? JSON.stringify(value) : String(value)
  stmt.run(key, val, val)
}

export function saveAllSettings(settings) {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `)
  const transaction = db.transaction((settings) => {
    for (const [key, value] of Object.entries(settings)) {
      const val = typeof value === 'object' ? JSON.stringify(value) : String(value)
      stmt.run(key, val, val)
    }
  })
  transaction(settings)
}

// Trade functions
export function getActiveTrades() {
  return db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY opened_at DESC').all('OPEN')
}

export function getTradeById(id) {
  return db.prepare('SELECT * FROM trades WHERE id = ?').get(id)
}

export function createTrade(trade) {
  const stmt = db.prepare(`
    INSERT INTO trades (pair, direction, signal, entry_price, current_price, stop_loss, take_profit,
                        trailing_stop, position_size, confidence, reasoning, status, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', CURRENT_TIMESTAMP)
  `)
  const result = stmt.run(
    trade.pair, trade.direction, trade.signal, trade.entryPrice, trade.entryPrice,
    trade.stopLoss, trade.takeProfit, trade.trailingStop || trade.stopLoss,
    trade.positionSize, trade.confidence, trade.reasoning
  )
  return { ...trade, id: result.lastInsertRowid }
}

export function updateTrade(id, updates) {
  const fields = []
  const values = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    fields.push(`${dbKey} = ?`)
    values.push(value)
  }
  fields.push('last_update = CURRENT_TIMESTAMP')
  values.push(id)

  db.prepare(`UPDATE trades SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getTradeById(id)
}

export function closeTrade(id, exitPrice, reason, pnlPips, pnl) {
  db.prepare(`
    UPDATE trades SET
      status = 'CLOSED',
      current_price = ?,
      close_reason = ?,
      pnl_pips = ?,
      pnl = ?,
      closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(exitPrice, reason, pnlPips, pnl, id)
  return getTradeById(id)
}

export function getTradeHistory(limit = 100) {
  return db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY closed_at DESC LIMIT ?').all('CLOSED', limit)
}

export function getTodaysTrades() {
  return db.prepare(`
    SELECT * FROM trades
    WHERE date(opened_at) = date('now')
    ORDER BY opened_at DESC
  `).all()
}

// Prediction functions
export function logPrediction(prediction) {
  const stmt = db.prepare(`
    INSERT INTO predictions (pair, direction, signal, confidence, entry_price, stop_loss, take_profit, reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    prediction.pair, prediction.direction, prediction.signal, prediction.confidence,
    prediction.entryPrice, prediction.stopLoss, prediction.takeProfit, prediction.reasoning
  )
  return result.lastInsertRowid
}

export function resolvePrediction(id, outcome, correct, pnlPips, priceAtResolution) {
  db.prepare(`
    UPDATE predictions SET
      outcome = ?,
      correct = ?,
      pnl_pips = ?,
      price_at_resolution = ?,
      resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(outcome, correct ? 1 : 0, pnlPips, priceAtResolution, id)
}

export function getPredictions(limit = 100) {
  return db.prepare('SELECT * FROM predictions ORDER BY created_at DESC LIMIT ?').all(limit)
}

export function getUnresolvedPredictions() {
  return db.prepare('SELECT * FROM predictions WHERE outcome IS NULL ORDER BY created_at DESC').all()
}

// Price history functions
export function savePriceHistory(pair, price) {
  db.prepare('INSERT INTO price_history (pair, price) VALUES (?, ?)').run(pair, price)
}

export function getPriceHistory(pair, limit = 100) {
  return db.prepare(`
    SELECT price, timestamp FROM price_history
    WHERE pair = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(pair, limit)
}

export function cleanOldPriceHistory(daysToKeep = 7) {
  db.prepare(`
    DELETE FROM price_history
    WHERE timestamp < datetime('now', '-' || ? || ' days')
  `).run(daysToKeep)
}

// Activity log functions
export function logActivity(type, message, data = null) {
  db.prepare(`
    INSERT INTO activity_log (type, message, data)
    VALUES (?, ?, ?)
  `).run(type, message, data ? JSON.stringify(data) : null)
}

export function getActivityLog(limit = 50) {
  return db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit)
}

// Statistics functions
export function getTradingStats() {
  const settings = getAllSettings()
  const history = getTradeHistory(500)
  const activeTrades = getActiveTrades()

  if (history.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: '0.0',
      totalPnl: '0.00',
      totalPips: '0.0',
      avgWin: '0.00',
      avgLoss: '0.00',
      profitFactor: '0.00',
      accountBalance: settings.accountBalance.toFixed(2),
      activeTrades: activeTrades.length,
      todaysPnl: '0.00',
      todaysTrades: 0
    }
  }

  const winners = history.filter(t => t.pnl > 0)
  const losers = history.filter(t => t.pnl < 0)

  const totalPnl = history.reduce((sum, t) => sum + (t.pnl || 0), 0)
  const totalPips = history.reduce((sum, t) => sum + (t.pnl_pips || 0), 0)

  const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0))

  const avgWin = winners.length > 0 ? grossProfit / winners.length : 0
  const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0

  // Today's stats
  const todaysTrades = getTodaysTrades().filter(t => t.status === 'CLOSED')
  const todaysPnl = todaysTrades.reduce((sum, t) => sum + (t.pnl || 0), 0)

  return {
    totalTrades: history.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: ((winners.length / history.length) * 100).toFixed(1),
    totalPnl: totalPnl.toFixed(2),
    totalPips: totalPips.toFixed(1),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞',
    accountBalance: settings.accountBalance.toFixed(2),
    activeTrades: activeTrades.length,
    todaysPnl: todaysPnl.toFixed(2),
    todaysTrades: todaysTrades.length
  }
}

export default db
