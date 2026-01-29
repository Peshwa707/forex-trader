/**
 * Bot Runner - Main 24/7 Trading Loop
 * Runs continuously, fetching prices and executing trades
 * Now uses unified ExecutionEngine for SIMULATION/PAPER/LIVE modes
 *
 * Phase 1 Risk Improvements:
 * - Time-based exit checks (weekend, session, max hold)
 * - Integration with advanced trailing stops
 * - Volatility-aware position sizing
 */

import * as db from '../database.js'
import { fetchLiveRates, getPriceMap, getPriceSource } from './forexApi.js'
import { generatePrediction, generateSwingPrediction, validatePrediction, generateDetailedExplanation, generateTradeResultExplanation } from './mlPrediction.js'
import { analyzeForML } from './technicalAnalysis.js'
import { executionEngine } from './execution/ExecutionEngine.js'
import { shariahComplianceService } from './shariah/index.js'
import { timeExitManager } from './risk/TimeExitManager.js'
import { trailingStopManager } from './risk/TrailingStopManager.js'
import { partialProfitManager } from './analysis/PartialProfitManager.js'
import { regimeDetector } from './analysis/RegimeDetector.js'

// Swing Trading Services (lazy loaded)
let candleAggregator = null
let swingExitManager = null
let swingDataCollector = null

async function getSwingServices() {
  if (!candleAggregator) {
    try {
      const candleModule = await import('./data/CandleAggregator.js')
      candleAggregator = candleModule.candleAggregator

      const swingModule = await import('./swing/index.js')
      swingExitManager = swingModule.swingExitManager

      const dataModule = await import('./ml/SwingDataCollector.js')
      swingDataCollector = dataModule.swingDataCollector
    } catch (error) {
      console.warn('[BotRunner] Swing services not available:', error.message)
      return null
    }
  }
  return { candleAggregator, swingExitManager, swingDataCollector }
}

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

  // Initialize execution engine
  executionEngine.initialize()
  console.log(`Execution engine initialized: ${executionEngine.getStatus().mode} mode`)
}

// Mutex to prevent concurrent bot cycles
let cycleInProgress = false

/**
 * Main bot cycle
 */
export async function runBotCycle() {
  // Prevent concurrent cycles (race condition protection)
  if (cycleInProgress) {
    console.log('Bot cycle already in progress, skipping')
    return { skipped: true, reason: 'Cycle already running' }
  }

  const settings = db.getAllSettings()

  if (!settings.enabled) {
    console.log('Bot is disabled, skipping cycle')
    return { skipped: true, reason: 'Bot disabled' }
  }

  cycleInProgress = true
  isRunning = true
  runCount++
  const cycleStart = Date.now()

  try {
    console.log(`\n=== Bot Cycle #${runCount} Started ===`)

    // 1. Fetch current prices
    const rates = await fetchLiveRates()
    const priceMap = getPriceMap(rates)

    console.log('Fetched prices:', Object.keys(priceMap).length, 'pairs')

    // Shariah Compliance: Check swap deadline
    if (settings.shariahCompliant) {
      const swapDeadline = shariahComplianceService.checkSwapDeadline()

      // Auto-close all positions if past cutoff (before 5pm EST swap time)
      if (swapDeadline.pastCutoff) {
        const activeTrades = db.getActiveTrades()
        if (activeTrades.length > 0) {
          console.log(`[Shariah] Past swap cutoff - auto-closing ${activeTrades.length} positions`)
          const closed = await shariahComplianceService.autoCloseForSwap(
            activeTrades,
            priceMap,
            executionEngine
          )
          console.log(`[Shariah] Closed ${closed.length} positions - الحمد لله`)
        }
        console.log('[Shariah] No new trades allowed until after swap time')
        return {
          skipped: true,
          reason: 'Shariah: Past swap cutoff time',
          shariahCompliance: swapDeadline
        }
      }

      // Warning if within 2 hours of cutoff
      if (swapDeadline.withinTwoHours) {
        console.log(`[Shariah] Warning: ${swapDeadline.minutesUntilCutoff} minutes until swap cutoff - limiting new trades`)
      }
    }

    // Phase 1: Time-Based Exit Checks
    if (settings.timeExitsEnabled) {
      const timeExitCheck = timeExitManager.checkTimeExits()

      if (timeExitCheck.shouldExit) {
        const activeTrades = db.getActiveTrades()
        if (activeTrades.length > 0) {
          console.log(`[TimeExit] ${timeExitCheck.reason} - closing ${activeTrades.length} positions`)

          for (const trade of activeTrades) {
            const price = priceMap[trade.pair]
            if (price) {
              await executionEngine.closeTrade(trade.id, price, timeExitCheck.type)
              console.log(`  - Closed ${trade.pair}: ${timeExitCheck.type}`)
              // Clean up trailing stop state
              trailingStopManager.removeTrade(trade.id)
            }
          }

          db.logActivity('TIME_EXIT', timeExitCheck.reason, {
            type: timeExitCheck.type,
            tradesClose: activeTrades.length
          })
        }

        // Block new trades during time exit periods
        if (timeExitCheck.type === 'WEEKEND') {
          return {
            skipped: true,
            reason: timeExitCheck.reason,
            timeExit: timeExitCheck
          }
        }
      }

      // Check individual trades for max hold time
      if (settings.maxHoldEnabled) {
        const tradesToClose = timeExitManager.checkAllTradesForExit(db.getActiveTrades())
        for (const { trade, reason, type } of tradesToClose) {
          const price = priceMap[trade.pair]
          if (price) {
            console.log(`[TimeExit] ${trade.pair}: ${reason}`)
            await executionEngine.closeTrade(trade.id, price, type)
            trailingStopManager.removeTrade(trade.id)
          }
        }
      }
    }

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

    // 2b. Update daily candles for swing trading
    if (settings.swingTradingEnabled) {
      const swingServices = await getSwingServices()
      if (swingServices?.candleAggregator) {
        for (const [pair, price] of Object.entries(priceMap)) {
          swingServices.candleAggregator.updateCurrentDayCandle(pair, price)
        }
      }
    }

    // 3. Update active trades with current prices (using ExecutionEngine)
    const tradeResults = await executionEngine.updateAllTrades(priceMap)
    if (tradeResults.closed.length > 0) {
      console.log(`Auto-closed ${tradeResults.closed.length} trades`)
      tradeResults.closed.forEach(t => {
        console.log(`  - ${t.pair}: ${t.close_reason} (${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)})`)
        // Phase A: Log trade result explanation
        const resultExplanation = generateTradeResultExplanation(t)
        db.logActivity('TRADE_EXPLANATION', resultExplanation.reason, resultExplanation)
        // Phase 2: Clean up partial profit tracking
        partialProfitManager.removeTrade(t.id)
        trailingStopManager.removeTrade(t.id)
        regimeDetector.clearCache()
      })
    }

    // Phase 2: Check partial profit targets for active trades
    if (settings.partialProfitsEnabled) {
      const activeTrades = db.getActiveTrades()
      for (const trade of activeTrades) {
        const currentPrice = priceMap[trade.pair]
        if (!currentPrice) continue

        const partialCheck = partialProfitManager.checkPartialCloseTargets(trade, currentPrice)

        for (const action of partialCheck.actions) {
          if (action.type === 'PARTIAL_CLOSE') {
            console.log(`[PartialProfit] ${trade.pair}: Target ${action.targetIndex + 1} hit at ${action.rMultiple.toFixed(2)}R`)
            console.log(`  -> Closing ${action.closePercent}% (${action.closeSize} lots)`)

            // Execute partial close through execution engine
            try {
              const closeResult = await executionEngine.executePartialClose?.(trade, action.closeSize, currentPrice)
              if (closeResult?.success) {
                db.logActivity('PARTIAL_CLOSE', `Partial close ${trade.pair}: ${action.closePercent}%`, {
                  tradeId: trade.id,
                  pair: trade.pair,
                  closeSize: action.closeSize,
                  rMultiple: action.rMultiple,
                  targetIndex: action.targetIndex
                })
              }
            } catch (err) {
              console.warn(`[PartialProfit] Failed to execute partial close:`, err.message)
            }
          }

          if (action.type === 'MOVE_STOP_TO_BREAKEVEN') {
            console.log(`[PartialProfit] ${trade.pair}: Moving stop to break-even @ ${action.newStop.toFixed(5)}`)
            db.updateTrade(trade.id, { trailing_stop: action.newStop })
          }

          if (action.type === 'ACTIVATE_TRAILING') {
            console.log(`[PartialProfit] ${trade.pair}: Activating trailing stop on remainder`)
            // Trailing will be handled by TrailingStopManager on next update
          }
        }
      }
    }

    // Swing Trading: Check swing trade exits and update tracking
    if (settings.swingTradingEnabled) {
      const swingServices = await getSwingServices()
      if (swingServices) {
        const activeTrades = db.getActiveTrades().filter(t => t.is_swing_trade)

        for (const trade of activeTrades) {
          const currentPrice = priceMap[trade.pair]
          if (!currentPrice) continue

          // Update ML data collector tracking
          swingServices.swingDataCollector?.updateTradeTracking(trade.id, currentPrice)

          // Get daily candles for swing exit analysis
          const dailyCandles = swingServices.candleAggregator.getCandlesForAnalysis(trade.pair, 30)

          if (dailyCandles.length >= 10) {
            const exitAnalysis = swingServices.swingExitManager.analyzeSwingExit(trade, currentPrice, dailyCandles)

            // Process exit actions
            for (const action of exitAnalysis.actions) {
              if (action.type === 'PARTIAL_CLOSE') {
                console.log(`[SwingExit] ${trade.pair}: ${action.targetName} - closing ${action.closePercent}%`)
                // Execute partial close
                try {
                  await executionEngine.executePartialClose?.(trade, trade.position_size * (action.closePercent / 100), currentPrice)
                } catch (err) {
                  console.warn(`[SwingExit] Partial close failed:`, err.message)
                }
              }

              if (action.type === 'MOVE_STOP') {
                console.log(`[SwingExit] ${trade.pair}: ${action.reason} - new stop @ ${action.newStop.toFixed(5)}`)
                db.updateTrade(trade.id, { trailing_stop: action.newStop })
              }

              if (action.type === 'TIME_EXIT') {
                console.log(`[SwingExit] ${trade.pair}: ${action.reason}`)
              }
            }

            // Close trade if needed
            if (exitAnalysis.shouldClose) {
              console.log(`[SwingExit] Closing ${trade.pair}: ${exitAnalysis.closeReason}`)
              await executionEngine.closeTrade(trade.id, currentPrice, exitAnalysis.closeReason)

              // Record exit for ML training
              const closedTrade = db.getTradeById(trade.id)
              if (closedTrade) {
                swingServices.swingDataCollector?.recordExit(closedTrade)
              }

              // Clean up state
              swingServices.swingExitManager.removeTrade(trade.id)
            }
          }
        }
      }
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

      // Check if we can open a trade on this pair (using ExecutionEngine)
      const canOpen = executionEngine.canOpenTrade(settings, pair)
      if (!canOpen.allowed) {
        console.log(`${pair}: Cannot open trade - ${canOpen.reason}`)
        continue
      }

      // Pre-trade spread validation for live/paper modes
      const engineStatus = executionEngine.getStatus()
      if (engineStatus.mode !== 'SIMULATION') {
        const spreadCheck = await executionEngine.checkSpreadForPair?.(pair)
        if (spreadCheck && !spreadCheck.acceptable) {
          console.log(`${pair}: Skipping due to wide spread - ${spreadCheck.reason}`)
          db.logActivity('TRADE_SKIPPED_SPREAD', `Skipped ${pair} due to spread`, spreadCheck)
          continue
        }
      }

      // Generate prediction (async for ML and Phase 3 integration)
      // Pass daily candles for swing trading if enabled
      let dailyCandles = null
      if (settings.swingTradingEnabled) {
        const swingServices = await getSwingServices()
        if (swingServices?.candleAggregator) {
          dailyCandles = swingServices.candleAggregator.getCandlesForAnalysis(pair, 50)
        }
      }

      const prediction = await generatePrediction(pair, priceHistories[pair], { dailyCandles })

      // Use lower threshold in accelerated ML collection mode
      const effectiveMinConfidence = settings.mlAcceleratedCollection
        ? (settings.mlAcceleratedMinConfidence || 50)
        : settings.minConfidence

      if (prediction && prediction.confidence >= effectiveMinConfidence) {
        // Log prediction
        const predId = db.logPrediction(prediction)
        prediction.id = predId
        newPredictions.push(prediction)

        const engineStatus = executionEngine.getStatus()
        console.log(`${pair}: ${prediction.signal} @ ${prediction.confidence}% confidence [${engineStatus.activeExecutor}]`)

        // Execute trade through ExecutionEngine
        const result = await executionEngine.executeTrade(prediction, settings)
        if (result.success) {
          executedTrades.push(result.trade)
          const tradeType = prediction.isSwing ? 'SWING' : 'INTRADAY'
          console.log(`  -> ${tradeType} Trade executed: ${result.trade.position_size} lots (${result.mode || 'SIMULATION'})`)
          // Phase A: Log trade execution explanation
          const explanation = generateDetailedExplanation(prediction, 'EXECUTE', settings)
          db.logActivity('TRADE_EXPLANATION', explanation.reason, explanation)

          // Record entry for ML swing training data
          if (prediction.isSwing && settings.swingTradingEnabled) {
            const swingServices = await getSwingServices()
            const dailyCandles = swingServices?.candleAggregator?.getCandlesForAnalysis(pair, 50)
            if (swingServices?.swingDataCollector && dailyCandles) {
              const analysis = analyzeForML?.(priceHistories[pair]) || {}
              swingServices.swingDataCollector.recordEntry(
                result.trade,
                pair,
                dailyCandles,
                priceHistories[pair],
                analysis.indicators || {},
                prediction.strategy
              )
            }
          }
        } else {
          console.log(`  -> Trade skipped: ${result.reason}`)
          // Phase A: Log skipped trade explanation
          const explanation = generateDetailedExplanation(prediction, 'SKIP_RISK_LIMIT', settings)
          explanation.reason = `Trade blocked: ${result.reason}`
          db.logActivity('TRADE_EXPLANATION', explanation.reason, explanation)
        }
      } else if (prediction) {
        // Phase A: Log low confidence skip explanation
        const explanation = generateDetailedExplanation(prediction, 'SKIP_LOW_CONFIDENCE', settings)
        db.logActivity('TRADE_EXPLANATION', explanation.reason, explanation)
        const modeNote = settings.mlAcceleratedCollection ? ' (accelerated mode)' : ''
        console.log(`${pair}: Skipped - confidence ${prediction.confidence}% < ${effectiveMinConfidence}% threshold${modeNote}`)
      }
    }

    // 6. Clean old price history periodically
    if (runCount % 60 === 0) { // Every hour
      db.cleanOldPriceHistory(7)
      console.log('Cleaned old price history')
    }

    lastRun = new Date()
    const cycleTime = Date.now() - cycleStart
    const engineStatus = executionEngine.getStatus()

    const summary = {
      cycle: runCount,
      timestamp: lastRun.toISOString(),
      cycleTimeMs: cycleTime,
      activeTrades: db.getActiveTrades().length,
      closedThisCycle: tradeResults.closed.length,
      newPredictions: newPredictions.length,
      executedTrades: executedTrades.length,
      accountBalance: settings.accountBalance,
      executionMode: engineStatus.mode,
      activeExecutor: engineStatus.activeExecutor,
      priceSource: getPriceSource(),
      ibConnected: engineStatus.ibConnected
    }

    console.log(`=== Cycle Complete (${cycleTime}ms) [${engineStatus.activeExecutor}] ===`)
    console.log(`Active: ${summary.activeTrades} | Closed: ${summary.closedThisCycle} | New: ${summary.executedTrades} | Source: ${summary.priceSource}`)

    db.logActivity('BOT_CYCLE', `Cycle #${runCount} completed`, summary)

    return summary

  } catch (error) {
    console.error('Bot cycle error:', error)
    db.logActivity('BOT_ERROR', error.message, { stack: error.stack })
    return { error: error.message }
  } finally {
    isRunning = false
    cycleInProgress = false
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
