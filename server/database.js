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

  // Enable foreign key constraints
  db.run('PRAGMA foreign_keys = ON')

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

  // IB Configuration table
  db.run(`
    CREATE TABLE IF NOT EXISTS ib_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // IB Orders table - tracks orders placed via IB
  db.run(`
    CREATE TABLE IF NOT EXISTS ib_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ib_order_id INTEGER UNIQUE,
      ib_perm_id INTEGER,
      local_trade_id INTEGER,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      order_type TEXT DEFAULT 'MKT',
      status TEXT DEFAULT 'PENDING',
      quantity REAL NOT NULL,
      limit_price REAL,
      avg_fill_price REAL,
      filled_quantity REAL DEFAULT 0,
      commission REAL DEFAULT 0,
      placed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      filled_at TEXT,
      cancelled_at TEXT,
      error_message TEXT,
      FOREIGN KEY (local_trade_id) REFERENCES trades(id)
    )
  `)

  // IB Positions table - current positions from IB
  db.run(`
    CREATE TABLE IF NOT EXISTS ib_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      pair TEXT NOT NULL,
      position REAL NOT NULL,
      avg_cost REAL NOT NULL,
      unrealized_pnl REAL DEFAULT 0,
      realized_pnl REAL DEFAULT 0,
      market_value REAL DEFAULT 0,
      last_update TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account, pair)
    )
  `)

  // IB Account table - account info from IB
  db.run(`
    CREATE TABLE IF NOT EXISTS ib_account (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      currency TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, key, currency)
    )
  `)

  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status)')
  db.run('CREATE INDEX IF NOT EXISTS idx_trades_pair ON trades(pair)')
  db.run('CREATE INDEX IF NOT EXISTS idx_predictions_pair ON predictions(pair)')
  db.run('CREATE INDEX IF NOT EXISTS idx_ib_orders_status ON ib_orders(status)')
  db.run('CREATE INDEX IF NOT EXISTS idx_ib_orders_ib_order_id ON ib_orders(ib_order_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_ib_positions_pair ON ib_positions(pair)')

  // Performance indexes for frequently queried columns
  db.run('CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_price_history_pair_timestamp ON price_history(pair, timestamp)')
  db.run('CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades(opened_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades(closed_at)')

  // Phase A: Trust Foundation - Add context columns to trades table
  // SQLite doesn't support IF NOT EXISTS for columns, so we try and catch
  const contextColumns = [
    'rsi_at_entry REAL',
    'macd_at_entry REAL',
    'trend_at_entry TEXT',
    'atr_at_entry REAL',
    'spread_at_entry REAL',
    'hour_of_day INTEGER',
    'day_of_week INTEGER',
    'market_session TEXT',
    'volatility_level TEXT'
  ]

  for (const col of contextColumns) {
    try {
      db.run(`ALTER TABLE trades ADD COLUMN ${col}`)
    } catch {
      // Column already exists, ignore
    }
  }

  // Create trade_patterns table for discovered patterns
  db.run(`
    CREATE TABLE IF NOT EXISTS trade_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_name TEXT NOT NULL,
      pattern_type TEXT NOT NULL,
      conditions TEXT NOT NULL,
      sample_size INTEGER DEFAULT 0,
      win_rate REAL DEFAULT 0,
      avg_pnl REAL DEFAULT 0,
      confidence_adjustment REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      discovered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_trade_patterns_type ON trade_patterns(pattern_type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_trade_patterns_active ON trade_patterns(is_active)')

  // Phase B: ML Training Data table - captures features and outcomes for ML model training
  db.run(`
    CREATE TABLE IF NOT EXISTS ml_training_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER,

      -- 25 Input Features (captured at trade entry)
      rsi_14 REAL,
      rsi_7 REAL,
      macd_histogram REAL,
      bb_width REAL,
      stoch_k REAL,
      atr_14 REAL,
      atr_7 REAL,
      price_to_sma20_ratio REAL,
      price_to_sma50_ratio REAL,
      bb_position REAL,
      trend_direction REAL,
      hour_sin REAL,
      hour_cos REAL,
      day_sin REAL,
      day_cos REAL,
      session_asian INTEGER DEFAULT 0,
      session_london INTEGER DEFAULT 0,
      session_overlap INTEGER DEFAULT 0,
      session_newyork INTEGER DEFAULT 0,
      recent_volatility REAL,
      trade_direction REAL,
      confidence_score REAL,
      sma_cross_signal REAL,
      ema_cross_signal REAL,
      signal_agreement_ratio REAL,

      -- Training Labels (filled after trade closes)
      sl_multiplier_used REAL,
      tp_multiplier_used REAL,
      max_favorable_excursion REAL,
      max_adverse_excursion REAL,
      optimal_sl_would_have_been REAL,
      optimal_tp_would_have_been REAL,
      pnl_pips REAL,
      close_reason TEXT,

      -- Metadata
      ab_test_group TEXT,
      ml_predicted_sl REAL,
      ml_predicted_tp REAL,
      ml_confidence REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,

      FOREIGN KEY (trade_id) REFERENCES trades(id)
    )
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_ml_training_trade_id ON ml_training_data(trade_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_ml_training_ab_group ON ml_training_data(ab_test_group)')
  db.run('CREATE INDEX IF NOT EXISTS idx_ml_training_created ON ml_training_data(created_at)')

  // Phase B: A/B Test Results table
  db.run(`
    CREATE TABLE IF NOT EXISTS ml_ab_test (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_name TEXT NOT NULL,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      status TEXT DEFAULT 'RUNNING',
      control_trades INTEGER DEFAULT 0,
      treatment_trades INTEGER DEFAULT 0,
      control_win_rate REAL,
      treatment_win_rate REAL,
      control_avg_pnl REAL,
      treatment_avg_pnl REAL,
      control_sharpe REAL,
      treatment_sharpe REAL,
      p_value REAL,
      conclusion TEXT
    )
  `)

  // Phase B: ML Model Versions table
  db.run(`
    CREATE TABLE IF NOT EXISTS ml_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      trained_at TEXT DEFAULT CURRENT_TIMESTAMP,
      training_samples INTEGER,
      validation_loss REAL,
      training_loss REAL,
      backtest_improvement REAL,
      is_active INTEGER DEFAULT 0,
      model_path TEXT,
      config TEXT
    )
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_ml_models_active ON ml_models(is_active)')

  // Swing Trading: Daily Candles table
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      swing_high INTEGER DEFAULT 0,
      swing_low INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(pair, date)
    )
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_daily_candles_pair ON daily_candles(pair)')
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_candles_date ON daily_candles(date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_candles_pair_date ON daily_candles(pair, date)')

  // Swing Trading: Training Data table
  db.run(`
    CREATE TABLE IF NOT EXISTS swing_training_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER,
      pair TEXT NOT NULL,

      -- 20 Swing-specific features
      daily_trend REAL,
      weekly_trend REAL,
      daily_momentum REAL,
      htf_alignment REAL,
      days_in_trend INTEGER,
      trend_start_distance REAL,
      adx REAL,
      adx_slope REAL,
      di_separation REAL,
      trend_consistency REAL,
      hurst_exponent REAL,
      distance_to_swing_high REAL,
      distance_to_swing_low REAL,
      swing_range REAL,
      price_position_in_swing REAL,
      hhll_pattern REAL,
      nearest_support_distance REAL,
      nearest_resistance_distance REAL,
      at_support_resistance INTEGER DEFAULT 0,
      fib_level REAL,

      -- Swing-specific labels
      direction_label TEXT,
      magnitude_pips REAL,
      hold_days INTEGER,
      max_favorable_days INTEGER,
      optimal_exit_day INTEGER,
      outcome TEXT,

      -- Metadata
      entry_date TEXT,
      exit_date TEXT,
      entry_price REAL,
      exit_price REAL,
      strategy_used TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (trade_id) REFERENCES trades(id)
    )
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_swing_training_pair ON swing_training_data(pair)')
  db.run('CREATE INDEX IF NOT EXISTS idx_swing_training_outcome ON swing_training_data(outcome)')

  // Swing Trading: Add columns to trades table for swing trades
  const swingTradeColumns = [
    'is_swing_trade INTEGER DEFAULT 0',
    'swing_strategy TEXT',
    'swing_entry_day TEXT',
    'swing_target_hold_days INTEGER',
    'swing_tp1_hit INTEGER DEFAULT 0',
    'swing_tp2_hit INTEGER DEFAULT 0',
    'swing_tp3_hit INTEGER DEFAULT 0'
  ]

  for (const col of swingTradeColumns) {
    try {
      db.run(`ALTER TABLE trades ADD COLUMN ${col}`)
    } catch {
      // Column already exists, ignore
    }
  }

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
  maxOpenTrades: 6,
  riskPerTrade: 1,
  accountBalance: 10000,
  minConfidence: 60,
  maxDailyTrades: 100,
  maxDailyLoss: 5,
  allowedPairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'EUR/GBP'],
  tradingHours: { start: 0, end: 24 },
  useTrailingStop: true,
  trailingStopPips: 20,
  updateIntervalMs: 60000,
  // Phase A: Trust Foundation risk settings
  maxDailyLossPercent: 2,        // 2% daily loss limit (conservative)
  maxRiskPerTradePercent: 1,     // 1% risk per trade
  maxConcurrentTrades: 6,        // Max 6 open positions

  // Phase B: ML Settings
  useMLForSLTP: false,           // Master toggle (starts OFF)
  mlConfidenceThreshold: 0.7,    // Min confidence to use ML
  slMultiplierMin: 0.5,          // Clamp bounds
  slMultiplierMax: 3.0,
  tpMultiplierMin: 1.0,
  tpMultiplierMax: 5.0,
  minTradesForTraining: 200,     // Min data points before training
  abTestEnabled: false,          // A/B testing toggle
  abTestSplitRatio: 0.5,         // % of trades using ML in A/B test
  autoRetrainEnabled: true,      // Auto retrain on new data
  retrainIntervalDays: 7,        // Retrain frequency

  // ML Accelerated Data Collection
  mlAcceleratedCollection: false,     // Enable fast data collection mode
  mlAcceleratedMinConfidence: 50,     // Lower confidence threshold (50% vs 70%)
  mlAcceleratedMaxHoldMinutes: 30,    // Shorter max hold time for faster outcomes

  // Phase C: Better Execution - Limit Order Settings
  orderType: 'MARKET',           // 'MARKET' or 'LIMIT'
  limitOrderOffsetPips: 0.5,     // Offset from bid/ask for limit orders (default 0.5 pips)

  // Shariah Compliance Settings (Islamic Finance)
  shariahCompliant: false,           // Master toggle for Shariah mode
  shariahMaxLeverage: 5,             // 1:5 max leverage (very conservative per user)
  shariahMinConfidence: 70,          // Higher threshold to reduce speculation
  shariahMinIndicatorConfluence: 3,  // Require 3+ indicators agreeing
  shariahSwapCutoffHour: 16,         // 4pm EST (1 hour before 5pm swap time)
  shariahSwapCutoffMinute: 0,
  shariahIntradayOnly: true,         // Force same-day closure
  shariahTrackFees: true,            // Track all fees for transparency

  // Phase 1 Risk Improvements: ATR Trailing Stops
  useAdvancedTrailing: false,        // Master toggle (starts OFF for safety)
  trailingStopAlgorithm: 'ATR',      // 'FIXED', 'ATR', 'CHANDELIER', 'PARABOLIC'
  trailingStopAtrPeriod: 14,         // ATR period for trailing calculation
  trailingStopAtrMultiplier: 2.5,    // ATR multiplier for stop distance
  chandelierMultiplier: 3.0,         // Chandelier Exit multiplier
  parabolicStep: 0.02,               // Parabolic SAR step
  parabolicMax: 0.2,                 // Parabolic SAR max
  trailingActivationThreshold: 1.0,  // Activate after 1R profit
  trailingMinStopDistance: 10,       // Minimum stop distance in pips

  // Phase 1 Risk Improvements: Volatility Position Sizing
  useVolatilitySizing: false,        // Master toggle (starts OFF for safety)
  positionSizingMethod: 'VOLATILITY_ADJUSTED', // 'FIXED_FRACTIONAL', 'VOLATILITY_ADJUSTED', 'KELLY', 'RISK_PARITY'
  volatilityLookback: 20,            // Days for volatility calculation
  volatilityTarget: 1.0,             // Target daily volatility %
  minRiskPerTrade: 0.25,             // Min risk % even in high vol
  maxRiskPerTrade: 2.0,              // Max risk % even in low vol
  kellyFraction: 0.25,               // Use 25% of Kelly (quarter Kelly)
  atrPeriod: 14,                     // ATR period for vol calculation

  // Phase 1 Risk Improvements: Time-Based Exits
  timeExitsEnabled: false,           // Master toggle (starts OFF for safety)
  weekendExitEnabled: true,          // Close before weekend
  weekendExitDay: 5,                 // Friday (0=Sunday)
  weekendExitHourUTC: 20,            // 8pm UTC (4pm EST)
  sessionExitEnabled: false,         // Close at session end
  preferredSession: 'NEW_YORK',      // Preferred trading session
  maxHoldEnabled: false,             // Max holding time limit
  maxHoldHours: 72,                  // Max 3 days hold

  // Phase 2 Risk Improvements: ADX Regime Detection
  regimeDetectionEnabled: false,     // Master toggle (starts OFF for safety)
  adxPeriod: 14,                     // ADX calculation period
  strongTrendThreshold: 40,          // ADX > 40 = strong trend
  trendThreshold: 25,                // ADX 25-40 = trending
  weakTrendThreshold: 20,            // ADX 20-25 = weak trend
  diSeparationMin: 5,                // Minimum DI+/DI- separation
  volatilityThreshold: 2.0,          // ATR % for high volatility
  blockRangingTrades: false,         // Block trades in ranging markets
  blockVolatileTrades: false,        // Block trades in volatile markets

  // Phase 2 Risk Improvements: Multi-Timeframe Analysis
  mtfEnabled: false,                 // Master toggle (starts OFF for safety)
  mtfPrimaryTimeframe: 'H1',         // Main trading timeframe
  mtfConfirmationTimeframes: ['H4', 'D1'], // Higher timeframes for confirmation
  mtfRequireAllAligned: false,       // Require all timeframes agree
  mtfMinAlignmentScore: 60,          // Minimum alignment score (0-100)

  // Phase 2 Risk Improvements: Partial Profit Taking
  partialProfitsEnabled: false,      // Master toggle (starts OFF for safety)
  partialProfitStrategy: 'FIXED_TARGETS', // 'FIXED_TARGETS', 'ATR_BASED', 'PERCENTAGE', 'FIBONACCI'
  partialProfitTargets: [
    { r: 1.0, closePercent: 33, moveSLToBreakeven: true },
    { r: 2.0, closePercent: 33, trailRemaining: true },
    { r: 3.0, closePercent: 34, finalTarget: true }
  ],
  moveToBreakevenAfterFirstTarget: true,
  trailAfterSecondTarget: true,
  minPositionSizeForPartials: 0.02,  // Min 0.02 lots to split
  breakEvenBuffer: 2,                // Pips above/below entry for BE stop

  // Phase 3 Risk Improvements: Hurst Exponent Analysis
  hurstEnabled: false,               // Master toggle (starts OFF for safety)
  hurstMinDataPoints: 50,            // Minimum prices for calculation
  hurstLookback: 100,                // Default lookback period
  hurstStrongTrendThreshold: 0.65,   // H > 0.65 = strong trend
  hurstTrendThreshold: 0.55,         // H > 0.55 = trending
  hurstRandomUpperThreshold: 0.55,   // H < 0.55 = not clearly trending
  hurstRandomLowerThreshold: 0.45,   // H > 0.45 = not clearly reverting
  hurstMeanRevertThreshold: 0.35,    // H < 0.35 = strong mean reversion
  hurstAdjustConfidence: true,       // Apply confidence adjustments
  hurstBlockRandom: false,           // Block trades in random markets

  // Phase 3 Risk Improvements: Order Flow Analysis
  orderFlowEnabled: false,           // Master toggle (starts OFF for safety)
  orderFlowLookback: 50,             // Periods for analysis
  orderFlowPressureThreshold: 60,    // Min % for strong signal
  orderFlowMomentumPeriod: 14,       // Momentum calculation period
  orderFlowDivergenceLookback: 20,   // Periods for divergence detection
  orderFlowLiquidityZones: 5,        // Number of zones to detect
  orderFlowMinPressure: 55,          // Min pressure for trade signal

  // Phase 3 Risk Improvements: Ensemble Prediction
  ensembleEnabled: false,            // Master toggle (starts OFF for safety)
  ensembleMethod: 'WEIGHTED_VOTE',   // MAJORITY_VOTE, WEIGHTED_VOTE, UNANIMOUS, CONFIDENCE_WEIGHTED
  ensembleMinAgreement: 0.6,         // 60% of analyses must agree
  ensembleWeights: {                 // Weights for each method
    regime: 0.25,
    mtf: 0.25,
    hurst: 0.25,
    orderFlow: 0.25
  },
  ensembleAdaptiveWeights: false,    // Adjust weights based on performance
  ensembleMinAnalyses: 2,            // Min analyses that must be available
  ensembleConsensusBoost: 10,        // Confidence boost for full consensus
  ensembleDisagreementPenalty: 15,   // Confidence penalty for disagreement

  // Swing Trading Settings
  swingTradingEnabled: false,        // Master toggle (starts OFF for safety)
  swingMinHoldDays: 3,               // Minimum hold period in days
  swingMaxHoldDays: 7,               // Maximum hold period in days
  swingMinHoldHours: 24,             // Minimum hold period in hours
  swingStrategy: 'TREND_PULLBACK',   // 'TREND_PULLBACK', 'BREAKOUT', 'MEAN_REVERSION'
  swingPullbackFibLevels: [0.382, 0.5, 0.618], // Fib levels for pullback entries
  swingMinADX: 25,                   // Minimum ADX for trend confirmation
  swingRSIOversold: 40,              // RSI threshold for oversold in uptrend
  swingRSIOverbought: 60,            // RSI threshold for overbought in downtrend
  swingATRMultiplierSL: 2.0,         // ATR multiplier for stop loss
  swingATRMultiplierTP: 3.0,         // ATR multiplier for take profit
  swingPartialTP1Percent: 33,        // % to close at TP1 (1:1 R:R)
  swingPartialTP2Percent: 33,        // % to close at TP2 (2:1 R:R)
  swingPartialTP3Percent: 34,        // % to close at TP3 (trailing)
  swingTrailBelowSwingPoint: true,   // Trail stop below/above swing points
  swingConfidenceThreshold: 65,      // Minimum confidence for swing trades
  swingMaxConcurrentTrades: 3,       // Max concurrent swing trades
  swingDailyCandleLookback: 100,     // Days of candle history for analysis
  swingSwingPointLookback: 5,        // Bars for swing point confirmation
  swingMLEnabled: false,             // Use ML for swing direction prediction
  swingMLMinSamples: 500             // Min samples before training swing ML
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

// Get allowed setting keys from DEFAULT_SETTINGS
const ALLOWED_SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS))

export function saveSetting(key, value) {
  // Security: Only allow known setting keys
  if (!ALLOWED_SETTING_KEYS.has(key)) {
    console.warn(`[Database] Blocked attempt to save unknown setting: ${key}`)
    return false
  }
  const val = typeof value === 'object' ? JSON.stringify(value) : String(value)
  run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))', [key, val])
  return true
}

export function saveAllSettings(settings) {
  let saved = 0
  let blocked = 0
  for (const [key, value] of Object.entries(settings)) {
    if (saveSetting(key, value)) {
      saved++
    } else {
      blocked++
    }
  }
  if (blocked > 0) {
    console.warn(`[Database] saveAllSettings: ${saved} saved, ${blocked} blocked (unknown keys)`)
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
                        trailing_stop, position_size, confidence, reasoning, status, opened_at,
                        rsi_at_entry, macd_at_entry, trend_at_entry, atr_at_entry, spread_at_entry,
                        hour_of_day, day_of_week, market_session, volatility_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', datetime('now'),
            ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    trade.pair, trade.direction, trade.signal, trade.entryPrice, trade.entryPrice,
    trade.stopLoss, trade.takeProfit, trade.trailingStop || trade.stopLoss,
    trade.positionSize, trade.confidence, trade.reasoning,
    // Context fields (Phase A: Trust Foundation)
    trade.context?.rsi ?? null,
    trade.context?.macd ?? null,
    trade.context?.trend ?? null,
    trade.context?.atr ?? null,
    trade.context?.spread ?? null,
    trade.context?.hourOfDay ?? new Date().getUTCHours(),
    trade.context?.dayOfWeek ?? new Date().getUTCDay(),
    trade.context?.marketSession ?? getMarketSession(),
    trade.context?.volatilityLevel ?? null
  ])

  const result = getOne('SELECT last_insert_rowid() as id')
  return { ...trade, id: result.id }
}

/**
 * Get the raw database instance (for advanced queries)
 * @returns {Object} The sql.js database instance
 */
export function getDb() {
  if (!db) throw new Error('Database not initialized')
  return db
}

/**
 * Get market session based on current UTC hour
 */
export function getMarketSession(date = new Date()) {
  const hour = date.getUTCHours()
  if (hour >= 22 || hour < 7) return 'ASIAN'
  if (hour >= 7 && hour < 12) return 'LONDON'
  if (hour >= 12 && hour < 16) return 'OVERLAP'
  if (hour >= 16 && hour < 22) return 'NEW_YORK'
  return 'UNKNOWN'
}

// Whitelist of columns allowed to be updated via updateTrade
const ALLOWED_TRADE_UPDATE_COLUMNS = new Set([
  'currentPrice', 'current_price',
  'pnlPips', 'pnl_pips',
  'pnl',
  'trailingStop', 'trailing_stop',
  'status',
  'closeReason', 'close_reason'
])

export function updateTrade(id, updates) {
  const fields = []
  const values = []

  for (const [key, value] of Object.entries(updates)) {
    // Security: Only allow whitelisted columns
    if (!ALLOWED_TRADE_UPDATE_COLUMNS.has(key)) {
      console.warn(`[Database] Blocked attempt to update non-whitelisted column: ${key}`)
      continue
    }
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    fields.push(`${dbKey} = ?`)
    values.push(value)
  }

  if (fields.length === 0) {
    console.warn('[Database] updateTrade called with no valid fields')
    return getTradeById(id)
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

/**
 * Get price history within a date range
 * @param {string} pair - Currency pair
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Array} Price history entries
 */
export function getPriceHistoryByDateRange(pair, startDate, endDate) {
  return getAll(`
    SELECT price, timestamp FROM price_history
    WHERE pair = ? AND date(timestamp) >= ? AND date(timestamp) <= ?
    ORDER BY timestamp ASC
  `, [pair, startDate, endDate])
}

// ============================================
// Daily Candles functions (Swing Trading)
// ============================================

/**
 * Save or update a daily candle
 * @param {Object} candle - Candle data with pair, date, open, high, low, close
 */
export function saveDailyCandle(candle) {
  run(`
    INSERT OR REPLACE INTO daily_candles (pair, date, open, high, low, close, swing_high, swing_low)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    candle.pair, candle.date, candle.open, candle.high, candle.low, candle.close,
    candle.swingHigh || candle.swing_high || 0,
    candle.swingLow || candle.swing_low || 0
  ])
}

/**
 * Get a single daily candle
 * @param {string} pair - Currency pair
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Object|null} Candle data or null
 */
export function getDailyCandle(pair, date) {
  return getOne('SELECT * FROM daily_candles WHERE pair = ? AND date = ?', [pair, date])
}

/**
 * Get daily candles for a pair (newest first)
 * @param {string} pair - Currency pair
 * @param {number} limit - Maximum number of candles
 * @returns {Array} Array of candles
 */
export function getDailyCandles(pair, limit = 100) {
  return getAll(`
    SELECT * FROM daily_candles
    WHERE pair = ?
    ORDER BY date DESC
    LIMIT ?
  `, [pair, limit])
}

/**
 * Get daily candles within a date range
 * @param {string} pair - Currency pair
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Array} Array of candles (oldest first)
 */
export function getDailyCandlesByRange(pair, startDate, endDate) {
  return getAll(`
    SELECT * FROM daily_candles
    WHERE pair = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `, [pair, startDate, endDate])
}

/**
 * Update a daily candle's swing point markers
 * @param {string} pair - Currency pair
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Object} updates - Fields to update
 */
export function updateDailyCandle(pair, date, updates) {
  const fields = []
  const values = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    fields.push(`${dbKey} = ?`)
    values.push(value)
  }

  values.push(pair, date)
  run(`UPDATE daily_candles SET ${fields.join(', ')} WHERE pair = ? AND date = ?`, values)
}

/**
 * Get swing highs within a date range
 * @param {string} pair - Currency pair
 * @param {number} limit - Maximum number to return
 * @returns {Array} Array of candles marked as swing highs
 */
export function getSwingHighs(pair, limit = 20) {
  return getAll(`
    SELECT * FROM daily_candles
    WHERE pair = ? AND swing_high = 1
    ORDER BY date DESC
    LIMIT ?
  `, [pair, limit])
}

/**
 * Get swing lows within a date range
 * @param {string} pair - Currency pair
 * @param {number} limit - Maximum number to return
 * @returns {Array} Array of candles marked as swing lows
 */
export function getSwingLows(pair, limit = 20) {
  return getAll(`
    SELECT * FROM daily_candles
    WHERE pair = ? AND swing_low = 1
    ORDER BY date DESC
    LIMIT ?
  `, [pair, limit])
}

/**
 * Get the count of daily candles for a pair
 * @param {string} pair - Currency pair
 * @returns {number} Count of candles
 */
export function getDailyCandleCount(pair) {
  const result = getOne('SELECT COUNT(*) as count FROM daily_candles WHERE pair = ?', [pair])
  return result?.count || 0
}

// ============================================
// Swing Trading Training Data functions
// ============================================

/**
 * Create a swing training data record
 * @param {Object} data - Training data record
 * @returns {number} The new record ID
 */
export function createSwingTrainingRecord(data) {
  run(`
    INSERT INTO swing_training_data (
      trade_id, pair, daily_trend, weekly_trend, daily_momentum, htf_alignment,
      days_in_trend, trend_start_distance, adx, adx_slope, di_separation,
      trend_consistency, hurst_exponent, distance_to_swing_high, distance_to_swing_low,
      swing_range, price_position_in_swing, hhll_pattern, nearest_support_distance,
      nearest_resistance_distance, at_support_resistance, fib_level,
      entry_date, entry_price, strategy_used
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    data.tradeId, data.pair, data.dailyTrend, data.weeklyTrend, data.dailyMomentum,
    data.htfAlignment, data.daysInTrend, data.trendStartDistance, data.adx, data.adxSlope,
    data.diSeparation, data.trendConsistency, data.hurstExponent, data.distanceToSwingHigh,
    data.distanceToSwingLow, data.swingRange, data.pricePositionInSwing, data.hhllPattern,
    data.nearestSupportDistance, data.nearestResistanceDistance, data.atSupportResistance ? 1 : 0,
    data.fibLevel, data.entryDate, data.entryPrice, data.strategyUsed
  ])
  const result = getOne('SELECT last_insert_rowid() as id')
  return result.id
}

/**
 * Update swing training record with outcome data
 * @param {number} tradeId - The trade ID
 * @param {Object} outcome - Outcome data
 */
export function updateSwingTrainingOutcome(tradeId, outcome) {
  run(`
    UPDATE swing_training_data SET
      direction_label = ?,
      magnitude_pips = ?,
      hold_days = ?,
      max_favorable_days = ?,
      optimal_exit_day = ?,
      outcome = ?,
      exit_date = ?,
      exit_price = ?
    WHERE trade_id = ?
  `, [
    outcome.directionLabel, outcome.magnitudePips, outcome.holdDays,
    outcome.maxFavorableDays, outcome.optimalExitDay, outcome.outcome,
    outcome.exitDate, outcome.exitPrice, tradeId
  ])
}

/**
 * Get swing training data for ML training
 * @param {number} limit - Maximum records to return
 * @returns {Array} Training data records with outcomes
 */
export function getSwingTrainingData(limit = 1000) {
  return getAll(`
    SELECT * FROM swing_training_data
    WHERE outcome IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ?
  `, [limit])
}

/**
 * Get count of swing training records with outcomes
 * @returns {number} Count of completed training records
 */
export function getSwingTrainingDataCount() {
  const result = getOne('SELECT COUNT(*) as count FROM swing_training_data WHERE outcome IS NOT NULL')
  return result?.count || 0
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

// ============================================
// IB Configuration functions
// ============================================

export function getIBConfig(key) {
  const row = getOne('SELECT value FROM ib_config WHERE key = ?', [key])
  if (row) {
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  }
  return null
}

export function setIBConfig(key, value) {
  const val = typeof value === 'object' ? JSON.stringify(value) : String(value)
  run('INSERT OR REPLACE INTO ib_config (key, value, updated_at) VALUES (?, ?, datetime("now"))', [key, val])
}

export function getAllIBConfig() {
  const rows = getAll('SELECT key, value FROM ib_config')
  const config = {}
  rows.forEach(row => {
    try {
      config[row.key] = JSON.parse(row.value)
    } catch {
      config[row.key] = row.value
    }
  })
  return config
}

// ============================================
// IB Order functions
// ============================================

export function createIBOrder(order) {
  run(`
    INSERT INTO ib_orders (ib_order_id, local_trade_id, pair, direction, order_type,
                           status, quantity, limit_price, placed_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, datetime('now'))
  `, [
    order.ibOrderId, order.localTradeId ?? null, order.pair, order.direction,
    order.orderType || 'MKT', order.quantity, order.limitPrice ?? null
  ])
  const result = getOne('SELECT last_insert_rowid() as id')
  return { ...order, id: result.id }
}

export function updateIBOrder(ibOrderId, updates) {
  const fields = []
  const values = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    fields.push(`${dbKey} = ?`)
    values.push(value)
  }
  values.push(ibOrderId)

  run(`UPDATE ib_orders SET ${fields.join(', ')} WHERE ib_order_id = ?`, values)
  return getIBOrderById(ibOrderId)
}

export function getIBOrderById(ibOrderId) {
  return getOne('SELECT * FROM ib_orders WHERE ib_order_id = ?', [ibOrderId])
}

export function getIBOrdersByStatus(status) {
  return getAll('SELECT * FROM ib_orders WHERE status = ? ORDER BY placed_at DESC', [status])
}

export function getPendingIBOrders() {
  return getAll('SELECT * FROM ib_orders WHERE status IN (?, ?) ORDER BY placed_at DESC', ['PENDING', 'SUBMITTED'])
}

export function getIBOrderHistory(limit = 100) {
  return getAll('SELECT * FROM ib_orders ORDER BY placed_at DESC LIMIT ?', [limit])
}

// ============================================
// IB Position functions
// ============================================

export function updateIBPosition(account, pair, position, avgCost) {
  run(`
    INSERT OR REPLACE INTO ib_positions (account, pair, position, avg_cost, last_update)
    VALUES (?, ?, ?, ?, datetime('now'))
  `, [account, pair, position, avgCost])
}

export function getIBPositions(account = null) {
  if (account) {
    return getAll('SELECT * FROM ib_positions WHERE account = ?', [account])
  }
  return getAll('SELECT * FROM ib_positions')
}

export function getIBPosition(pair, account = null) {
  if (account) {
    return getOne('SELECT * FROM ib_positions WHERE pair = ? AND account = ?', [pair, account])
  }
  return getOne('SELECT * FROM ib_positions WHERE pair = ?', [pair])
}

export function clearIBPositions(account = null) {
  if (account) {
    run('DELETE FROM ib_positions WHERE account = ?', [account])
  } else {
    run('DELETE FROM ib_positions')
  }
}

// ============================================
// IB Account functions
// ============================================

export function updateIBAccountValue(accountId, key, value, currency = '') {
  run(`
    INSERT OR REPLACE INTO ib_account (account_id, key, value, currency, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `, [accountId, key, value, currency])
}

export function getIBAccountValues(accountId) {
  return getAll('SELECT * FROM ib_account WHERE account_id = ?', [accountId])
}

export function getIBAccountValue(accountId, key, currency = '') {
  return getOne('SELECT * FROM ib_account WHERE account_id = ? AND key = ? AND currency = ?',
    [accountId, key, currency])
}

export function getIBAccountSummary(accountId) {
  const values = getIBAccountValues(accountId)
  const summary = {}
  values.forEach(v => {
    const keyWithCurrency = v.currency ? `${v.key}_${v.currency}` : v.key
    summary[keyWithCurrency] = v.value
  })
  return summary
}

// ============================================
// Phase B: ML Training Data functions
// ============================================

export function createMLTrainingRecord(data) {
  run(`
    INSERT INTO ml_training_data (
      trade_id, rsi_14, rsi_7, macd_histogram, bb_width, stoch_k,
      atr_14, atr_7, price_to_sma20_ratio, price_to_sma50_ratio, bb_position,
      trend_direction, hour_sin, hour_cos, day_sin, day_cos,
      session_asian, session_london, session_overlap, session_newyork,
      recent_volatility, trade_direction, confidence_score,
      sma_cross_signal, ema_cross_signal, signal_agreement_ratio,
      sl_multiplier_used, tp_multiplier_used, ab_test_group,
      ml_predicted_sl, ml_predicted_tp, ml_confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    data.tradeId, data.rsi14, data.rsi7, data.macdHistogram, data.bbWidth, data.stochK,
    data.atr14, data.atr7, data.priceToSma20Ratio, data.priceToSma50Ratio, data.bbPosition,
    data.trendDirection, data.hourSin, data.hourCos, data.daySin, data.dayCos,
    data.sessionAsian ? 1 : 0, data.sessionLondon ? 1 : 0, data.sessionOverlap ? 1 : 0, data.sessionNewyork ? 1 : 0,
    data.recentVolatility, data.tradeDirection, data.confidenceScore,
    data.smaCrossSignal, data.emaCrossSignal, data.signalAgreementRatio,
    data.slMultiplierUsed, data.tpMultiplierUsed, data.abTestGroup ?? null,
    data.mlPredictedSl ?? null, data.mlPredictedTp ?? null, data.mlConfidence ?? null
  ])
  const result = getOne('SELECT last_insert_rowid() as id')
  return result.id
}

export function updateMLTrainingOutcome(tradeId, outcome) {
  run(`
    UPDATE ml_training_data SET
      max_favorable_excursion = ?,
      max_adverse_excursion = ?,
      optimal_sl_would_have_been = ?,
      optimal_tp_would_have_been = ?,
      pnl_pips = ?,
      close_reason = ?,
      closed_at = datetime('now')
    WHERE trade_id = ?
  `, [
    outcome.maxFavorableExcursion, outcome.maxAdverseExcursion,
    outcome.optimalSl, outcome.optimalTp,
    outcome.pnlPips, outcome.closeReason, tradeId
  ])
}

export function getMLTrainingData(limit = 1000) {
  return getAll('SELECT * FROM ml_training_data WHERE pnl_pips IS NOT NULL ORDER BY created_at DESC LIMIT ?', [limit])
}

export function getMLTrainingDataCount() {
  const result = getOne('SELECT COUNT(*) as count FROM ml_training_data WHERE pnl_pips IS NOT NULL')
  return result?.count ?? 0
}

export function getMLTrainingRecordByTradeId(tradeId) {
  return getOne('SELECT * FROM ml_training_data WHERE trade_id = ?', [tradeId])
}

// ============================================
// Phase B: A/B Test functions
// ============================================

export function createABTest(testName) {
  run(`INSERT INTO ml_ab_test (test_name) VALUES (?)`, [testName])
  const result = getOne('SELECT last_insert_rowid() as id')
  return result.id
}

export function updateABTestResults(testId, results) {
  run(`
    UPDATE ml_ab_test SET
      control_trades = ?,
      treatment_trades = ?,
      control_win_rate = ?,
      treatment_win_rate = ?,
      control_avg_pnl = ?,
      treatment_avg_pnl = ?,
      control_sharpe = ?,
      treatment_sharpe = ?,
      p_value = ?
    WHERE id = ?
  `, [
    results.controlTrades, results.treatmentTrades,
    results.controlWinRate, results.treatmentWinRate,
    results.controlAvgPnl, results.treatmentAvgPnl,
    results.controlSharpe, results.treatmentSharpe,
    results.pValue, testId
  ])
}

export function endABTest(testId, conclusion) {
  run(`
    UPDATE ml_ab_test SET
      status = 'COMPLETED',
      ended_at = datetime('now'),
      conclusion = ?
    WHERE id = ?
  `, [conclusion, testId])
}

export function getActiveABTest() {
  return getOne('SELECT * FROM ml_ab_test WHERE status = ? ORDER BY started_at DESC LIMIT 1', ['RUNNING'])
}

export function getABTestHistory(limit = 10) {
  return getAll('SELECT * FROM ml_ab_test ORDER BY started_at DESC LIMIT ?', [limit])
}

export function getABTestGroupStats() {
  const control = getAll(`
    SELECT * FROM ml_training_data
    WHERE ab_test_group = 'CONTROL' AND pnl_pips IS NOT NULL
    ORDER BY created_at DESC
  `)
  const treatment = getAll(`
    SELECT * FROM ml_training_data
    WHERE ab_test_group = 'TREATMENT' AND pnl_pips IS NOT NULL
    ORDER BY created_at DESC
  `)
  return { control, treatment }
}

// ============================================
// Phase B: ML Model Version functions
// ============================================

export function saveMLModel(modelData) {
  // Deactivate all existing models
  run('UPDATE ml_models SET is_active = 0')

  run(`
    INSERT INTO ml_models (version, training_samples, validation_loss, training_loss,
                           backtest_improvement, is_active, model_path, config)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `, [
    modelData.version, modelData.trainingSamples, modelData.validationLoss,
    modelData.trainingLoss, modelData.backtestImprovement,
    modelData.modelPath, JSON.stringify(modelData.config ?? {})
  ])
  const result = getOne('SELECT last_insert_rowid() as id')
  return result.id
}

export function getActiveMLModel() {
  return getOne('SELECT * FROM ml_models WHERE is_active = 1')
}

export function getMLModelHistory(limit = 10) {
  return getAll('SELECT * FROM ml_models ORDER BY trained_at DESC LIMIT ?', [limit])
}

export function activateMLModel(modelId) {
  run('UPDATE ml_models SET is_active = 0')
  run('UPDATE ml_models SET is_active = 1 WHERE id = ?', [modelId])
}

// Initialize on import
await initDatabase()

export default db
