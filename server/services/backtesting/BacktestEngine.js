/**
 * Backtest Engine
 * Part of Phase A: Trust Foundation - Backtesting System
 *
 * Simulates bot trading decisions on historical data
 */

import { ensureHistoricalData, FOREX_PAIRS } from './HistoricalDataStore.js'
import { analyzePrice } from '../technicalAnalysis.js'
import { getAllSettings } from '../../database.js'

// Phase 3: Lazy load analysis services
let analysisServices = null
async function getAnalysisServices() {
  if (!analysisServices) {
    try {
      const module = await import('../analysis/index.js')
      analysisServices = module
    } catch (error) {
      console.warn('[BacktestEngine] Failed to load analysis services:', error.message)
      return null
    }
  }
  return analysisServices
}

/**
 * Run a backtest simulation
 */
export async function runBacktest(config) {
  const {
    pairs = ['EUR/USD'],
    startDate,
    endDate,
    initialBalance = 10000,
    settings = null, // Use current settings if not provided
    progressCallback = null
  } = config

  // Get settings
  const tradingSettings = settings || getAllSettings()
  const {
    minConfidence = 65,
    takeProfitPips = 20,
    stopLossPips = 10,
    tradeSize = 0.01 // Mini lots
  } = tradingSettings

  // Initialize backtest state
  const state = {
    balance: initialBalance,
    equity: initialBalance,
    openTrades: [],
    closedTrades: [],
    equityCurve: [],
    dailyStats: {},
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    peakEquity: initialBalance
  }

  // Load historical data
  const historicalData = {}
  for (const pair of pairs) {
    historicalData[pair] = ensureHistoricalData(pair, startDate, endDate, 60)
  }

  // Get all timestamps across all pairs
  const allTimestamps = new Set()
  for (const pair of pairs) {
    historicalData[pair].forEach(candle => allTimestamps.add(candle.timestamp))
  }
  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b)

  // Build price history windows for technical analysis
  const priceHistoryWindow = {} // Rolling window of last N candles
  for (const pair of pairs) {
    priceHistoryWindow[pair] = []
  }

  let processedCandles = 0
  const totalCandles = sortedTimestamps.length

  // Process each timestamp
  for (const timestamp of sortedTimestamps) {
    processedCandles++

    // Update price histories
    for (const pair of pairs) {
      const candle = historicalData[pair].find(c => c.timestamp === timestamp)
      if (candle) {
        priceHistoryWindow[pair].push(candle)
        // Keep last 100 candles for analysis
        if (priceHistoryWindow[pair].length > 100) {
          priceHistoryWindow[pair].shift()
        }
      }
    }

    // Current prices
    const currentPrices = {}
    for (const pair of pairs) {
      const candles = priceHistoryWindow[pair]
      if (candles.length > 0) {
        currentPrices[pair] = candles[candles.length - 1].close
      }
    }

    // Check open trades for SL/TP
    checkOpenTrades(state, currentPrices, timestamp, tradeSize)

    // Only trade if we have enough history
    const canTrade = Object.values(priceHistoryWindow).every(h => h.length >= 30)
    if (!canTrade) continue

    // Respect max concurrent trades
    const maxConcurrentTrades = tradingSettings.maxConcurrentTrades || 3
    if (state.openTrades.length >= maxConcurrentTrades) continue

    // Generate predictions for each pair
    for (const pair of pairs) {
      // Skip if already have a trade for this pair
      if (state.openTrades.some(t => t.pair === pair)) continue

      const history = priceHistoryWindow[pair]
      if (history.length < 30) continue

      const prediction = await generateBacktestPrediction(pair, history, tradingSettings)

      if (prediction && prediction.confidence >= minConfidence) {
        // Execute trade
        const entryPrice = currentPrices[pair]
        const pipValue = pair.includes('JPY') ? 0.01 : 0.0001

        const trade = {
          id: `bt_${timestamp}_${pair.replace('/', '')}`,
          pair,
          direction: prediction.direction,
          entryPrice,
          entryTime: timestamp,
          stopLoss: prediction.direction === 'UP'
            ? entryPrice - (stopLossPips * pipValue)
            : entryPrice + (stopLossPips * pipValue),
          takeProfit: prediction.direction === 'UP'
            ? entryPrice + (takeProfitPips * pipValue)
            : entryPrice - (takeProfitPips * pipValue),
          size: tradeSize,
          confidence: prediction.confidence
        }

        state.openTrades.push(trade)
      }
    }

    // Update equity curve
    const unrealizedPnL = calculateUnrealizedPnL(state.openTrades, currentPrices)
    state.equity = state.balance + unrealizedPnL

    // Track drawdown
    if (state.equity > state.peakEquity) {
      state.peakEquity = state.equity
    }
    const currentDrawdown = state.peakEquity - state.equity
    if (currentDrawdown > state.maxDrawdown) {
      state.maxDrawdown = currentDrawdown
      state.maxDrawdownPercent = (currentDrawdown / state.peakEquity) * 100
    }

    // Record equity every 24 hours
    const date = new Date(timestamp).toISOString().split('T')[0]
    if (!state.dailyStats[date]) {
      state.dailyStats[date] = {
        date,
        balance: state.balance,
        equity: state.equity,
        trades: 0,
        wins: 0,
        pnl: 0
      }
      state.equityCurve.push({
        timestamp,
        date,
        equity: state.equity,
        balance: state.balance
      })
    }

    // Progress callback
    if (progressCallback && processedCandles % 100 === 0) {
      progressCallback({
        progress: (processedCandles / totalCandles) * 100,
        currentDate: new Date(timestamp).toISOString().split('T')[0],
        tradesExecuted: state.closedTrades.length
      })
    }
  }

  // Close any remaining open trades at final prices
  const finalPrices = {}
  for (const pair of pairs) {
    const candles = priceHistoryWindow[pair]
    if (candles.length > 0) {
      finalPrices[pair] = candles[candles.length - 1].close
    }
  }
  closeAllOpenTrades(state, finalPrices, sortedTimestamps[sortedTimestamps.length - 1], tradeSize, 'BACKTEST_END')

  // Calculate final statistics
  return calculateBacktestResults(state, initialBalance, startDate, endDate)
}

/**
 * Generate prediction for backtest (uses same logic as live bot)
 * Phase 3: Now supports Hurst, OrderFlow, and Ensemble analysis
 */
async function generateBacktestPrediction(pair, priceHistory, settings) {
  // Convert to format expected by technical analysis
  const formattedHistory = priceHistory.map(candle => ({
    price: candle.close,
    high: candle.high,
    low: candle.low,
    timestamp: candle.timestamp
  }))

  const analysis = analyzePrice(formattedHistory)
  if (!analysis) return null

  const { signals, trend, trendStrength, indicators } = analysis

  // Count signals
  let buyScore = 0
  let sellScore = 0
  let totalStrength = 0

  signals.forEach(signal => {
    const weight = signal.strength || 1
    totalStrength += weight
    if (signal.signal === 'BUY') buyScore += weight
    else sellScore += weight
  })

  // Add trend bias
  if (trend === 'UP') {
    buyScore += trendStrength * 0.5
    totalStrength += trendStrength * 0.5
  } else if (trend === 'DOWN') {
    sellScore += trendStrength * 0.5
    totalStrength += trendStrength * 0.5
  }

  const direction = buyScore > sellScore ? 'UP' : 'DOWN'
  const dominantScore = Math.max(buyScore, sellScore)
  const baseConfidence = totalStrength > 0 ? (dominantScore / totalStrength) * 100 : 50

  const signalAgreement = signals.filter(s =>
    (direction === 'UP' && s.signal === 'BUY') ||
    (direction === 'DOWN' && s.signal === 'SELL')
  ).length / Math.max(signals.length, 1)

  let confidence = Math.min(90, Math.max(30, baseConfidence * 0.6 + signalAgreement * 40))

  // Phase 3: Advanced analysis integration
  let phase3Analysis = null
  let phase3Blocked = false
  let _phase3BlockReason = null

  if (settings.hurstEnabled || settings.orderFlowEnabled || settings.ensembleEnabled) {
    try {
      const analysisModule = await getAnalysisServices()
      if (analysisModule) {
        phase3Analysis = {}

        // Hurst exponent analysis
        if (settings.hurstEnabled && analysisModule.hurstAnalyzer) {
          const hurstResult = analysisModule.hurstAnalyzer.analyze(pair, formattedHistory)
          phase3Analysis.hurst = hurstResult
          // Adjust confidence based on market character
          if (hurstResult && hurstResult.character) {
            if (hurstResult.character === 'RANDOM') {
              confidence *= 0.85 // Reduce confidence in random markets
            } else if (hurstResult.character === 'STRONG_TREND' && trend !== 'NEUTRAL') {
              confidence *= 1.1 // Boost confidence in strong trends
            }
          }
        }

        // Order flow analysis
        if (settings.orderFlowEnabled && analysisModule.orderFlowAnalyzer) {
          const flowResult = analysisModule.orderFlowAnalyzer.analyze(pair, formattedHistory)
          phase3Analysis.orderFlow = flowResult
          // Check for divergence (flow against direction)
          if (flowResult && flowResult.signal) {
            const flowBullish = ['STRONG_BUY', 'BUY'].includes(flowResult.signal)
            const flowBearish = ['STRONG_SELL', 'SELL'].includes(flowResult.signal)
            if ((direction === 'UP' && flowBearish) || (direction === 'DOWN' && flowBullish)) {
              confidence *= 0.8 // Reduce confidence on divergence
            }
          }
        }

        // Ensemble prediction
        if (settings.ensembleEnabled && analysisModule.ensemblePredictor) {
          const ensembleResult = await analysisModule.ensemblePredictor.predict(
            pair, formattedHistory, direction, confidence
          )
          phase3Analysis.ensemble = ensembleResult
          if (ensembleResult && ensembleResult.enabled) {
            // Apply ensemble confidence adjustment
            if (ensembleResult.confidence !== confidence) {
              confidence = ensembleResult.confidence
            }
            // Block trade if no consensus
            if (!ensembleResult.consensus) {
              phase3Blocked = true
              _phase3BlockReason = `Ensemble: ${ensembleResult.reason}`
            }
          }
        }
      }
    } catch (err) {
      console.warn('[BacktestEngine] Phase 3 analysis failed:', err.message)
    }
  }

  // Clamp confidence
  confidence = Math.min(95, Math.max(25, confidence))

  // Return null if blocked by Phase 3
  if (phase3Blocked) {
    return null
  }

  return {
    pair,
    direction,
    confidence: Math.round(confidence),
    indicators,
    phase3Analysis
  }
}

/**
 * Check open trades for stop loss / take profit hits
 */
function checkOpenTrades(state, currentPrices, timestamp, tradeSize) {
  const tradesToClose = []

  for (const trade of state.openTrades) {
    const price = currentPrices[trade.pair]
    if (!price) continue

    let closeReason = null

    if (trade.direction === 'UP') {
      if (price >= trade.takeProfit) closeReason = 'TP_HIT'
      else if (price <= trade.stopLoss) closeReason = 'SL_HIT'
    } else {
      if (price <= trade.takeProfit) closeReason = 'TP_HIT'
      else if (price >= trade.stopLoss) closeReason = 'SL_HIT'
    }

    if (closeReason) {
      tradesToClose.push({ trade, price, closeReason, timestamp })
    }
  }

  // Close trades
  for (const { trade, price, closeReason, timestamp } of tradesToClose) {
    closeTrade(state, trade, price, timestamp, tradeSize, closeReason)
  }
}

/**
 * Close a single trade
 */
function closeTrade(state, trade, exitPrice, exitTime, tradeSize, closeReason) {
  const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001
  const pnlPips = trade.direction === 'UP'
    ? (exitPrice - trade.entryPrice) / pipValue
    : (trade.entryPrice - exitPrice) / pipValue

  // Calculate P/L in dollars (roughly $10 per pip per standard lot)
  const pnlDollars = pnlPips * 10 * (tradeSize / 1) // Adjust for lot size

  const closedTrade = {
    ...trade,
    exitPrice,
    exitTime,
    closeReason,
    pnlPips: Math.round(pnlPips * 10) / 10,
    pnlDollars: Math.round(pnlDollars * 100) / 100,
    duration: exitTime - trade.entryTime
  }

  state.closedTrades.push(closedTrade)
  state.balance += pnlDollars
  state.openTrades = state.openTrades.filter(t => t.id !== trade.id)

  // Update daily stats
  const date = new Date(exitTime).toISOString().split('T')[0]
  if (!state.dailyStats[date]) {
    state.dailyStats[date] = { date, balance: state.balance, equity: state.balance, trades: 0, wins: 0, pnl: 0 }
  }
  state.dailyStats[date].trades++
  state.dailyStats[date].pnl += pnlDollars
  if (pnlDollars > 0) state.dailyStats[date].wins++
}

/**
 * Close all open trades (end of backtest)
 */
function closeAllOpenTrades(state, prices, timestamp, tradeSize, reason) {
  for (const trade of [...state.openTrades]) {
    const price = prices[trade.pair]
    if (price) {
      closeTrade(state, trade, price, timestamp, tradeSize, reason)
    }
  }
}

/**
 * Calculate unrealized P/L for open trades
 */
function calculateUnrealizedPnL(openTrades, currentPrices) {
  let total = 0

  for (const trade of openTrades) {
    const price = currentPrices[trade.pair]
    if (!price) continue

    const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001
    const pnlPips = trade.direction === 'UP'
      ? (price - trade.entryPrice) / pipValue
      : (trade.entryPrice - price) / pipValue

    const pnlDollars = pnlPips * 10 * (trade.size / 1)
    total += pnlDollars
  }

  return total
}

/**
 * Calculate final backtest results and statistics
 */
function calculateBacktestResults(state, initialBalance, startDate, endDate) {
  const { balance, closedTrades, equityCurve, maxDrawdown, maxDrawdownPercent } = state

  const totalTrades = closedTrades.length
  const wins = closedTrades.filter(t => t.pnlDollars > 0).length
  const losses = closedTrades.filter(t => t.pnlDollars <= 0).length
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0

  const grossProfit = closedTrades.filter(t => t.pnlDollars > 0).reduce((sum, t) => sum + t.pnlDollars, 0)
  const grossLoss = Math.abs(closedTrades.filter(t => t.pnlDollars < 0).reduce((sum, t) => sum + t.pnlDollars, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  const totalReturn = balance - initialBalance
  const totalReturnPercent = (totalReturn / initialBalance) * 100

  // Calculate average trade
  const avgWin = wins > 0 ? grossProfit / wins : 0
  const avgLoss = losses > 0 ? grossLoss / losses : 0
  const avgTrade = totalTrades > 0 ? totalReturn / totalTrades : 0

  // Calculate Sharpe ratio (simplified)
  const dailyReturns = Object.values(state.dailyStats).map(d => d.pnl)
  const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length || 0
  const stdDev = Math.sqrt(
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / dailyReturns.length || 1
  )
  const sharpeRatio = stdDev > 0 ? (avgDailyReturn / stdDev) * Math.sqrt(252) : 0

  // Calculate longest winning/losing streaks
  let currentStreak = 0
  let longestWinStreak = 0
  let longestLoseStreak = 0

  for (const trade of closedTrades) {
    if (trade.pnlDollars > 0) {
      currentStreak = currentStreak > 0 ? currentStreak + 1 : 1
      longestWinStreak = Math.max(longestWinStreak, currentStreak)
    } else {
      currentStreak = currentStreak < 0 ? currentStreak - 1 : -1
      longestLoseStreak = Math.max(longestLoseStreak, Math.abs(currentStreak))
    }
  }

  return {
    summary: {
      startDate,
      endDate,
      initialBalance,
      finalBalance: Math.round(balance * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalReturnPercent: Math.round(totalReturnPercent * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100
    },
    trades: {
      total: totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 10) / 10,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      avgTrade: Math.round(avgTrade * 100) / 100,
      longestWinStreak,
      longestLoseStreak
    },
    risk: {
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100
    },
    equityCurve,
    tradeLog: closedTrades.map(t => ({
      id: t.id,
      pair: t.pair,
      direction: t.direction,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      entryTime: new Date(t.entryTime).toISOString(),
      exitTime: new Date(t.exitTime).toISOString(),
      pnlPips: t.pnlPips,
      pnlDollars: t.pnlDollars,
      closeReason: t.closeReason
    })),
    dailyStats: Object.values(state.dailyStats)
  }
}

export { FOREX_PAIRS }
