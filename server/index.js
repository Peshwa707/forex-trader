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
import { runBotCycle, getBotStatus, startBot, stopBot, loadPriceHistory, getPriceHistories } from './services/botRunner.js'
import { closeTradeById, closeAllTrades, resetAccount } from './services/tradeExecutor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

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

// Start bot
app.post('/api/bot/start', (req, res) => {
  res.json(startBot())
})

// Stop bot
app.post('/api/bot/stop', (req, res) => {
  res.json(stopBot())
})

// Trigger manual bot cycle
app.post('/api/bot/run', async (req, res) => {
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

// Get settings
app.get('/api/settings', (req, res) => {
  res.json(db.getAllSettings())
})

// Update settings
app.put('/api/settings', (req, res) => {
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
  const limit = parseInt(req.query.limit) || 100
  res.json(db.getTradeHistory(limit))
})

// Close a trade
app.post('/api/trades/:id/close', async (req, res) => {
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

// Close all trades
app.post('/api/trades/close-all', async (req, res) => {
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
  const limit = parseInt(req.query.limit) || 100
  res.json(db.getPredictions(limit))
})

// Get activity log
app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 50
  res.json(db.getActivityLog(limit))
})

// Get price history for a pair
app.get('/api/prices/:pair/history', (req, res) => {
  const pair = req.params.pair.replace('-', '/')
  const limit = parseInt(req.query.limit) || 100
  res.json(db.getPriceHistory(pair, limit))
})

// Reset account
app.post('/api/account/reset', (req, res) => {
  const balance = parseFloat(req.body.balance) || 10000
  res.json(resetAccount(balance))
})

// Export all data
app.get('/api/export', (req, res) => {
  res.json({
    settings: db.getAllSettings(),
    activeTrades: db.getActiveTrades(),
    tradeHistory: db.getTradeHistory(500),
    predictions: db.getPredictions(500),
    stats: db.getTradingStats(),
    exportedAt: new Date().toISOString()
  })
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
  console.log(`
╔════════════════════════════════════════════╗
║     FOREX TRADING BOT SERVER               ║
║     Running on port ${PORT}                    ║
╠════════════════════════════════════════════╣
║  API Endpoints:                            ║
║  GET  /api/health     - Health check       ║
║  GET  /api/bot/status - Bot status         ║
║  POST /api/bot/start  - Start bot          ║
║  POST /api/bot/stop   - Stop bot           ║
║  GET  /api/trades     - Active trades      ║
║  GET  /api/stats      - Trading stats      ║
║  GET  /api/settings   - Bot settings       ║
╠════════════════════════════════════════════╣
║  Bot runs every minute automatically       ║
╚════════════════════════════════════════════╝
  `)

  db.logActivity('SERVER_STARTED', `Server started on port ${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...')
  db.logActivity('SERVER_STOPPED', 'Server shutdown')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...')
  db.logActivity('SERVER_STOPPED', 'Server shutdown')
  process.exit(0)
})
