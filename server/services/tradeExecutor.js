/**
 * Trade Executor Service for Server
 * Handles automated trade execution and management
 *
 * NOTE: This module now primarily delegates to ExecutionEngine.
 * Direct functions are maintained for backward compatibility.
 * For new code, prefer using executionEngine directly.
 *
 * Phase 1 Risk Improvements:
 * - ATR-based trailing stops
 * - Volatility-adjusted position sizing
 * - Time-based exit checks
 */

import * as db from '../database.js'
import { executionEngine } from './execution/ExecutionEngine.js'
import { trailingStopManager } from './risk/TrailingStopManager.js'
import { positionSizer } from './risk/PositionSizer.js'

/**
 * Calculate position size based on risk
 * Phase 1: Now supports volatility-adjusted sizing
 * Shariah compliance: Enforces max leverage limit when enabled
 *
 * @param {Object} settings - Trading settings
 * @param {number} stopLossPips - Stop loss distance in pips
 * @param {string} pair - Currency pair
 * @param {number[]} priceHistory - Optional price history for volatility calc
 */
export function calculatePositionSize(settings, stopLossPips, pair, priceHistory = []) {
  // Phase 1: Use volatility-adjusted position sizing if enabled
  if (settings.useVolatilitySizing) {
    const result = positionSizer.calculatePositionSize({
      accountBalance: settings.accountBalance,
      stopLossPips,
      pair,
      priceHistory,
      settings
    })

    console.log(`[PositionSizer] ${result.method}: ${result.lots.toFixed(3)} lots (${result.riskPercent.toFixed(2)}% risk) - ${result.reason}`)

    return result.lots
  }

  // Original fixed fractional calculation
  const riskAmount = settings.accountBalance * (settings.riskPerTrade / 100)
  const pipValuePerLot = pair.includes('JPY') ? 1000 : 10
  let lots = riskAmount / (stopLossPips * pipValuePerLot)

  // Shariah compliance: Enforce max leverage
  if (settings.shariahCompliant) {
    const maxLeverage = settings.shariahMaxLeverage || 5
    const standardLotValue = 100000  // Standard forex lot = $100,000
    const maxPositionValue = settings.accountBalance * maxLeverage
    const maxLots = maxPositionValue / standardLotValue

    if (lots > maxLots) {
      console.log(`[Shariah] Reducing position from ${lots.toFixed(3)} to ${maxLots.toFixed(3)} lots (1:${maxLeverage} leverage limit)`)
      lots = maxLots
    }
  }

  return Math.min(Math.max(0.01, parseFloat(lots.toFixed(2))), 1)
}

/**
 * Check if we can open a new trade
 */
export function canOpenTrade(settings, pair) {
  const activeTrades = db.getActiveTrades()
  const todaysTrades = db.getTodaysTrades()

  // Check max open trades
  if (activeTrades.length >= settings.maxOpenTrades) {
    return { allowed: false, reason: 'Max open trades reached' }
  }

  // Check if already have a trade on this pair
  if (activeTrades.some(t => t.pair === pair)) {
    return { allowed: false, reason: 'Already have trade on this pair' }
  }

  // Check if pair is allowed
  const allowedPairs = Array.isArray(settings.allowedPairs)
    ? settings.allowedPairs
    : JSON.parse(settings.allowedPairs || '[]')

  if (!allowedPairs.includes(pair)) {
    return { allowed: false, reason: 'Pair not in allowed list' }
  }

  // Check daily trade limit
  if (todaysTrades.length >= settings.maxDailyTrades) {
    return { allowed: false, reason: 'Daily trade limit reached' }
  }

  // Check daily loss limit
  const todaysLoss = todaysTrades
    .filter(t => t.status === 'CLOSED' && t.pnl < 0)
    .reduce((sum, t) => sum + Math.abs(t.pnl), 0)

  const maxLossAmount = settings.accountBalance * (settings.maxDailyLoss / 100)
  if (todaysLoss >= maxLossAmount) {
    return { allowed: false, reason: 'Daily loss limit reached' }
  }

  // Check trading hours (for server, we allow 24/7 by default)
  const tradingHours = typeof settings.tradingHours === 'string'
    ? JSON.parse(settings.tradingHours)
    : settings.tradingHours

  if (tradingHours && tradingHours.start !== undefined) {
    const hour = new Date().getUTCHours()
    if (hour < tradingHours.start || hour >= tradingHours.end) {
      return { allowed: false, reason: 'Outside trading hours' }
    }
  }

  return { allowed: true }
}

/**
 * Execute a new trade
 */
export function executeTrade(prediction, settings) {
  const canOpen = canOpenTrade(settings, prediction.pair)
  if (!canOpen.allowed) {
    return { success: false, reason: canOpen.reason }
  }

  // Check minimum confidence
  if (prediction.confidence < settings.minConfidence) {
    return { success: false, reason: 'Confidence below minimum' }
  }

  const pipValue = prediction.pair.includes('JPY') ? 0.01 : 0.0001
  const entryPrice = parseFloat(prediction.entryPrice)
  const stopLoss = parseFloat(prediction.stopLoss)

  const stopLossPips = Math.abs(entryPrice - stopLoss) / pipValue
  const positionSize = calculatePositionSize(settings, stopLossPips, prediction.pair)

  const trade = {
    pair: prediction.pair,
    direction: prediction.direction,
    signal: prediction.signal,
    entryPrice: prediction.entryPrice,
    stopLoss: prediction.stopLoss,
    takeProfit: prediction.takeProfit,
    trailingStop: settings.useTrailingStop ? prediction.stopLoss : null,
    positionSize,
    confidence: prediction.confidence,
    reasoning: prediction.reasoning
  }

  const createdTrade = db.createTrade(trade)
  db.logActivity('TRADE_OPENED', `Opened ${prediction.signal} ${prediction.pair}`, {
    tradeId: createdTrade.id,
    confidence: prediction.confidence
  })

  return { success: true, trade: createdTrade }
}

/**
 * Update trade with current price
 * Phase 1: Now supports ATR-based trailing stops
 *
 * @param {Object} trade - Trade object
 * @param {number} currentPrice - Current market price
 * @param {number[]} priceHistory - Optional price history for ATR calculation
 */
export function updateTradePrice(trade, currentPrice, priceHistory = []) {
  const current = parseFloat(currentPrice)
  const entry = parseFloat(trade.entry_price)
  const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

  // Calculate P/L
  let pnlPips
  if (trade.direction === 'UP') {
    pnlPips = (current - entry) / pipValue
  } else {
    pnlPips = (entry - current) / pipValue
  }

  // Estimate P/L in dollars
  const pipValuePerLot = trade.pair.includes('JPY') ? 1000 : 10
  const pnl = pnlPips * trade.position_size * pipValuePerLot

  // Update trailing stop
  const settings = db.getAllSettings()
  let trailingStop = trade.trailing_stop
  let trailingReason = null

  // Phase 1: Use advanced ATR-based trailing if enabled
  if (settings.useAdvancedTrailing && settings.useTrailingStop) {
    const trailingResult = trailingStopManager.calculateTrailingStop(trade, current, priceHistory)

    if (trailingResult.newStop !== null) {
      trailingStop = trailingResult.newStop
      trailingReason = trailingResult.reason
      console.log(`[TrailingStop] ${trade.pair}: ${trailingReason} → new stop: ${trailingStop.toFixed(5)}`)
    } else if (trailingResult.activated === false) {
      // Log why trailing not activated yet
      if (pnlPips > 0) {
        console.log(`[TrailingStop] ${trade.pair}: ${trailingResult.reason}`)
      }
    }
  }
  // Original fixed trailing stop logic
  else if (settings.useTrailingStop && pnlPips > settings.trailingStopPips) {
    if (trade.direction === 'UP') {
      const newStop = current - (settings.trailingStopPips * pipValue)
      trailingStop = Math.max(parseFloat(trade.stop_loss), newStop)
    } else {
      const newStop = current + (settings.trailingStopPips * pipValue)
      trailingStop = Math.min(parseFloat(trade.stop_loss), newStop)
    }
    trailingReason = `Fixed: ${settings.trailingStopPips} pips`
  }

  db.updateTrade(trade.id, {
    currentPrice: current,
    pnlPips: parseFloat(pnlPips.toFixed(1)),
    pnl: parseFloat(pnl.toFixed(2)),
    trailingStop
  })

  return { pnlPips, pnl, trailingStop, trailingReason }
}

/**
 * Check if trade should be closed (hit TP/SL)
 */
export function checkTradeExit(trade, currentPrice) {
  const current = parseFloat(currentPrice)
  const stopLoss = parseFloat(trade.trailing_stop || trade.stop_loss)
  const takeProfit = parseFloat(trade.take_profit)

  let shouldClose = false
  let closeReason = null

  if (trade.direction === 'UP') {
    if (current <= stopLoss) {
      shouldClose = true
      closeReason = 'STOP_LOSS'
    } else if (current >= takeProfit) {
      shouldClose = true
      closeReason = 'TAKE_PROFIT'
    }
  } else {
    if (current >= stopLoss) {
      shouldClose = true
      closeReason = 'STOP_LOSS'
    } else if (current <= takeProfit) {
      shouldClose = true
      closeReason = 'TAKE_PROFIT'
    }
  }

  if (shouldClose) {
    return closeTradeById(trade.id, currentPrice, closeReason)
  }

  return null
}

/**
 * Close a trade
 */
export function closeTradeById(tradeId, exitPrice, reason = 'MANUAL') {
  const trade = db.getTradeById(tradeId)
  if (!trade || trade.status !== 'OPEN') return null

  const exit = parseFloat(exitPrice)
  const entry = parseFloat(trade.entry_price)
  const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

  // Final P/L calculation
  let pnlPips
  if (trade.direction === 'UP') {
    pnlPips = (exit - entry) / pipValue
  } else {
    pnlPips = (entry - exit) / pipValue
  }

  const pipValuePerLot = trade.pair.includes('JPY') ? 1000 : 10
  const pnl = pnlPips * trade.position_size * pipValuePerLot

  const closedTrade = db.closeTrade(tradeId, exit, reason, pnlPips, pnl)

  // Update account balance
  const settings = db.getAllSettings()
  db.saveSetting('accountBalance', settings.accountBalance + pnl)

  db.logActivity('TRADE_CLOSED', `Closed ${trade.pair} - ${reason}`, {
    tradeId,
    pnl: pnl.toFixed(2),
    pnlPips: pnlPips.toFixed(1),
    reason
  })

  return closedTrade
}

/**
 * Close all active trades
 */
export function closeAllTrades(currentPrices) {
  const activeTrades = db.getActiveTrades()
  const closed = []

  activeTrades.forEach(trade => {
    const price = currentPrices[trade.pair]
    if (price) {
      const result = closeTradeById(trade.id, price, 'CLOSE_ALL')
      if (result) closed.push(result)
    }
  })

  return closed
}

/**
 * Update all active trades with current prices
 */
export function updateAllTrades(currentPrices) {
  const activeTrades = db.getActiveTrades()
  const results = {
    updated: [],
    closed: []
  }

  activeTrades.forEach(trade => {
    const price = currentPrices[trade.pair]
    if (price) {
      // First update the price
      updateTradePrice(trade, price)

      // Then check for exit
      const exitResult = checkTradeExit(trade, price)
      if (exitResult) {
        results.closed.push(exitResult)
      } else {
        results.updated.push(trade)
      }
    }
  })

  return results
}

/**
 * Reset account
 * NOTE: Delegates to ExecutionEngine. Only works in SIMULATION mode.
 */
export function resetAccount(balance = 10000) {
  // Try to use execution engine (handles mode checking)
  try {
    return executionEngine.resetAccount(balance)
  } catch (error) {
    // Fallback to direct reset if engine not initialized
    const activeTrades = db.getActiveTrades()
    activeTrades.forEach(trade => {
      db.closeTrade(trade.id, trade.current_price || trade.entry_price, 'RESET', 0, 0)
    })

    db.saveSetting('accountBalance', balance)
    db.logActivity('ACCOUNT_RESET', `Account reset to $${balance}`)

    return db.getAllSettings()
  }
}

// Re-export execution engine for direct access
export { executionEngine }
