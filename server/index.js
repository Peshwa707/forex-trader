/**
 * Forex Trading Bot Server
 * 24/7 Automated Trading with REST API
 */

import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import path from 'path'
import { fileURLToPath } from 'url'

// Database and services
import * as db from './database.js'
import { fetchLiveRates, getPriceMap } from './services/forexApi.js'
import { runBotCycle, getBotStatus, startBot, stopBot, loadPriceHistory } from './services/botRunner.js'
import { closeTradeById, closeAllTrades, resetAccount } from './services/tradeExecutor.js'

// IB Services
import { ibConnector, ConnectionState } from './services/ib/IBConnector.js'
import { ibMarketData } from './services/ib/IBMarketData.js'
import { ibOrderService } from './services/ib/IBOrderService.js'
import { ibAccountService } from './services/ib/IBAccountService.js'
import { ibConnectionMonitor, HealthStatus } from './services/ib/IBConnectionMonitor.js'
import { IB_CONFIG, validateMode } from './config/ib.config.js'
import { getPriceSource } from './services/forexApi.js'

// Auth Services
import {
  authenticateJWT,
  generalRateLimiter,
  tradingRateLimiter,
  authRateLimiter,
  killSwitchRateLimiter,
  tradingAuditLog
} from './services/auth/authMiddleware.js'
import {
  initializeAuth,
  login,
  logout,
  refreshAccessToken,
  setPassword,
  enableAuth,
  disableAuth,
  getAuthStatus,
  isAuthEnabled
} from './services/auth/sessionManager.js'

// Risk Management
import { riskManager, RiskLevel } from './services/risk/RiskManager.js'
import { trailingStopManager, TrailingStopAlgorithm } from './services/risk/TrailingStopManager.js'
import { positionSizer, SizingMethod } from './services/risk/PositionSizer.js'
import { timeExitManager, TimeExitType } from './services/risk/TimeExitManager.js'

// Phase 2: Analysis services
import { regimeDetector, MarketRegime, RegimeStrategy } from './services/analysis/RegimeDetector.js'
import { mtfAnalyzer, Timeframe } from './services/analysis/MultiTimeframeAnalyzer.js'
import { partialProfitManager, PartialCloseStrategy } from './services/analysis/PartialProfitManager.js'
import { getAnalysisServicesStatus, analyzeSignal } from './services/analysis/index.js'

// Phase 3: Advanced analysis services
import { hurstAnalyzer, MarketCharacter, CharacterStrategy } from './services/analysis/HurstAnalyzer.js'
import { orderFlowAnalyzer, FlowSignal, DivergenceType } from './services/analysis/OrderFlowAnalyzer.js'
import { ensemblePredictor, EnsembleMethod } from './services/analysis/EnsemblePredictor.js'

// Trade Analytics (Phase A: Trust Foundation)
import * as TradeAnalytics from './services/TradeAnalytics.js'

// Backtesting (Phase A: Trust Foundation)
import { runBacktest, FOREX_PAIRS } from './services/backtesting/BacktestEngine.js'
import { initHistoricalDataTable, getAvailablePairs, getAvailableDateRange, ensureHistoricalData } from './services/backtesting/HistoricalDataStore.js'

// Phase B: ML Service (lazy loaded)
let mlServiceInstance = null
async function getMLService() {
  if (!mlServiceInstance) {
    try {
      const { mlService } = await import('./services/ml/index.js')
      await mlService.initialize()
      mlServiceInstance = mlService
    } catch (error) {
      console.warn('[Server] ML service not available:', error.message)
      return null
    }
  }
  return mlServiceInstance
}

// Swing Trading Services (lazy loaded)
let swingServicesCache = null
async function getSwingServices() {
  if (!swingServicesCache) {
    try {
      const swingModule = await import('./services/swing/index.js')
      const candleModule = await import('./services/data/CandleAggregator.js')
      const mlModule = await import('./services/ml/SwingDirectionModel.js')
      const dataModule = await import('./services/ml/SwingDataCollector.js')
      const featureModule = await import('./services/ml/SwingFeatureExtractor.js')

      await mlModule.swingDirectionModel.initialize()

      swingServicesCache = {
        ...swingModule,
        candleAggregator: candleModule.candleAggregator,
        swingDirectionModel: mlModule.swingDirectionModel,
        swingDataCollector: dataModule.swingDataCollector,
        swingFeatureExtractor: featureModule.swingFeatureExtractor
      }
    } catch (error) {
      console.warn('[Server] Swing services not available:', error.message)
      return null
    }
  }
  return swingServicesCache
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

/**
 * Parse and validate integer with bounds
 * Prevents DoS via extremely large limits
 */
function boundedParseInt(value, defaultValue, min = 1, max = 1000) {
  const parsed = parseInt(value)
  if (isNaN(parsed)) return defaultValue
  return Math.max(min, Math.min(max, parsed))
}

/**
 * Parse and validate float with bounds
 * Prevents invalid financial values
 */
function boundedParseFloat(value, defaultValue, min = 0, max = 1000000) {
  const parsed = parseFloat(value)
  if (isNaN(parsed)) return defaultValue
  return Math.max(min, Math.min(max, parsed))
}

// CORS configuration - restrict origins in production
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
    : true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}

// Middleware
app.use(cors(corsOptions))
app.use(express.json())
app.use(generalRateLimiter) // Apply general rate limiting to all routes

// Initialize authentication
initializeAuth()

// Initialize risk management
riskManager.initialize()

// Initialize historical data table for backtesting
initHistoricalDataTable()

// Connect risk manager to execution engine (for risk checks during trading)
import { setRiskManager, executionEngine } from './services/execution/ExecutionEngine.js'
setRiskManager(riskManager)

// Serve static files from dist folder (built React app)
app.use(express.static(path.join(__dirname, '../dist')))

// ============================================
// REST API ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// Bot status
app.get('/api/bot/status', (req, res) => {
  res.json(getBotStatus())
})

// Execution engine status (debug)
app.get('/api/execution/status', (req, res) => {
  res.json(executionEngine.getStatus())
})

// Start bot (requires auth and rate limiting)
app.post('/api/bot/start', tradingRateLimiter, authenticateJWT, (req, res) => {
  res.json(startBot())
})

// Stop bot (requires auth and rate limiting)
app.post('/api/bot/stop', tradingRateLimiter, authenticateJWT, (req, res) => {
  res.json(stopBot())
})

// Trigger manual bot cycle (requires auth and rate limiting)
app.post('/api/bot/run', tradingRateLimiter, authenticateJWT, async (req, res) => {
  try {
    const result = await runBotCycle()
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get current prices
app.get('/api/prices', async (req, res) => {
  try {
    const rates = await fetchLiveRates()
    res.json(rates)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get settings (requires auth when enabled)
app.get('/api/settings', authenticateJWT, (req, res) => {
  res.json(db.getAllSettings())
})

// Update settings (requires auth when enabled)
app.put('/api/settings', authenticateJWT, (req, res) => {
  try {
    db.saveAllSettings(req.body)
    res.json(db.getAllSettings())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get active trades
app.get('/api/trades', (req, res) => {
  res.json(db.getActiveTrades())
})

// Get trade history
app.get('/api/trades/history', (req, res) => {
  const limit = boundedParseInt(req.query.limit, 100, 1, 1000)
  res.json(db.getTradeHistory(limit))
})

// Close a trade (requires auth when enabled)
app.post('/api/trades/:id/close', authenticateJWT, async (req, res) => {
  try {
    const tradeId = parseInt(req.params.id)
    const rates = await fetchLiveRates()
    const priceMap = getPriceMap(rates)

    const trade = db.getTradeById(tradeId)
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' })
    }

    const currentPrice = priceMap[trade.pair]
    if (!currentPrice) {
      return res.status(400).json({ error: 'Cannot get current price' })
    }

    const result = closeTradeById(tradeId, currentPrice, 'MANUAL')
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Close all trades (requires auth when enabled)
app.post('/api/trades/close-all', authenticateJWT, async (req, res) => {
  try {
    const rates = await fetchLiveRates()
    const priceMap = getPriceMap(rates)
    const result = closeAllTrades(priceMap)
    res.json({ closed: result.length, trades: result })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get trading statistics
app.get('/api/stats', (req, res) => {
  res.json(db.getTradingStats())
})

// Get predictions
app.get('/api/predictions', (req, res) => {
  const limit = boundedParseInt(req.query.limit, 100, 1, 1000)
  res.json(db.getPredictions(limit))
})

// Get activity log
app.get('/api/activity', (req, res) => {
  const limit = boundedParseInt(req.query.limit, 50, 1, 500)
  res.json(db.getActivityLog(limit))
})

// Get trade explanations (Phase A: Trust Foundation)
app.get('/api/explanations', (req, res) => {
  const limit = boundedParseInt(req.query.limit, 20, 1, 200)
  const activityLog = db.getActivityLog(limit * 3) // Get more to filter
  const explanations = activityLog
    .filter(a => a.type === 'TRADE_EXPLANATION')
    .slice(0, limit)
    .map(a => {
      try {
        return JSON.parse(a.data)
      } catch {
        return { reason: a.message, timestamp: a.created_at }
      }
    })
  res.json(explanations)
})

// Get price history for a pair
app.get('/api/prices/:pair/history', (req, res) => {
  const pair = req.params.pair.replace('-', '/')
  const limit = boundedParseInt(req.query.limit, 100, 1, 1000)
  res.json(db.getPriceHistory(pair, limit))
})

// Reset account (requires auth when enabled)
app.post('/api/account/reset', authenticateJWT, (req, res) => {
  // Validate balance: min $100, max $10M
  const balance = boundedParseFloat(req.body.balance, 10000, 100, 10000000)
  res.json(resetAccount(balance))
})

// Export all data (requires auth when enabled)
app.get('/api/export', authenticateJWT, (req, res) => {
  res.json({
    settings: db.getAllSettings(),
    activeTrades: db.getActiveTrades(),
    tradeHistory: db.getTradeHistory(500),
    predictions: db.getPredictions(500),
    stats: db.getTradingStats(),
    exportedAt: new Date().toISOString()
  })
})

// ============================================
// INTERACTIVE BROKERS API ENDPOINTS
// ============================================

// Get IB connection status (enhanced with health monitoring)
app.get('/api/ib/status', (req, res) => {
  res.json(ibConnectionMonitor.getStatus())
})

// Connect to IB Gateway
app.post('/api/ib/connect', async (req, res) => {
  try {
    const options = {
      host: req.body.host,
      port: req.body.port,
      clientId: req.body.clientId
    }
    const result = await ibConnector.connect(options)

    // Auto-start connection monitoring on successful connect
    if (result.success) {
      ibConnectionMonitor.start()

      // Auto-subscribe to market data for forex pairs (needed for paper trading fills)
      setTimeout(() => {
        try {
          ibMarketData.initialize()
          const subscriptions = ibMarketData.subscribeAll()
          console.log(`✅ Auto-subscribed to ${subscriptions.length} forex pairs for market data`)
          db.logActivity('MARKET_DATA_AUTO_SUBSCRIBE', 'Auto-subscribed to forex market data', { pairs: subscriptions.length })
        } catch (err) {
          console.log(`⚠️ Failed to auto-subscribe market data: ${err.message}`)
        }
      }, 2000) // Wait 2s for IB connection to stabilize
    }

    res.json(result)
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Disconnect from IB Gateway
app.post('/api/ib/disconnect', async (req, res) => {
  try {
    // Stop connection monitoring
    ibConnectionMonitor.stop()

    const result = await ibConnector.disconnect()
    res.json(result)
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get IB account info
app.get('/api/ib/account', (req, res) => {
  const accountId = req.query.account || 'default'
  res.json({
    summary: db.getIBAccountSummary(accountId),
    positions: db.getIBPositions(accountId)
  })
})

// Get IB positions
app.get('/api/ib/positions', (req, res) => {
  const account = req.query.account
  res.json(db.getIBPositions(account))
})

// Get IB order history
app.get('/api/ib/orders', (req, res) => {
  const limit = boundedParseInt(req.query.limit, 100, 1, 1000)
  res.json(db.getIBOrderHistory(limit))
})

// Get pending IB orders
app.get('/api/ib/orders/pending', (req, res) => {
  res.json(db.getPendingIBOrders())
})

// ============================================
// IB CONNECTION MONITORING ENDPOINTS (Phase D)
// ============================================

// Get detailed connection health status
app.get('/api/ib/health', (req, res) => {
  res.json(ibConnectionMonitor.getStatus())
})

// Start connection monitoring
app.post('/api/ib/monitor/start', (req, res) => {
  const result = ibConnectionMonitor.start()
  res.json(result)
})

// Stop connection monitoring
app.post('/api/ib/monitor/stop', (req, res) => {
  const result = ibConnectionMonitor.stop()
  res.json(result)
})

// Manual health check (immediate heartbeat)
app.post('/api/ib/health/check', async (req, res) => {
  try {
    const result = await ibConnectionMonitor.checkHealth()
    res.json(result)
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Reset monitoring statistics
app.post('/api/ib/monitor/reset-stats', (req, res) => {
  const result = ibConnectionMonitor.resetStats()
  res.json(result)
})

// Simple health check for load balancers/monitoring systems
app.get('/api/ib/health/simple', (req, res) => {
  const status = ibConnectionMonitor.getStatus()
  const healthy = status.health.status === 'HEALTHY'

  if (healthy) {
    res.json({ healthy: true, status: status.health.status })
  } else {
    res.status(503).json({
      healthy: false,
      status: status.health.status,
      state: status.state,
      lastHeartbeat: status.health.lastHeartbeatReceived
    })
  }
})

// ============================================
// IB MARKET DATA ENDPOINTS
// ============================================

// Get IB market data status
app.get('/api/ib/marketdata/status', (req, res) => {
  res.json({
    ...ibMarketData.getStatus(),
    priceSource: getPriceSource()
  })
})

// Subscribe to all forex pairs
app.post('/api/ib/marketdata/subscribe', (req, res) => {
  try {
    if (!ibConnector.isConnected()) {
      return res.status(400).json({ success: false, error: 'Not connected to IB' })
    }

    ibMarketData.initialize()
    const subscriptions = ibMarketData.subscribeAll()

    res.json({
      success: true,
      subscriptions
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Subscribe to specific pair
app.post('/api/ib/marketdata/subscribe/:pair', (req, res) => {
  try {
    if (!ibConnector.isConnected()) {
      return res.status(400).json({ success: false, error: 'Not connected to IB' })
    }

    const pair = req.params.pair.replace('-', '/')
    ibMarketData.initialize()
    const reqId = ibMarketData.subscribe(pair)

    res.json({ success: true, pair, reqId })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Unsubscribe from all
app.post('/api/ib/marketdata/unsubscribe', (req, res) => {
  ibMarketData.unsubscribeAll()
  res.json({ success: true, message: 'Unsubscribed from all market data' })
})

// Get live prices from IB
app.get('/api/ib/marketdata/prices', (req, res) => {
  res.json({
    prices: ibMarketData.getAllPrices(),
    source: getPriceSource(),
    timestamp: Date.now()
  })
})

// ============================================
// IB ORDER ENDPOINTS
// ============================================

// Place a market order
app.post('/api/ib/order/market', tradingRateLimiter, authenticateJWT, tradingAuditLog, async (req, res) => {
  try {
    const { pair, direction, quantity, localTradeId } = req.body

    if (!pair || !direction || !quantity) {
      return res.status(400).json({ success: false, error: 'pair, direction, and quantity are required' })
    }

    const mode = db.getSetting('tradingMode') || 'SIMULATION'

    // For LIVE mode, require explicit confirmation
    if (mode === 'LIVE' && !req.body.confirmed) {
      return res.status(400).json({
        success: false,
        error: 'Live trading requires explicit confirmation',
        requiresConfirmation: true,
        warning: `You are about to place a REAL order: ${direction} ${quantity} lots ${pair}`
      })
    }

    ibOrderService.initialize()
    const result = await ibOrderService.placeMarketOrder(pair, direction, quantity, localTradeId)

    res.json({ success: true, ...result })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Place a limit order
app.post('/api/ib/order/limit', tradingRateLimiter, authenticateJWT, tradingAuditLog, async (req, res) => {
  try {
    const { pair, direction, quantity, limitPrice, localTradeId } = req.body

    if (!pair || !direction || !quantity || !limitPrice) {
      return res.status(400).json({ success: false, error: 'pair, direction, quantity, and limitPrice are required' })
    }

    const mode = db.getSetting('tradingMode') || 'SIMULATION'
    if (mode === 'LIVE' && !req.body.confirmed) {
      return res.status(400).json({
        success: false,
        error: 'Live trading requires explicit confirmation',
        requiresConfirmation: true
      })
    }

    ibOrderService.initialize()
    const result = await ibOrderService.placeLimitOrder(pair, direction, quantity, limitPrice, localTradeId)

    res.json({ success: true, ...result })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Cancel an order
app.delete('/api/ib/order/:orderId', tradingRateLimiter, authenticateJWT, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId)
    const result = await ibOrderService.cancelOrder(orderId)
    res.json({ success: true, ...result })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Cancel all orders
app.delete('/api/ib/orders', async (req, res) => {
  try {
    const result = await ibOrderService.cancelAllOrders()
    res.json(result)
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get order service status
app.get('/api/ib/order/status', (req, res) => {
  res.json(ibOrderService.getStatus())
})

// ============================================
// IB ACCOUNT ENDPOINTS (ENHANCED)
// ============================================

// Subscribe to account updates
app.post('/api/ib/account/subscribe', (req, res) => {
  try {
    if (!ibConnector.isConnected()) {
      return res.status(400).json({ success: false, error: 'Not connected to IB' })
    }

    ibAccountService.initialize()
    const result = ibAccountService.subscribe(req.body.accountId)

    res.json(result)
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Unsubscribe from account updates
app.post('/api/ib/account/unsubscribe', (req, res) => {
  ibAccountService.unsubscribe()
  res.json({ success: true })
})

// Get account status
app.get('/api/ib/account/status', (req, res) => {
  res.json(ibAccountService.getStatus())
})

// Get account summary
app.get('/api/ib/account/summary', (req, res) => {
  res.json(ibAccountService.getAccountSummary())
})

// Get live positions from IB
app.get('/api/ib/account/positions', (req, res) => {
  res.json({
    positions: ibAccountService.getAllPositions(),
    openPositions: ibAccountService.getOpenPositions()
  })
})

// ============================================
// TRADING MODE ENDPOINTS
// ============================================

// Get current trading mode
app.get('/api/mode', (req, res) => {
  const mode = db.getSetting('tradingMode') || IB_CONFIG.mode.current
  const ibStatus = ibConnector.getStatus()

  res.json({
    mode,
    ibRequired: mode !== 'SIMULATION',
    ibConnected: ibStatus.isConnected,
    availableModes: ['SIMULATION', 'PAPER', 'LIVE'],
    liveEnabled: IB_CONFIG.mode.allowLive
  })
})

// Switch trading mode
app.put('/api/mode', async (req, res) => {
  try {
    const { mode } = req.body

    if (!mode) {
      return res.status(400).json({ success: false, error: 'Mode is required' })
    }

    // Validate mode
    validateMode(mode)

    // Check IB connection for non-simulation modes
    if (mode !== 'SIMULATION' && !ibConnector.isConnected()) {
      return res.status(400).json({
        success: false,
        error: 'IB connection required for PAPER/LIVE mode. Connect to IB Gateway first.'
      })
    }

    // Require confirmation for LIVE mode
    if (mode === 'LIVE' && !req.body.confirmed) {
      return res.status(400).json({
        success: false,
        error: 'Live trading requires explicit confirmation',
        requiresConfirmation: true,
        warning: 'You are about to enable LIVE trading with REAL MONEY. Set confirmed=true to proceed.'
      })
    }

    const result = executionEngine.setMode(mode)
    res.json(result)
  } catch (error) {
    res.status(400).json({ success: false, error: error.message })
  }
})

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

// Get auth status
app.get('/api/auth/status', (req, res) => {
  res.json(getAuthStatus())
})

// Login
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  try {
    const { password } = req.body

    if (!password) {
      return res.status(400).json({ error: 'Password is required' })
    }

    const result = await login(password)
    res.json(result)
  } catch (error) {
    res.status(401).json({ error: error.message })
  }
})

// Logout
app.post('/api/auth/logout', authenticateJWT, (req, res) => {
  const sessionId = req.body.sessionId
  res.json(logout(sessionId))
})

// Refresh token
app.post('/api/auth/refresh', authRateLimiter, (req, res) => {
  try {
    const { refreshToken } = req.body

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' })
    }

    const result = refreshAccessToken(refreshToken)
    res.json(result)
  } catch (error) {
    res.status(401).json({ error: error.message })
  }
})

// Change password (requires current auth)
app.post('/api/auth/password', authenticateJWT, async (req, res) => {
  try {
    const { newPassword } = req.body

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' })
    }

    const result = await setPassword(newPassword)
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Enable auth (requires current auth if enabled)
app.post('/api/auth/enable', authenticateJWT, (req, res) => {
  res.json(enableAuth())
})

// Disable auth (requires auth and explicit confirmation)
app.post('/api/auth/disable', authenticateJWT, (req, res) => {
  const { confirm } = req.body
  if (confirm !== 'DISABLE_AUTH') {
    return res.status(400).json({
      error: 'Must confirm with body: { confirm: "DISABLE_AUTH" }'
    })
  }
  console.warn('[Security] Authentication disabled by authenticated user')
  res.json(disableAuth())
})

// ============================================
// RISK MANAGEMENT ENDPOINTS
// ============================================

// Get risk status
app.get('/api/risk/status', (req, res) => {
  res.json(riskManager.getStatus())
})

// Get detailed risk report
app.get('/api/risk/report', (req, res) => {
  res.json(riskManager.getReport())
})

// Get dashboard-friendly risk status (Phase A: Trust Foundation)
app.get('/api/risk/dashboard', (req, res) => {
  res.json(riskManager.getDashboardStatus())
})

// Perform manual risk check
app.post('/api/risk/check', (req, res) => {
  const result = riskManager.performRiskCheck()
  res.json(result)
})

// Reset kill switch (requires auth)
app.post('/api/risk/reset', authenticateJWT, (req, res) => {
  const result = riskManager.resetKillSwitch()
  res.json(result)
})

// Reset daily risk stats (requires auth)
app.post('/api/risk/reset-daily', authenticateJWT, (req, res) => {
  const result = riskManager.resetDaily()
  res.json(result)
})

// Manual kill switch trigger
app.post('/api/risk/kill', authenticateJWT, async (req, res) => {
  try {
    const { reason = 'Manual trigger', closePositions = false } = req.body

    const result = await riskManager.triggerKillSwitch(reason)

    // Close positions if requested
    let closedTrades = []
    if (closePositions) {
      const rates = await fetchLiveRates()
      const priceMap = getPriceMap(rates)
      closedTrades = closeAllTrades(priceMap)
    }

    res.json({
      ...result,
      closedTrades: closedTrades.length
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================
// PHASE 1 RISK IMPROVEMENTS ENDPOINTS
// ============================================

// Get combined status of all Phase 1 risk services
app.get('/api/risk/phase1/status', (req, res) => {
  res.json({
    trailingStop: trailingStopManager.getStatus(),
    positionSizing: positionSizer.getStatus(),
    timeExits: timeExitManager.getStatus()
  })
})

// Get trailing stop status
app.get('/api/risk/trailing/status', (req, res) => {
  res.json(trailingStopManager.getStatus())
})

// Configure trailing stop settings
app.post('/api/risk/trailing/configure', authenticateJWT, (req, res) => {
  const { algorithm, atrMultiplier, activationThreshold, enabled } = req.body

  const updates = {}
  if (algorithm !== undefined) updates.trailingStopAlgorithm = algorithm
  if (atrMultiplier !== undefined) updates.trailingStopAtrMultiplier = atrMultiplier
  if (activationThreshold !== undefined) updates.trailingActivationThreshold = activationThreshold
  if (enabled !== undefined) updates.useAdvancedTrailing = enabled

  db.saveAllSettings(updates)
  res.json({
    success: true,
    message: 'Trailing stop settings updated',
    settings: trailingStopManager.getStatus()
  })
})

// Get position sizing status
app.get('/api/risk/sizing/status', (req, res) => {
  res.json(positionSizer.getStatus())
})

// Configure position sizing settings
app.post('/api/risk/sizing/configure', authenticateJWT, (req, res) => {
  const { method, volatilityTarget, minRiskPercent, maxRiskPercent, enabled } = req.body

  const updates = {}
  if (method !== undefined) updates.positionSizingMethod = method
  if (volatilityTarget !== undefined) updates.volatilityTarget = volatilityTarget
  if (minRiskPercent !== undefined) updates.minRiskPerTrade = minRiskPercent
  if (maxRiskPercent !== undefined) updates.maxRiskPerTrade = maxRiskPercent
  if (enabled !== undefined) updates.useVolatilitySizing = enabled

  db.saveAllSettings(updates)
  res.json({
    success: true,
    message: 'Position sizing settings updated',
    settings: positionSizer.getStatus()
  })
})

// Get time exit status
app.get('/api/risk/time/status', (req, res) => {
  res.json(timeExitManager.getStatus())
})

// Configure time exit settings
app.post('/api/risk/time/configure', authenticateJWT, (req, res) => {
  const { weekendExitEnabled, weekendExitHourUTC, maxHoldEnabled, maxHoldHours, enabled } = req.body

  const updates = {}
  if (weekendExitEnabled !== undefined) updates.weekendExitEnabled = weekendExitEnabled
  if (weekendExitHourUTC !== undefined) updates.weekendExitHourUTC = weekendExitHourUTC
  if (maxHoldEnabled !== undefined) updates.maxHoldEnabled = maxHoldEnabled
  if (maxHoldHours !== undefined) updates.maxHoldHours = maxHoldHours
  if (enabled !== undefined) updates.timeExitsEnabled = enabled

  db.saveAllSettings(updates)
  res.json({
    success: true,
    message: 'Time exit settings updated',
    settings: timeExitManager.getStatus()
  })
})

// Toggle all Phase 1 features at once
app.post('/api/risk/phase1/toggle', authenticateJWT, (req, res) => {
  const { trailing, sizing, timeExits } = req.body

  const updates = {}
  if (trailing !== undefined) updates.useAdvancedTrailing = trailing
  if (sizing !== undefined) updates.useVolatilitySizing = sizing
  if (timeExits !== undefined) updates.timeExitsEnabled = timeExits

  db.saveAllSettings(updates)
  res.json({
    success: true,
    message: 'Phase 1 risk features toggled',
    status: {
      trailingStop: db.getSetting('useAdvancedTrailing'),
      positionSizing: db.getSetting('useVolatilitySizing'),
      timeExits: db.getSetting('timeExitsEnabled')
    }
  })
})

// Get available algorithms/methods for dropdowns
app.get('/api/risk/phase1/options', (req, res) => {
  res.json({
    trailingAlgorithms: Object.values(TrailingStopAlgorithm),
    sizingMethods: Object.values(SizingMethod),
    timeExitTypes: Object.values(TimeExitType)
  })
})

// ============================================
// PHASE 2 RISK ENDPOINTS: ADX Regime, MTF, Partial Profits
// ============================================

// Get combined status of all Phase 2 analysis services
app.get('/api/analysis/phase2/status', (req, res) => {
  res.json(getAnalysisServicesStatus())
})

// Get regime detection status
app.get('/api/analysis/regime/status', (req, res) => {
  res.json(regimeDetector.getStatus())
})

// Detect regime for a specific pair
app.post('/api/analysis/regime/detect', (req, res) => {
  const { pair, priceHistory } = req.body
  if (!pair || !priceHistory || !Array.isArray(priceHistory)) {
    return res.status(400).json({ error: 'pair and priceHistory array required' })
  }
  const result = regimeDetector.detectRegime(pair, priceHistory)
  res.json(result)
})

// Configure regime detection
app.post('/api/analysis/regime/configure', authenticateJWT, (req, res) => {
  const validKeys = [
    'regimeDetectionEnabled', 'adxPeriod', 'strongTrendThreshold',
    'trendThreshold', 'weakTrendThreshold', 'blockRangingTrades', 'blockVolatileTrades'
  ]
  const updates = {}
  for (const key of validKeys) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key]
    }
  }
  Object.entries(updates).forEach(([key, value]) => db.saveSetting(key, value))
  regimeDetector.clearCache()
  res.json({ success: true, updated: updates })
})

// Get multi-timeframe analysis status
app.get('/api/analysis/mtf/status', (req, res) => {
  res.json(mtfAnalyzer.getStatus())
})

// Analyze multiple timeframes for a pair
app.post('/api/analysis/mtf/analyze', (req, res) => {
  const { pair, priceHistory } = req.body
  if (!pair || !priceHistory || !Array.isArray(priceHistory)) {
    return res.status(400).json({ error: 'pair and priceHistory array required' })
  }
  const result = mtfAnalyzer.analyzeMultipleTimeframes(pair, priceHistory)
  res.json(result)
})

// Configure multi-timeframe analysis
app.post('/api/analysis/mtf/configure', authenticateJWT, (req, res) => {
  const validKeys = [
    'mtfEnabled', 'mtfPrimaryTimeframe', 'mtfConfirmationTimeframes',
    'mtfRequireAllAligned', 'mtfMinAlignmentScore'
  ]
  const updates = {}
  for (const key of validKeys) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key]
    }
  }
  Object.entries(updates).forEach(([key, value]) => db.saveSetting(key, value))
  mtfAnalyzer.clearCache()
  res.json({ success: true, updated: updates })
})

// Get partial profit manager status
app.get('/api/analysis/partial/status', (req, res) => {
  res.json(partialProfitManager.getStatus())
})

// Get partial profit progress for a specific trade
app.get('/api/analysis/partial/trade/:tradeId', (req, res) => {
  const progress = partialProfitManager.getTradeProgress(req.params.tradeId)
  if (!progress) {
    return res.status(404).json({ error: 'No partial profit tracking for this trade' })
  }
  res.json(progress)
})

// Configure partial profit taking
app.post('/api/analysis/partial/configure', authenticateJWT, (req, res) => {
  const validKeys = [
    'partialProfitsEnabled', 'partialProfitStrategy', 'partialProfitTargets',
    'moveToBreakevenAfterFirstTarget', 'trailAfterSecondTarget',
    'minPositionSizeForPartials', 'breakEvenBuffer'
  ]
  const updates = {}
  for (const key of validKeys) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key]
    }
  }
  Object.entries(updates).forEach(([key, value]) => db.saveSetting(key, value))
  res.json({ success: true, updated: updates })
})

// Toggle all Phase 2 features
app.post('/api/analysis/phase2/toggle', authenticateJWT, (req, res) => {
  const { enabled } = req.body
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled boolean required' })
  }

  db.saveSetting('regimeDetectionEnabled', enabled)
  db.saveSetting('mtfEnabled', enabled)
  db.saveSetting('partialProfitsEnabled', enabled)

  res.json({
    success: true,
    regimeDetectionEnabled: enabled,
    mtfEnabled: enabled,
    partialProfitsEnabled: enabled
  })
})

// Get available Phase 2 options for dropdowns
app.get('/api/analysis/phase2/options', (req, res) => {
  res.json({
    regimes: Object.values(MarketRegime),
    strategies: Object.keys(RegimeStrategy),
    timeframes: Object.keys(Timeframe),
    partialStrategies: Object.values(PartialCloseStrategy)
  })
})

// Full signal analysis with Phase 2 & 3
app.post('/api/analysis/signal', (req, res) => {
  const { pair, direction, priceHistory, baseConfidence } = req.body
  if (!pair || !direction || !priceHistory) {
    return res.status(400).json({ error: 'pair, direction, and priceHistory required' })
  }
  const result = analyzeSignal(pair, direction, priceHistory, baseConfidence || 50)
  res.json(result)
})

// ============================================
// PHASE 3: HURST EXPONENT ENDPOINTS
// ============================================

// Get Hurst analyzer status
app.get('/api/analysis/hurst/status', (req, res) => {
  res.json(hurstAnalyzer.getStatus())
})

// Analyze market character for a pair
app.post('/api/analysis/hurst/analyze', (req, res) => {
  const { pair, priceHistory } = req.body
  if (!pair || !priceHistory) {
    return res.status(400).json({ error: 'pair and priceHistory required' })
  }
  const result = hurstAnalyzer.analyzeMarketCharacter(pair, priceHistory)
  res.json(result)
})

// Calculate raw Hurst exponent
app.post('/api/analysis/hurst/calculate', (req, res) => {
  const { priceHistory, lookback } = req.body
  if (!priceHistory || !Array.isArray(priceHistory)) {
    return res.status(400).json({ error: 'priceHistory array required' })
  }
  const result = hurstAnalyzer.calculateHurst(priceHistory, lookback)
  res.json(result)
})

// Configure Hurst analyzer
app.post('/api/analysis/hurst/configure', authenticateJWT, (req, res) => {
  const validKeys = [
    'hurstEnabled', 'hurstMinDataPoints', 'hurstLookback',
    'hurstStrongTrendThreshold', 'hurstTrendThreshold',
    'hurstRandomUpperThreshold', 'hurstRandomLowerThreshold',
    'hurstMeanRevertThreshold', 'hurstAdjustConfidence', 'hurstBlockRandom'
  ]
  const updates = {}
  for (const key of validKeys) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key]
    }
  }
  Object.entries(updates).forEach(([key, value]) => db.saveSetting(key, value))
  hurstAnalyzer.clearCache()
  res.json({ success: true, updated: updates })
})

// ============================================
// PHASE 3: ORDER FLOW ENDPOINTS
// ============================================

// Get order flow analyzer status
app.get('/api/analysis/orderflow/status', (req, res) => {
  res.json(orderFlowAnalyzer.getStatus())
})

// Analyze order flow for a pair
app.post('/api/analysis/orderflow/analyze', (req, res) => {
  const { pair, priceHistory } = req.body
  if (!pair || !priceHistory) {
    return res.status(400).json({ error: 'pair and priceHistory required' })
  }
  const result = orderFlowAnalyzer.analyzeOrderFlow(pair, priceHistory)
  res.json(result)
})

// Get buy/sell pressure
app.post('/api/analysis/orderflow/pressure', (req, res) => {
  const { priceHistory } = req.body
  if (!priceHistory || !Array.isArray(priceHistory)) {
    return res.status(400).json({ error: 'priceHistory array required' })
  }
  const result = orderFlowAnalyzer.estimateBuySellPressure(priceHistory)
  res.json(result)
})

// Detect divergence
app.post('/api/analysis/orderflow/divergence', (req, res) => {
  const { priceHistory } = req.body
  if (!priceHistory || !Array.isArray(priceHistory)) {
    return res.status(400).json({ error: 'priceHistory array required' })
  }
  const result = orderFlowAnalyzer.detectDivergence(priceHistory)
  res.json(result)
})

// Get liquidity zones
app.post('/api/analysis/orderflow/liquidity', (req, res) => {
  const { priceHistory, bins } = req.body
  if (!priceHistory || !Array.isArray(priceHistory)) {
    return res.status(400).json({ error: 'priceHistory array required' })
  }
  const result = orderFlowAnalyzer.identifyLiquidityZones(priceHistory, bins || 20)
  res.json(result)
})

// Configure order flow analyzer
app.post('/api/analysis/orderflow/configure', authenticateJWT, (req, res) => {
  const validKeys = [
    'orderFlowEnabled', 'orderFlowLookback', 'orderFlowPressureThreshold',
    'orderFlowMomentumPeriod', 'orderFlowDivergenceLookback',
    'orderFlowLiquidityZones', 'orderFlowMinPressure'
  ]
  const updates = {}
  for (const key of validKeys) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key]
    }
  }
  Object.entries(updates).forEach(([key, value]) => db.saveSetting(key, value))
  orderFlowAnalyzer.clearCache()
  res.json({ success: true, updated: updates })
})

// ============================================
// PHASE 3: ENSEMBLE PREDICTION ENDPOINTS
// ============================================

// Get ensemble predictor status
app.get('/api/analysis/ensemble/status', (req, res) => {
  res.json(ensemblePredictor.getStatus())
})

// Run ensemble prediction
app.post('/api/analysis/ensemble/predict', async (req, res) => {
  const { pair, direction, priceHistory, baseConfidence } = req.body
  if (!pair || !direction || !priceHistory) {
    return res.status(400).json({ error: 'pair, direction, and priceHistory required' })
  }
  try {
    const result = await ensemblePredictor.predict(pair, priceHistory, direction, baseConfidence || 50)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Collect votes from all methods (without full prediction)
app.post('/api/analysis/ensemble/votes', async (req, res) => {
  const { pair, direction, priceHistory } = req.body
  if (!pair || !direction || !priceHistory) {
    return res.status(400).json({ error: 'pair, direction, and priceHistory required' })
  }
  try {
    const result = await ensemblePredictor.collectVotes(pair, priceHistory, direction)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Record prediction outcome for adaptive weights
app.post('/api/analysis/ensemble/outcome', authenticateJWT, (req, res) => {
  const { pair, direction, wasCorrect, votes } = req.body
  if (!pair || !direction || typeof wasCorrect !== 'boolean') {
    return res.status(400).json({ error: 'pair, direction, wasCorrect, and votes required' })
  }
  ensemblePredictor.recordOutcome(pair, direction, wasCorrect, votes || [])
  res.json({ success: true })
})

// Get adaptive weights
app.get('/api/analysis/ensemble/weights', (req, res) => {
  const adaptive = ensemblePredictor.getAdaptiveWeights()
  const config = ensemblePredictor.getConfig()
  res.json({
    configured: config.weights,
    adaptive,
    usingAdaptive: config.adaptiveWeights
  })
})

// Configure ensemble predictor
app.post('/api/analysis/ensemble/configure', authenticateJWT, (req, res) => {
  const validKeys = [
    'ensembleEnabled', 'ensembleMethod', 'ensembleMinAgreement',
    'ensembleWeights', 'ensembleAdaptiveWeights', 'ensembleMinAnalyses',
    'ensembleConsensusBoost', 'ensembleDisagreementPenalty'
  ]
  const updates = {}
  for (const key of validKeys) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key]
    }
  }
  Object.entries(updates).forEach(([key, value]) => db.saveSetting(key, value))
  res.json({ success: true, updated: updates })
})

// Clear ensemble performance history
app.post('/api/analysis/ensemble/clear', authenticateJWT, (req, res) => {
  ensemblePredictor.clearHistory()
  res.json({ success: true, message: 'Performance history cleared' })
})

// ============================================
// PHASE 3: COMBINED ENDPOINTS
// ============================================

// Toggle all Phase 3 features
app.post('/api/analysis/phase3/toggle', authenticateJWT, (req, res) => {
  const { enabled } = req.body
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled boolean required' })
  }

  db.saveSetting('hurstEnabled', enabled)
  db.saveSetting('orderFlowEnabled', enabled)
  db.saveSetting('ensembleEnabled', enabled)

  res.json({
    success: true,
    hurstEnabled: enabled,
    orderFlowEnabled: enabled,
    ensembleEnabled: enabled
  })
})

// Get available Phase 3 options for dropdowns
app.get('/api/analysis/phase3/options', (req, res) => {
  res.json({
    marketCharacters: Object.values(MarketCharacter),
    characterStrategies: Object.keys(CharacterStrategy),
    flowSignals: Object.values(FlowSignal),
    divergenceTypes: Object.values(DivergenceType),
    ensembleMethods: Object.values(EnsembleMethod)
  })
})

// Get all analysis services status (Phase 2 + 3)
app.get('/api/analysis/all/status', (req, res) => {
  res.json(getAnalysisServicesStatus())
})

// ============================================
// ANALYTICS ENDPOINTS (Phase A: Trust Foundation)
// ============================================

// Get full analytics summary
app.get('/api/analytics', (req, res) => {
  res.json(TradeAnalytics.getAnalyticsSummary())
})

// Get discovered patterns
app.get('/api/analytics/patterns', (req, res) => {
  const minTrades = boundedParseInt(req.query.minTrades, 10, 1, 1000)
  res.json(TradeAnalytics.getAllPatterns(minTrades))
})

// Get win rate by hour
app.get('/api/analytics/by-hour', (req, res) => {
  res.json(TradeAnalytics.getWinRateByHour())
})

// Get win rate by day of week
app.get('/api/analytics/by-day', (req, res) => {
  res.json(TradeAnalytics.getWinRateByDayOfWeek())
})

// Get win rate by session
app.get('/api/analytics/by-session', (req, res) => {
  res.json(TradeAnalytics.getWinRateBySession())
})

// Get win rate by RSI zones
app.get('/api/analytics/by-rsi', (req, res) => {
  res.json(TradeAnalytics.getWinRateByRSI())
})

// Get win rate by currency pair
app.get('/api/analytics/by-pair', (req, res) => {
  res.json(TradeAnalytics.getWinRateByPair())
})

// Get win rate by trend
app.get('/api/analytics/by-trend', (req, res) => {
  res.json(TradeAnalytics.getWinRateByTrend())
})

// Calculate confidence adjustment for current conditions
app.post('/api/analytics/confidence-adjustment', (req, res) => {
  const { rsi, marketSession, hourOfDay, trend } = req.body
  const result = TradeAnalytics.calculateConfidenceAdjustment({
    rsi, marketSession, hourOfDay, trend
  })
  res.json(result)
})

// Refresh stored patterns from trade data
app.post('/api/analytics/refresh-patterns', (req, res) => {
  const patterns = TradeAnalytics.refreshPatterns()
  res.json({ success: true, patterns })
})

// ============================================
// BACKTESTING ENDPOINTS (Phase A: Trust Foundation)
// ============================================

// Get available pairs for backtesting
app.get('/api/backtest/pairs', (req, res) => {
  res.json({
    pairs: FOREX_PAIRS,
    available: getAvailablePairs()
  })
})

// Get available date range for a pair
app.get('/api/backtest/range/:pair', (req, res) => {
  const pair = req.params.pair.replace('-', '/')
  res.json(getAvailableDateRange(pair))
})

// Prepare historical data for backtesting
app.post('/api/backtest/prepare', (req, res) => {
  try {
    const { pair, startDate, endDate } = req.body

    if (!pair || !startDate || !endDate) {
      return res.status(400).json({ error: 'pair, startDate, and endDate are required' })
    }

    const data = ensureHistoricalData(pair.replace('-', '/'), startDate, endDate, 60)
    res.json({
      success: true,
      pair: pair.replace('-', '/'),
      candles: data.length,
      startDate,
      endDate
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Run backtest
app.post('/api/backtest/run', async (req, res) => {
  try {
    const {
      pairs = ['EUR/USD'],
      startDate,
      endDate,
      initialBalance = 10000
    } = req.body

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' })
    }

    // Validate date range
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' })
    }
    if (end <= start) {
      return res.status(400).json({ error: 'endDate must be after startDate' })
    }

    // Run backtest
    const results = await runBacktest({
      pairs: pairs.map(p => p.replace('-', '/')),
      startDate,
      endDate,
      initialBalance
    })

    res.json(results)
  } catch (error) {
    console.error('Backtest error:', error)
    res.status(500).json({ error: error.message })
  }
})

// ============================================
// SWING TRADING ENDPOINTS
// ============================================

// Get swing trading status
app.get('/api/swing/status', async (req, res) => {
  try {
    const swingServices = await getSwingServices()
    if (!swingServices) {
      return res.json({
        available: false,
        error: 'Swing services not initialized'
      })
    }

    const settings = db.getAllSettings()
    res.json({
      available: true,
      enabled: settings.swingTradingEnabled,
      strategy: swingServices.swingStrategyEngine.getStatus(),
      exits: swingServices.swingExitManager.getStatus(),
      swingPoints: swingServices.swingPointDetector.getStatus(),
      fibonacci: swingServices.fibonacciAnalyzer.getStatus(),
      ml: swingServices.swingDirectionModel.getStatus(),
      dataCollector: swingServices.swingDataCollector.getStatus(),
      settings: {
        minHoldDays: settings.swingMinHoldDays,
        maxHoldDays: settings.swingMaxHoldDays,
        strategy: settings.swingStrategy,
        atrMultiplierSL: settings.swingATRMultiplierSL,
        mlEnabled: settings.swingMLEnabled
      }
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Toggle swing trading mode
app.post('/api/swing/toggle', authenticateJWT, (req, res) => {
  try {
    const { enabled } = req.body
    db.saveSetting('swingTradingEnabled', enabled)

    db.logActivity('SWING_TOGGLE', `Swing trading ${enabled ? 'enabled' : 'disabled'}`, {
      enabled,
      timestamp: new Date().toISOString()
    })

    res.json({
      success: true,
      swingTradingEnabled: enabled,
      message: enabled
        ? 'Swing trading enabled - multi-day trades now active'
        : 'Swing trading disabled - intraday mode restored'
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get swing prediction for a pair
app.post('/api/swing/predict', async (req, res) => {
  try {
    const { pair } = req.body
    if (!pair) {
      return res.status(400).json({ error: 'pair is required' })
    }

    const swingServices = await getSwingServices()
    if (!swingServices) {
      return res.status(503).json({ error: 'Swing services not available' })
    }

    // Get price history
    const priceHistory = db.getPriceHistory(pair.replace('-', '/'), 100).map(h => h.price).reverse()
    if (priceHistory.length < 30) {
      return res.status(400).json({ error: 'Insufficient price history' })
    }

    // Get daily candles
    const dailyCandles = swingServices.candleAggregator.getCandlesForAnalysis(pair.replace('-', '/'), 50)
    if (dailyCandles.length < 30) {
      return res.status(400).json({ error: 'Insufficient daily candle data' })
    }

    // Generate swing prediction
    const { generateSwingPrediction } = await import('./services/mlPrediction.js')
    const prediction = await generateSwingPrediction(pair.replace('-', '/'), priceHistory, dailyCandles)

    res.json(prediction)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get daily candles for a pair
app.get('/api/swing/candles/:pair', async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/')
    const limit = boundedParseInt(req.query.limit, 50, 1, 500)

    const swingServices = await getSwingServices()
    if (!swingServices) {
      return res.status(503).json({ error: 'Swing services not available' })
    }

    const candles = swingServices.candleAggregator.getCandlesForAnalysis(pair, limit)
    res.json({
      pair,
      count: candles.length,
      candles
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get swing points for a pair
app.get('/api/swing/points/:pair', async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/')

    const swingServices = await getSwingServices()
    if (!swingServices) {
      return res.status(503).json({ error: 'Swing services not available' })
    }

    const candles = swingServices.candleAggregator.getCandlesForAnalysis(pair, 50)
    if (candles.length < 20) {
      return res.status(400).json({ error: 'Insufficient candle data' })
    }

    const swingPoints = swingServices.swingPointDetector.detectAllSwingPoints(candles)
    const keyLevels = swingServices.swingPointDetector.findKeyLevels(candles)
    const structure = swingServices.swingPointDetector.analyzeMarketStructure(candles)

    res.json({
      pair,
      swingPoints,
      keyLevels,
      marketStructure: structure
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get Fibonacci levels for a pair
app.get('/api/swing/fibonacci/:pair', async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/')

    const swingServices = await getSwingServices()
    if (!swingServices) {
      return res.status(503).json({ error: 'Swing services not available' })
    }

    const candles = swingServices.candleAggregator.getCandlesForAnalysis(pair, 50)
    if (candles.length < 20) {
      return res.status(400).json({ error: 'Insufficient candle data' })
    }

    const swingHighs = swingServices.swingPointDetector.detectSwingHighs(candles)
    const swingLows = swingServices.swingPointDetector.detectSwingLows(candles)

    if (swingHighs.length === 0 || swingLows.length === 0) {
      return res.json({ pair, levels: null, reason: 'No swing points detected' })
    }

    const lastHigh = swingHighs[swingHighs.length - 1]
    const lastLow = swingLows[swingLows.length - 1]
    const direction = lastHigh.index > lastLow.index ? 'DOWN' : 'UP'

    const levels = swingServices.fibonacciAnalyzer.calculateAllLevels(
      lastHigh.price,
      lastLow.price,
      direction
    )

    const currentPrice = candles[candles.length - 1].close
    const position = swingServices.fibonacciAnalyzer.analyzePosition(
      currentPrice,
      lastHigh.price,
      lastLow.price,
      direction
    )

    res.json({
      pair,
      swingHigh: lastHigh,
      swingLow: lastLow,
      direction,
      levels,
      currentPosition: position
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Train swing ML model
app.post('/api/swing/ml/train', authenticateJWT, async (req, res) => {
  try {
    const swingServices = await getSwingServices()
    if (!swingServices) {
      return res.status(503).json({ error: 'Swing services not available' })
    }

    const result = await swingServices.swingDirectionModel.train(req.body)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get swing ML training data count
app.get('/api/swing/ml/training-data', async (req, res) => {
  try {
    const count = db.getSwingTrainingDataCount()
    const settings = db.getAllSettings()
    const minRequired = settings.swingMLMinSamples || 500

    res.json({
      count,
      minRequired,
      readyForTraining: count >= minRequired,
      mlEnabled: settings.swingMLEnabled
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Toggle swing ML
app.post('/api/swing/ml/toggle', authenticateJWT, (req, res) => {
  try {
    const { enabled } = req.body
    db.saveSetting('swingMLEnabled', enabled)

    db.logActivity('SWING_ML_TOGGLE', `Swing ML ${enabled ? 'enabled' : 'disabled'}`, {
      enabled,
      timestamp: new Date().toISOString()
    })

    res.json({ success: true, swingMLEnabled: enabled })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Generate synthetic training data from historical candles
app.post('/api/swing/ml/generate-synthetic', authenticateJWT, async (req, res) => {
  try {
    const { pair, lookforward = 7 } = req.body
    if (!pair) {
      return res.status(400).json({ error: 'pair is required' })
    }

    const swingServices = await getSwingServices()
    if (!swingServices) {
      return res.status(503).json({ error: 'Swing services not available' })
    }

    const candles = swingServices.candleAggregator.getCandlesForAnalysis(pair.replace('-', '/'), 500)
    const result = await swingServices.swingDataCollector.generateSyntheticData(
      pair.replace('-', '/'),
      candles,
      lookforward
    )

    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Configure swing trading settings
app.post('/api/swing/configure', authenticateJWT, (req, res) => {
  const validKeys = [
    'swingTradingEnabled', 'swingMinHoldDays', 'swingMaxHoldDays', 'swingMinHoldHours',
    'swingStrategy', 'swingPullbackFibLevels', 'swingMinADX', 'swingMaxADX',
    'swingATRMultiplierSL', 'swingATRMultiplierTP', 'swingPartialTP1Percent',
    'swingPartialTP2Percent', 'swingPartialTP3Percent', 'swingTrailBelowSwingPoint',
    'swingSwingPointLookback', 'swingMLEnabled', 'swingMLMinSamples', 'swingMLConfidenceThreshold'
  ]

  const updates = {}
  for (const key of validKeys) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key]
    }
  }

  db.saveAllSettings(updates)
  res.json({
    success: true,
    updated: updates,
    settings: db.getAllSettings()
  })
})

// ============================================
// ML ENDPOINTS (Phase B: Real ML Implementation)
// ============================================

// Get ML service status
app.get('/api/ml/status', async (req, res) => {
  try {
    const ml = await getMLService()
    if (!ml) {
      return res.json({
        available: false,
        error: 'ML service not initialized'
      })
    }
    res.json({
      available: true,
      ...ml.getStatus()
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get training data statistics
app.get('/api/ml/training-data', async (req, res) => {
  try {
    const count = db.getMLTrainingDataCount()
    const minRequired = db.getSetting('minTradesForTraining') || 200
    const data = db.getMLTrainingData(boundedParseInt(req.query.limit, 100, 1, 1000))

    res.json({
      count,
      minRequired,
      readyForTraining: count >= minRequired,
      recentSamples: data.slice(0, 10)  // Preview of recent samples
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Train ML model (requires auth)
app.post('/api/ml/train', authenticateJWT, async (req, res) => {
  try {
    const ml = await getMLService()
    if (!ml) {
      return res.status(503).json({ error: 'ML service not available' })
    }

    const result = await ml.train()
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get A/B test status
app.get('/api/ml/ab-test/status', async (req, res) => {
  try {
    const ml = await getMLService()
    if (!ml) {
      return res.json({ active: null, history: [] })
    }
    res.json(ml.getABTestResults())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Start A/B test
app.post('/api/ml/ab-test/start', authenticateJWT, async (req, res) => {
  try {
    const ml = await getMLService()
    if (!ml) {
      return res.status(503).json({ error: 'ML service not available' })
    }

    const { testName } = req.body
    const result = ml.startABTest(testName)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Stop A/B test
app.post('/api/ml/ab-test/stop', authenticateJWT, async (req, res) => {
  try {
    const ml = await getMLService()
    if (!ml) {
      return res.status(503).json({ error: 'ML service not available' })
    }

    const result = ml.stopABTest()
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get model history
app.get('/api/ml/models', async (req, res) => {
  try {
    const active = db.getActiveMLModel()
    const history = db.getMLModelHistory(boundedParseInt(req.query.limit, 10, 1, 100))
    res.json({ active, history })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Activate a specific model version
app.post('/api/ml/models/:id/activate', authenticateJWT, async (req, res) => {
  try {
    const modelId = parseInt(req.params.id)
    db.activateMLModel(modelId)

    // Reinitialize ML service to load new model
    const ml = await getMLService()
    if (ml) {
      mlServiceInstance = null  // Force reinitialize
      await getMLService()
    }

    res.json({ success: true, modelId })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Toggle ML for SL/TP
app.post('/api/ml/toggle', authenticateJWT, async (req, res) => {
  try {
    const { enabled } = req.body
    db.saveSetting('useMLForSLTP', enabled)

    db.logActivity('ML_TOGGLE', `ML for SL/TP ${enabled ? 'enabled' : 'disabled'}`, {
      enabled,
      timestamp: new Date().toISOString()
    })

    res.json({ success: true, useMLForSLTP: enabled })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Toggle accelerated data collection mode
app.post('/api/ml/accelerate', authenticateJWT, async (req, res) => {
  try {
    const { enabled } = req.body
    db.saveSetting('mlAcceleratedCollection', enabled)

    // When enabling accelerated mode, also lower confidence threshold
    if (enabled) {
      db.logActivity('ML_ACCELERATED', 'Accelerated data collection ENABLED', {
        enabled: true,
        acceleratedMinConfidence: db.getSetting('mlAcceleratedMinConfidence'),
        timestamp: new Date().toISOString()
      })
    } else {
      db.logActivity('ML_ACCELERATED', 'Accelerated data collection DISABLED', {
        enabled: false,
        timestamp: new Date().toISOString()
      })
    }

    res.json({
      success: true,
      mlAcceleratedCollection: enabled,
      message: enabled
        ? 'Accelerated collection enabled - lower thresholds active'
        : 'Accelerated collection disabled - normal thresholds restored'
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ============================================
// SHARIAH COMPLIANCE ENDPOINTS
// ============================================

import { shariahComplianceService } from './services/shariah/index.js'

// Get Shariah compliance status
app.get('/api/shariah/status', (req, res) => {
  res.json(shariahComplianceService.getComplianceStatus())
})

// Toggle Shariah mode
app.post('/api/shariah/toggle', (req, res) => {
  try {
    const { enabled } = req.body
    db.saveSetting('shariahCompliant', enabled)

    if (enabled) {
      shariahComplianceService.initialize()
    }

    db.logActivity('SHARIAH_TOGGLE', `Shariah mode ${enabled ? 'enabled' : 'disabled'}`, {
      enabled,
      timestamp: new Date().toISOString()
    })

    res.json({
      success: true,
      shariahCompliant: enabled,
      status: shariahComplianceService.getComplianceStatus()
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get swap deadline info
app.get('/api/shariah/swap-deadline', (req, res) => {
  res.json(shariahComplianceService.checkSwapDeadline())
})

// Emergency close all positions (Shariah-compliant closure)
app.post('/api/shariah/close-all', async (req, res) => {
  try {
    const activeTrades = db.getActiveTrades()
    if (activeTrades.length === 0) {
      return res.json({ success: true, closed: 0, message: 'No active trades to close' })
    }

    const rates = await fetchLiveRates()
    const priceMap = getPriceMap(rates)

    const closed = await shariahComplianceService.autoCloseForSwap(
      activeTrades,
      priceMap,
      executionEngine
    )

    res.json({
      success: true,
      closed: closed.length,
      trades: closed,
      message: `Closed ${closed.length} positions for Shariah compliance - الحمد لله`
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get fee breakdown for a trade
app.get('/api/shariah/fees/:tradeId', (req, res) => {
  try {
    const tradeId = parseInt(req.params.tradeId)
    const trade = db.getTradeById(tradeId)

    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' })
    }

    // Get fee info from activity log
    const activityLog = db.getActivityLog(100)
    const feeLog = activityLog.find(a =>
      a.type === 'SHARIAH_FEE_TRACKING' &&
      a.data?.includes(`"tradeId":${tradeId}`)
    )

    const fees = feeLog ? JSON.parse(feeLog.data) : {
      tradeId,
      pair: trade.pair,
      commission: 0,
      spreadCost: 0,
      totalFees: 0,
      message: 'No fee data recorded'
    }

    res.json(fees)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Validate a potential trade for Shariah compliance
app.post('/api/shariah/validate', (req, res) => {
  try {
    const { prediction } = req.body
    const settings = db.getAllSettings()

    if (!prediction) {
      return res.status(400).json({ error: 'Prediction data required' })
    }

    const result = shariahComplianceService.validateTrade(prediction, settings)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Kill switch - emergency stop
app.post('/api/killswitch', killSwitchRateLimiter, async (req, res) => {
  try {
    const { closePositions = false } = req.body

    // Stop the bot immediately
    stopBot()

    // Log the emergency stop
    db.logActivity('KILL_SWITCH', 'Emergency kill switch activated', {
      closePositions,
      timestamp: new Date().toISOString()
    })

    // Close all positions if requested
    let closedTrades = []
    if (closePositions) {
      const rates = await fetchLiveRates()
      const priceMap = getPriceMap(rates)
      closedTrades = closeAllTrades(priceMap)
    }

    // Switch to simulation mode for safety
    ibConnector.setMode('SIMULATION')

    res.json({
      success: true,
      message: 'Kill switch activated - bot stopped, mode set to SIMULATION',
      closedTrades: closedTrades.length,
      trades: closedTrades
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Catch-all: serve React app for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'))
})

// ============================================
// CRON JOB - Run bot every minute
// ============================================

// Load price history on startup
loadPriceHistory()

// Auto-connect to IB if mode is PAPER or LIVE
const startupMode = db.getSetting('tradingMode') || 'SIMULATION'
if (startupMode === 'PAPER' || startupMode === 'LIVE') {
  console.log(`Mode is ${startupMode}, attempting IB auto-connect...`)
  ibConnector.connect().then(result => {
    if (result.success) {
      console.log('✅ IB auto-connected successfully')
      db.logActivity('IB_AUTO_CONNECT', 'Auto-connected to IB Gateway on startup', { mode: startupMode })
      // Start connection monitoring after successful auto-connect
      ibConnectionMonitor.start()
      console.log('✅ Connection monitoring started')

      // Auto-subscribe to market data for forex pairs (needed for paper trading fills)
      setTimeout(() => {
        try {
          ibMarketData.initialize()
          const subscriptions = ibMarketData.subscribeAll()
          console.log(`✅ Auto-subscribed to ${subscriptions.length} forex pairs for market data`)
          db.logActivity('MARKET_DATA_AUTO_SUBSCRIBE', 'Auto-subscribed to forex market data', { pairs: subscriptions.length })
        } catch (err) {
          console.log(`⚠️ Failed to auto-subscribe market data: ${err.message}`)
        }
      }, 2000) // Wait 2s for IB connection to stabilize
    } else {
      console.log(`⚠️ IB auto-connect failed: ${result.error}`)
      console.log('⚠️ Fallback activated: IB not connected. Using SIMULATION mode.')
      db.logActivity('IB_AUTO_CONNECT_FAILED', `Failed to auto-connect: ${result.error}`, { mode: startupMode })
    }
  }).catch(err => {
    console.log(`⚠️ IB auto-connect error: ${err.message}`)
    console.log('⚠️ Fallback activated: IB not connected. Using SIMULATION mode.')
  })
}

// Schedule bot to run every minute
cron.schedule('* * * * *', async () => {
  console.log(`\n[${new Date().toISOString()}] Cron triggered`)
  await runBotCycle()
})

// Also run on startup after a short delay
setTimeout(async () => {
  console.log('Running initial bot cycle...')
  await runBotCycle()
}, 5000)

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  const currentMode = db.getSetting('tradingMode') || 'SIMULATION'
  console.log(`
╔════════════════════════════════════════════════════════╗
║     FOREX TRADING BOT SERVER                           ║
║     Running on port ${PORT}                                ║
╠════════════════════════════════════════════════════════╣
║  Bot Endpoints:                                        ║
║  GET  /api/health       - Health check                 ║
║  GET  /api/bot/status   - Bot status                   ║
║  POST /api/bot/start    - Start bot                    ║
║  POST /api/bot/stop     - Stop bot                     ║
╠════════════════════════════════════════════════════════╣
║  Trading Endpoints:                                    ║
║  GET  /api/trades       - Active trades                ║
║  GET  /api/stats        - Trading stats                ║
║  GET  /api/settings     - Bot settings                 ║
╠════════════════════════════════════════════════════════╣
║  Interactive Brokers:                                  ║
║  GET  /api/ib/status    - IB connection + health       ║
║  POST /api/ib/connect   - Connect to IB Gateway        ║
║  POST /api/ib/disconnect- Disconnect from IB           ║
║  GET  /api/ib/account   - IB account info              ║
║  GET  /api/ib/positions - IB positions                 ║
╠════════════════════════════════════════════════════════╣
║  Connection Monitoring (Phase D):                      ║
║  GET  /api/ib/health    - Detailed health metrics      ║
║  POST /api/ib/health/check - Manual health check       ║
║  GET  /api/ib/health/simple - Simple health (for LB)   ║
╠════════════════════════════════════════════════════════╣
║  Mode Control:                                         ║
║  GET  /api/mode         - Current trading mode         ║
║  PUT  /api/mode         - Switch mode                  ║
║  POST /api/killswitch   - Emergency stop               ║
╠════════════════════════════════════════════════════════╣
║  Current Mode: ${currentMode.padEnd(10)} | Bot runs every minute    ║
╚════════════════════════════════════════════════════════╝
  `)

  db.logActivity('SERVER_STARTED', `Server started on port ${PORT}`, { mode: currentMode })
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...')
  ibConnectionMonitor.stop()
  db.logActivity('SERVER_STOPPED', 'Server shutdown')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...')
  ibConnectionMonitor.stop()
  db.logActivity('SERVER_STOPPED', 'Server shutdown')
  process.exit(0)
})
