/**
 * Trade Executor Service for Server
 * Handles automated trade execution and management
 */

import * as db from '../database.js'

/**
 * Calculate position size based on risk
 */
export function calculatePositionSize(settings, stopLossPips, pair) {
  const riskAmount = settings.accountBalance * (settings.riskPerTrade / 100)
  const pipValuePerLot = pair.includes('JPY') ? 1000 : 10
  const lots = riskAmount / (stopLossPips * pipValuePerLot)
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
 */
export function updateTradePrice(trade, currentPrice) {
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

  // Update trailing stop if enabled
  const settings = db.getAllSettings()
  let trailingStop = trade.trailing_stop

  if (settings.useTrailingStop && pnlPips > settings.trailingStopPips) {
    if (trade.direction === 'UP') {
      const newStop = current - (settings.trailingStopPips * pipValue)
      trailingStop = Math.max(parseFloat(trade.stop_loss), newStop)
    } else {
      const newStop = current + (settings.trailingStopPips * pipValue)
      trailingStop = Math.min(parseFloat(trade.stop_loss), newStop)
    }
  }

  db.updateTrade(trade.id, {
    currentPrice: current,
    pnlPips: parseFloat(pnlPips.toFixed(1)),
    pnl: parseFloat(pnl.toFixed(2)),
    trailingStop
  })

  return { pnlPips, pnl, trailingStop }
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
 */
export function resetAccount(balance = 10000) {
  // Close all trades first
  const activeTrades = db.getActiveTrades()
  activeTrades.forEach(trade => {
    db.closeTrade(trade.id, trade.current_price || trade.entry_price, 'RESET', 0, 0)
  })

  db.saveSetting('accountBalance', balance)
  db.logActivity('ACCOUNT_RESET', `Account reset to $${balance}`)

  return db.getAllSettings()
}
