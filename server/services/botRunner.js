/**
 * Bot Runner - Main 24/7 Trading Loop
 * Runs continuously, fetching prices and executing trades
 */

import * as db from '../database.js'
import { fetchLiveRates, getPriceMap } from './forexApi.js'
import { generatePrediction, validatePrediction } from './mlPrediction.js'
import { executeTrade, updateAllTrades, canOpenTrade } from './tradeExecutor.js'

// Bot state
let isRunning = false
let lastRun = null
let runCount = 0
let priceHistories = {}

// Initialize price histories
const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'EUR/GBP']
PAIRS.forEach(pair => {
  priceHistories[pair] = []
})

/**
 * Load price history from database
 */
export function loadPriceHistory() {
  PAIRS.forEach(pair => {
    const history = db.getPriceHistory(pair, 100)
    priceHistories[pair] = history.map(h => h.price).reverse()
  })
  console.log('Price history loaded from database')
}

/**
 * Main bot cycle
 */
export async function runBotCycle() {
  const settings = db.getAllSettings()

  if (!settings.enabled) {
    console.log('Bot is disabled, skipping cycle')
    return { skipped: true, reason: 'Bot disabled' }
  }

  isRunning = true
  runCount++
  const cycleStart = Date.now()

  try {
    console.log(`\n=== Bot Cycle #${runCount} Started ===`)

    // 1. Fetch current prices
    const rates = await fetchLiveRates()
    const priceMap = getPriceMap(rates)

    console.log('Fetched prices:', Object.keys(priceMap).length, 'pairs')

    // 2. Update price history
    rates.forEach(r => {
      if (!priceHistories[r.pair]) {
        priceHistories[r.pair] = []
      }
      priceHistories[r.pair].unshift(r.rate)
      // Keep last 100 prices
      if (priceHistories[r.pair].length > 100) {
        priceHistories[r.pair].pop()
      }
      // Save to database
      db.savePriceHistory(r.pair, r.rate)
    })

    // 3. Update active trades with current prices
    const tradeResults = updateAllTrades(priceMap)
    if (tradeResults.closed.length > 0) {
      console.log(`Auto-closed ${tradeResults.closed.length} trades`)
      tradeResults.closed.forEach(t => {
        console.log(`  - ${t.pair}: ${t.close_reason} (${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)})`)
      })
    }

    // 4. Resolve old predictions
    const unresolvedPredictions = db.getUnresolvedPredictions()
    unresolvedPredictions.forEach(pred => {
      const currentPrice = priceMap[pred.pair]
      if (currentPrice) {
        const result = validatePrediction(pred, currentPrice)
        if (result.resolved) {
          db.resolvePrediction(pred.id, result.outcome, result.correct, result.pnlPips, result.priceAtResolution)
          console.log(`Resolved prediction ${pred.id}: ${result.outcome}`)
        }
      }
    })

    // 5. Generate new predictions and execute trades
    const newPredictions = []
    const executedTrades = []

    for (const pair of PAIRS) {
      if (priceHistories[pair].length < 30) {
        console.log(`${pair}: Not enough price history (${priceHistories[pair].length}/30)`)
        continue
      }

      // Check if we can open a trade on this pair
      const canOpen = canOpenTrade(settings, pair)
      if (!canOpen.allowed) {
        continue
      }

      // Generate prediction
      const prediction = generatePrediction(pair, priceHistories[pair])

      if (prediction && prediction.confidence >= settings.minConfidence) {
        // Log prediction
        const predId = db.logPrediction(prediction)
        prediction.id = predId
        newPredictions.push(prediction)

        console.log(`${pair}: ${prediction.signal} @ ${prediction.confidence}% confidence`)

        // Execute trade
        const result = executeTrade(prediction, settings)
        if (result.success) {
          executedTrades.push(result.trade)
          console.log(`  -> Trade executed: ${result.trade.position_size} lots`)
        } else {
          console.log(`  -> Trade skipped: ${result.reason}`)
        }
      }
    }

    // 6. Clean old price history periodically
    if (runCount % 60 === 0) { // Every hour
      db.cleanOldPriceHistory(7)
      console.log('Cleaned old price history')
    }

    lastRun = new Date()
    const cycleTime = Date.now() - cycleStart

    const summary = {
      cycle: runCount,
      timestamp: lastRun.toISOString(),
      cycleTimeMs: cycleTime,
      activeTrades: db.getActiveTrades().length,
      closedThisCycle: tradeResults.closed.length,
      newPredictions: newPredictions.length,
      executedTrades: executedTrades.length,
      accountBalance: settings.accountBalance
    }

    console.log(`=== Cycle Complete (${cycleTime}ms) ===`)
    console.log(`Active: ${summary.activeTrades} | Closed: ${summary.closedThisCycle} | New: ${summary.executedTrades}`)

    db.logActivity('BOT_CYCLE', `Cycle #${runCount} completed`, summary)

    return summary

  } catch (error) {
    console.error('Bot cycle error:', error)
    db.logActivity('BOT_ERROR', error.message, { stack: error.stack })
    return { error: error.message }
  } finally {
    isRunning = false
  }
}

/**
 * Get bot status
 */
export function getBotStatus() {
  const settings = db.getAllSettings()
  return {
    enabled: settings.enabled,
    isRunning,
    lastRun: lastRun?.toISOString(),
    runCount,
    priceHistoryLength: Object.fromEntries(
      Object.entries(priceHistories).map(([k, v]) => [k, v.length])
    )
  }
}

/**
 * Start bot
 */
export function startBot() {
  db.saveSetting('enabled', true)
  db.logActivity('BOT_STARTED', 'Bot enabled')
  return { success: true, message: 'Bot started' }
}

/**
 * Stop bot
 */
export function stopBot() {
  db.saveSetting('enabled', false)
  db.logActivity('BOT_STOPPED', 'Bot disabled')
  return { success: true, message: 'Bot stopped' }
}

/**
 * Get price histories
 */
export function getPriceHistories() {
  return priceHistories
}
