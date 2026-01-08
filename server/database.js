/**
 * SQLite Database for Forex Trading Bot
 * Using sql.js (pure JavaScript, no native compilation)
 */

import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/forex.db')

// Ensure data directory exists
const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

let db = null
let SQL = null

// Initialize database
async function initDatabase() {
  if (db) return db

  SQL = await initSqlJs()

  // Load existing database or create new one
  try {
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath)
      db = new SQL.Database(fileBuffer)
      console.log('Loaded existing database')
    } else {
      db = new SQL.Database()
      console.log('Created new database')
    }
  } catch (error) {
    console.error('Error loading database, creating new one:', error.message)
    db = new SQL.Database()
  }

  // Initialize tables
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run(`
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
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      last_update TEXT
    )
  `)

  db.run(`
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      price REAL NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT,
      data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status)')
  db.run('CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(pair)')
  db.run('CREATE INDEX IF NOT EXISTS idx_predictions_pair ON predictions(pair)')

  saveDatabase()
  return db
}

// Save database to file
function saveDatabase() {
  if (!db) return
  try {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(dbPath, buffer)
  } catch (error) {
    console.error('Error saving database:', error.message)
  }
}

// Auto-save every 30 seconds
setInterval(saveDatabase, 30000)

// Helper to run queries
function query(sql, params = []) {
  if (!db) throw new Error('Database not initialized')
  return db.exec(sql, params)
}

function run(sql, params = []) {
  if (!db) throw new Error('Database not initialized')
  db.run(sql, params)
  saveDatabase()
}

function getOne(sql, params = []) {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare(sql)
  stmt.bind(params)
  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return row
  }
  stmt.free()
  return null
}

function getAll(sql, params = []) {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

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
  tradingHours: { start: 0, end: 24 },
  useTrailingStop: true,
  trailingStopPips: 20,
  updateIntervalMs: 60000
}

// Settings functions
export function getSetting(key) {
  const row = getOne('SELECT value FROM settings WHERE key = ?', [key])
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
  const rows = getAll('SELECT key, value FROM settings')
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
  const val = typeof value === 'object' ? JSON.stringify(value) : String(value)
  run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))', [key, val])
}

export function saveAllSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    saveSetting(key, value)
  }
}

// Trade functions
export function getActiveTrades() {
  return getAll('SELECT * FROM trades WHERE status = ? ORDER BY opened_at DESC', ['OPEN'])
}

export function getTradeById(id) {
  return getOne('SELECT * FROM trades WHERE id = ?', [id])
}

export function createTrade(trade) {
  run(`
    INSERT INTO trades (pair, direction, signal, entry_price, current_price, stop_loss, take_profit,
                        trailing_stop, position_size, confidence, reasoning, status, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', datetime('now'))
  `, [
    trade.pair, trade.direction, trade.signal, trade.entryPrice, trade.entryPrice,
    trade.stopLoss, trade.takeProfit, trade.trailingStop || trade.stopLoss,
    trade.positionSize, trade.confidence, trade.reasoning
  ])

  const result = getOne('SELECT last_insert_rowid() as id')
  return { ...trade, id: result.id }
}

export function updateTrade(id, updates) {
  const fields = []
  const values = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    fields.push(`${dbKey} = ?`)
    values.push(value)
  }
  fields.push('last_update = datetime("now")')
  values.push(id)

  run(`UPDATE trades SET ${fields.join(', ')} WHERE id = ?`, values)
  return getTradeById(id)
}

export function closeTrade(id, exitPrice, reason, pnlPips, pnl) {
  run(`
    UPDATE trades SET
      status = 'CLOSED',
      current_price = ?,
      close_reason = ?,
      pnl_pips = ?,
      pnl = ?,
      closed_at = datetime('now')
    WHERE id = ?
  `, [exitPrice, reason, pnlPips, pnl, id])
  return getTradeById(id)
}

export function getTradeHistory(limit = 100) {
  return getAll('SELECT * FROM trades WHERE status = ? ORDER BY closed_at DESC LIMIT ?', ['CLOSED', limit])
}

export function getTodaysTrades() {
  return getAll(`
    SELECT * FROM trades
    WHERE date(opened_at) = date('now')
    ORDER BY opened_at DESC
  `)
}

// Prediction functions
export function logPrediction(prediction) {
  run(`
    INSERT INTO predictions (pair, direction, signal, confidence, entry_price, stop_loss, take_profit, reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    prediction.pair, prediction.direction, prediction.signal, prediction.confidence,
    prediction.entryPrice, prediction.stopLoss, prediction.takeProfit, prediction.reasoning
  ])
  const result = getOne('SELECT last_insert_rowid() as id')
  return result.id
}

export function resolvePrediction(id, outcome, correct, pnlPips, priceAtResolution) {
  run(`
    UPDATE predictions SET
      outcome = ?,
      correct = ?,
      pnl_pips = ?,
      price_at_resolution = ?,
      resolved_at = datetime('now')
    WHERE id = ?
  `, [outcome, correct ? 1 : 0, pnlPips, priceAtResolution, id])
}

export function getPredictions(limit = 100) {
  return getAll('SELECT * FROM predictions ORDER BY created_at DESC LIMIT ?', [limit])
}

export function getUnresolvedPredictions() {
  return getAll('SELECT * FROM predictions WHERE outcome IS NULL ORDER BY created_at DESC')
}

// Price history functions
export function savePriceHistory(pair, price) {
  run('INSERT INTO price_history (pair, price) VALUES (?, ?)', [pair, price])
}

export function getPriceHistory(pair, limit = 100) {
  return getAll(`
    SELECT price, timestamp FROM price_history
    WHERE pair = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `, [pair, limit])
}

export function cleanOldPriceHistory(daysToKeep = 7) {
  run(`
    DELETE FROM price_history
    WHERE timestamp < datetime('now', '-' || ? || ' days')
  `, [daysToKeep])
}

// Activity log functions
export function logActivity(type, message, data = null) {
  run(`
    INSERT INTO activity_log (type, message, data)
    VALUES (?, ?, ?)
  `, [type, message, data ? JSON.stringify(data) : null])
}

export function getActivityLog(limit = 50) {
  return getAll('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?', [limit])
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

// Initialize on import
await initDatabase()

export default db
