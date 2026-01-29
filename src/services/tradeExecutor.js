/**
 * Automated Trade Executor Service
 * Executes trades automatically based on ML predictions
 */

const ACTIVE_TRADES_KEY = 'forex_active_trades'
const TRADE_HISTORY_KEY = 'forex_trade_history'
const AUTO_SETTINGS_KEY = 'forex_auto_settings'

// Default auto-trading settings
const DEFAULT_SETTINGS = {
  enabled: false,
  maxOpenTrades: 6,
  riskPerTrade: 1, // Percentage of balance
  accountBalance: 10000,
  minConfidence: 60,
  maxDailyTrades: 10,
  maxDailyLoss: 5, // Percentage
  allowedPairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'EUR/GBP'],
  tradingHours: { start: 8, end: 20 }, // UTC
  useTrailingStop: false,
  trailingStopPips: 20
}

// Get auto-trading settings
export function getAutoSettings() {
  const stored = localStorage.getItem(AUTO_SETTINGS_KEY)
  if (stored) {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  }
  return DEFAULT_SETTINGS
}

// Save auto-trading settings
export function saveAutoSettings(settings) {
  localStorage.setItem(AUTO_SETTINGS_KEY, JSON.stringify(settings))
  return settings
}

// Get active trades
export function getActiveTrades() {
  return JSON.parse(localStorage.getItem(ACTIVE_TRADES_KEY) || '[]')
}

// Save active trades
function saveActiveTrades(trades) {
  localStorage.setItem(ACTIVE_TRADES_KEY, JSON.stringify(trades))
}

// Get trade history
export function getTradeHistory() {
  return JSON.parse(localStorage.getItem(TRADE_HISTORY_KEY) || '[]')
}

// Save trade history
function saveTradeHistory(history) {
  // Keep last 500 trades
  const trimmed = history.slice(-500)
  localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(trimmed))
}

// Calculate position size based on risk
export function calculatePositionSize(settings, stopLossPips, pair) {
  const riskAmount = settings.accountBalance * (settings.riskPerTrade / 100)

  // For simplicity: 1 standard lot = $10 per pip for most pairs
  const pipValuePerLot = pair.includes('JPY') ? 1000 : 10
  const lots = riskAmount / (stopLossPips * pipValuePerLot)

  return Math.min(Math.max(0.01, parseFloat(lots.toFixed(2))), 1) // Min 0.01, max 1 lot
}

// Check if we can open a new trade
export function canOpenTrade(settings, pair) {
  const activeTrades = getActiveTrades()
  const history = getTradeHistory()

  // Check max open trades
  if (activeTrades.length >= settings.maxOpenTrades) {
    return { allowed: false, reason: 'Max open trades reached' }
  }

  // Check if already have a trade on this pair
  if (activeTrades.some(t => t.pair === pair)) {
    return { allowed: false, reason: 'Already have trade on this pair' }
  }

  // Check if pair is allowed
  if (!settings.allowedPairs.includes(pair)) {
    return { allowed: false, reason: 'Pair not in allowed list' }
  }

  // Check daily trade limit
  const today = new Date().toDateString()
  const todaysTrades = history.filter(t =>
    new Date(t.openedAt).toDateString() === today
  )
  if (todaysTrades.length >= settings.maxDailyTrades) {
    return { allowed: false, reason: 'Daily trade limit reached' }
  }

  // Check daily loss limit
  const todaysLoss = todaysTrades
    .filter(t => t.pnl < 0)
    .reduce((sum, t) => sum + Math.abs(t.pnl), 0)
  const maxLossAmount = settings.accountBalance * (settings.maxDailyLoss / 100)
  if (todaysLoss >= maxLossAmount) {
    return { allowed: false, reason: 'Daily loss limit reached' }
  }

  // Check trading hours
  const hour = new Date().getUTCHours()
  if (hour < settings.tradingHours.start || hour >= settings.tradingHours.end) {
    return { allowed: false, reason: 'Outside trading hours' }
  }

  return { allowed: true }
}

// Execute a new trade
export function executeTrade(suggestion, settings) {
  const canOpen = canOpenTrade(settings, suggestion.pair)
  if (!canOpen.allowed) {
    return { success: false, reason: canOpen.reason }
  }

  // Check minimum confidence
  if (suggestion.confidence < settings.minConfidence) {
    return { success: false, reason: 'Confidence below minimum' }
  }

  const pipValue = suggestion.pair.includes('JPY') ? 0.01 : 0.0001
  const entryPrice = parseFloat(suggestion.entryPrice)
  const stopLoss = parseFloat(suggestion.stopLoss)
  const takeProfit = parseFloat(suggestion.takeProfit)

  const stopLossPips = Math.abs(entryPrice - stopLoss) / pipValue
  const takeProfitPips = Math.abs(takeProfit - entryPrice) / pipValue

  const positionSize = calculatePositionSize(settings, stopLossPips, suggestion.pair)

  const trade = {
    id: Date.now(),
    pair: suggestion.pair,
    direction: suggestion.direction,
    signal: suggestion.signal,
    entryPrice: suggestion.entryPrice,
    currentPrice: suggestion.entryPrice,
    stopLoss: suggestion.stopLoss,
    takeProfit: suggestion.takeProfit,
    positionSize,
    stopLossPips: stopLossPips.toFixed(0),
    takeProfitPips: takeProfitPips.toFixed(0),
    confidence: suggestion.confidence,
    reasoning: suggestion.reasoning,
    status: 'OPEN',
    pnlPips: 0,
    pnl: 0,
    openedAt: new Date().toISOString(),
    predictionId: suggestion.predictionId,
    trailingStop: settings.useTrailingStop ? stopLoss : null,
    highestPrice: entryPrice,
    lowestPrice: entryPrice
  }

  const activeTrades = getActiveTrades()
  activeTrades.push(trade)
  saveActiveTrades(activeTrades)

  return { success: true, trade }
}

// Update trade with current price
export function updateTradePrice(tradeId, currentPrice) {
  const activeTrades = getActiveTrades()
  const index = activeTrades.findIndex(t => t.id === tradeId)

  if (index === -1) return null

  const trade = activeTrades[index]
  const current = parseFloat(currentPrice)
  const entry = parseFloat(trade.entryPrice)
  const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

  // Calculate P/L
  let pnlPips
  if (trade.direction === 'UP') {
    pnlPips = (current - entry) / pipValue
  } else {
    pnlPips = (entry - current) / pipValue
  }

  // Estimate P/L in dollars (simplified)
  const pipValuePerLot = trade.pair.includes('JPY') ? 1000 : 10
  const pnl = pnlPips * trade.positionSize * pipValuePerLot

  // Update highest/lowest for trailing stop
  const highest = Math.max(trade.highestPrice || entry, current)
  const lowest = Math.min(trade.lowestPrice || entry, current)

  // Update trailing stop if enabled
  let trailingStop = trade.trailingStop
  const settings = getAutoSettings()

  if (settings.useTrailingStop && pnlPips > settings.trailingStopPips) {
    if (trade.direction === 'UP') {
      const newStop = current - (settings.trailingStopPips * pipValue)
      trailingStop = Math.max(parseFloat(trade.stopLoss), newStop).toFixed(5)
    } else {
      const newStop = current + (settings.trailingStopPips * pipValue)
      trailingStop = Math.min(parseFloat(trade.stopLoss), newStop).toFixed(5)
    }
  }

  activeTrades[index] = {
    ...trade,
    currentPrice: currentPrice.toString(),
    pnlPips: pnlPips.toFixed(1),
    pnl: pnl.toFixed(2),
    highestPrice: highest,
    lowestPrice: lowest,
    trailingStop,
    lastUpdate: new Date().toISOString()
  }

  saveActiveTrades(activeTrades)
  return activeTrades[index]
}

// Check if trade should be closed (hit TP/SL)
export function checkTradeExit(tradeId, currentPrice) {
  const activeTrades = getActiveTrades()
  const trade = activeTrades.find(t => t.id === tradeId)

  if (!trade) return null

  const current = parseFloat(currentPrice)
  const stopLoss = parseFloat(trade.trailingStop || trade.stopLoss)
  const takeProfit = parseFloat(trade.takeProfit)

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
    return closeTrade(tradeId, currentPrice, closeReason)
  }

  return null
}

// Close a trade
export function closeTrade(tradeId, exitPrice, reason = 'MANUAL') {
  const activeTrades = getActiveTrades()
  const index = activeTrades.findIndex(t => t.id === tradeId)

  if (index === -1) return null

  const trade = activeTrades[index]
  const exit = parseFloat(exitPrice)
  const entry = parseFloat(trade.entryPrice)
  const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

  // Final P/L calculation
  let pnlPips
  if (trade.direction === 'UP') {
    pnlPips = (exit - entry) / pipValue
  } else {
    pnlPips = (entry - exit) / pipValue
  }

  const pipValuePerLot = trade.pair.includes('JPY') ? 1000 : 10
  const pnl = pnlPips * trade.positionSize * pipValuePerLot

  const closedTrade = {
    ...trade,
    exitPrice: exitPrice.toString(),
    pnlPips: pnlPips.toFixed(1),
    pnl: pnl.toFixed(2),
    status: 'CLOSED',
    closeReason: reason,
    closedAt: new Date().toISOString(),
    duration: Date.now() - new Date(trade.openedAt).getTime()
  }

  // Remove from active, add to history
  activeTrades.splice(index, 1)
  saveActiveTrades(activeTrades)

  const history = getTradeHistory()
  history.push(closedTrade)
  saveTradeHistory(history)

  // Update account balance
  const settings = getAutoSettings()
  settings.accountBalance += parseFloat(pnl)
  saveAutoSettings(settings)

  return closedTrade
}

// Close all trades
export function closeAllTrades(currentPrices) {
  const activeTrades = getActiveTrades()
  const closed = []

  activeTrades.forEach(trade => {
    const price = currentPrices[trade.pair]
    if (price) {
      const result = closeTrade(trade.id, price, 'CLOSE_ALL')
      if (result) closed.push(result)
    }
  })

  return closed
}

// Update all active trades with current prices
export function updateAllTrades(currentPrices) {
  const activeTrades = getActiveTrades()
  const results = {
    updated: [],
    closed: []
  }

  activeTrades.forEach(trade => {
    const price = currentPrices[trade.pair]
    if (price) {
      // First update the price
      updateTradePrice(trade.id, price)

      // Then check for exit
      const exitResult = checkTradeExit(trade.id, price)
      if (exitResult) {
        results.closed.push(exitResult)
      } else {
        results.updated.push(trade)
      }
    }
  })

  return results
}

// Get trading statistics
export function getTradingStats() {
  const history = getTradeHistory()
  const settings = getAutoSettings()

  if (history.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      totalPips: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      largestWin: 0,
      largestLoss: 0,
      avgTradeDuration: 0,
      accountBalance: settings.accountBalance,
      todaysPnl: 0,
      todaysTrades: 0
    }
  }

  const winners = history.filter(t => parseFloat(t.pnl) > 0)
  const losers = history.filter(t => parseFloat(t.pnl) < 0)

  const totalPnl = history.reduce((sum, t) => sum + parseFloat(t.pnl), 0)
  const totalPips = history.reduce((sum, t) => sum + parseFloat(t.pnlPips), 0)

  const grossProfit = winners.reduce((sum, t) => sum + parseFloat(t.pnl), 0)
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + parseFloat(t.pnl), 0))

  const avgWin = winners.length > 0 ? grossProfit / winners.length : 0
  const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0

  const largestWin = winners.length > 0
    ? Math.max(...winners.map(t => parseFloat(t.pnl)))
    : 0
  const largestLoss = losers.length > 0
    ? Math.min(...losers.map(t => parseFloat(t.pnl)))
    : 0

  const avgDuration = history.reduce((sum, t) => sum + (t.duration || 0), 0) / history.length

  // Today's stats
  const today = new Date().toDateString()
  const todaysTrades = history.filter(t =>
    new Date(t.closedAt).toDateString() === today
  )
  const todaysPnl = todaysTrades.reduce((sum, t) => sum + parseFloat(t.pnl), 0)

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
    largestWin: largestWin.toFixed(2),
    largestLoss: largestLoss.toFixed(2),
    avgTradeDuration: Math.round(avgDuration / 60000), // in minutes
    accountBalance: settings.accountBalance.toFixed(2),
    todaysPnl: todaysPnl.toFixed(2),
    todaysTrades: todaysTrades.length
  }
}

// Reset account (for demo/testing)
export function resetAccount(balance = 10000) {
  const settings = getAutoSettings()
  settings.accountBalance = balance
  saveAutoSettings(settings)
  localStorage.removeItem(ACTIVE_TRADES_KEY)
  localStorage.removeItem(TRADE_HISTORY_KEY)
  return settings
}
