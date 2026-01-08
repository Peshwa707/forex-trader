/**
 * Prediction Logger Service
 * Tracks ML predictions, outcomes, and accuracy over time
 */

const STORAGE_KEY = 'forex_prediction_logs'
const ACCURACY_KEY = 'forex_prediction_accuracy'
const SUGGESTED_TRADES_KEY = 'forex_suggested_trades'

// Get all prediction logs
export function getPredictionLogs() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
}

// Save prediction logs
function savePredictionLogs(logs) {
  // Keep last 1000 predictions
  const trimmedLogs = logs.slice(-1000)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedLogs))
}

// Log a new prediction
export function logPrediction(prediction) {
  const logs = getPredictionLogs()

  const logEntry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    pair: prediction.pair,
    direction: prediction.direction,
    signal: prediction.signal,
    confidence: prediction.confidence,
    priceAtPrediction: prediction.currentPrice,
    targetPrice: prediction.targetPrice,
    stopLoss: prediction.stopLoss,
    takeProfit: prediction.takeProfit,
    source: prediction.source || 'ML Model',
    indicators: prediction.indicators || {},
    outcome: null, // Will be updated later
    actualMove: null,
    pnlPips: null,
    correct: null,
    resolvedAt: null
  }

  logs.push(logEntry)
  savePredictionLogs(logs)

  return logEntry
}

// Update prediction outcome
export function updatePredictionOutcome(predictionId, currentPrice) {
  const logs = getPredictionLogs()
  const index = logs.findIndex(l => l.id === predictionId)

  if (index === -1) return null

  const prediction = logs[index]
  const priceAtPrediction = parseFloat(prediction.priceAtPrediction)
  const current = parseFloat(currentPrice)

  // Calculate actual move
  const priceDiff = current - priceAtPrediction
  const percentMove = (priceDiff / priceAtPrediction) * 100

  // Determine if prediction was correct
  let correct = false
  let outcome = 'NEUTRAL'

  if (prediction.direction === 'UP' && priceDiff > 0) {
    correct = true
    outcome = 'PROFIT'
  } else if (prediction.direction === 'DOWN' && priceDiff < 0) {
    correct = true
    outcome = 'PROFIT'
  } else if (prediction.direction === 'NEUTRAL' && Math.abs(percentMove) < 0.1) {
    correct = true
    outcome = 'NEUTRAL'
  } else if (priceDiff !== 0) {
    outcome = 'LOSS'
  }

  // Calculate pips
  const pipMultiplier = prediction.pair.includes('JPY') ? 100 : 10000
  const pnlPips = prediction.direction === 'UP'
    ? priceDiff * pipMultiplier
    : -priceDiff * pipMultiplier

  logs[index] = {
    ...prediction,
    outcome,
    actualMove: percentMove.toFixed(4),
    pnlPips: pnlPips.toFixed(1),
    correct,
    priceAtResolution: currentPrice,
    resolvedAt: new Date().toISOString()
  }

  savePredictionLogs(logs)
  updateAccuracyStats()

  return logs[index]
}

// Get accuracy statistics
export function getAccuracyStats() {
  const stored = localStorage.getItem(ACCURACY_KEY)
  if (stored) return JSON.parse(stored)

  return calculateAccuracyStats()
}

// Calculate and update accuracy stats
export function updateAccuracyStats() {
  const stats = calculateAccuracyStats()
  localStorage.setItem(ACCURACY_KEY, JSON.stringify(stats))
  return stats
}

function calculateAccuracyStats() {
  const logs = getPredictionLogs()
  const resolved = logs.filter(l => l.outcome !== null)

  if (resolved.length === 0) {
    return {
      totalPredictions: logs.length,
      resolvedPredictions: 0,
      correctPredictions: 0,
      accuracy: 0,
      profitableTrades: 0,
      totalPips: 0,
      avgPipsPerTrade: 0,
      winRate: 0,
      byPair: {},
      byDirection: { UP: { total: 0, correct: 0 }, DOWN: { total: 0, correct: 0 }, NEUTRAL: { total: 0, correct: 0 } },
      recentAccuracy: 0,
      lastUpdated: new Date().toISOString()
    }
  }

  const correct = resolved.filter(l => l.correct)
  const profitable = resolved.filter(l => parseFloat(l.pnlPips) > 0)
  const totalPips = resolved.reduce((sum, l) => sum + parseFloat(l.pnlPips || 0), 0)

  // Calculate by pair
  const byPair = {}
  resolved.forEach(l => {
    if (!byPair[l.pair]) {
      byPair[l.pair] = { total: 0, correct: 0, pips: 0 }
    }
    byPair[l.pair].total++
    if (l.correct) byPair[l.pair].correct++
    byPair[l.pair].pips += parseFloat(l.pnlPips || 0)
  })

  // Calculate by direction
  const byDirection = { UP: { total: 0, correct: 0 }, DOWN: { total: 0, correct: 0 }, NEUTRAL: { total: 0, correct: 0 } }
  resolved.forEach(l => {
    if (byDirection[l.direction]) {
      byDirection[l.direction].total++
      if (l.correct) byDirection[l.direction].correct++
    }
  })

  // Recent accuracy (last 50 predictions)
  const recent = resolved.slice(-50)
  const recentCorrect = recent.filter(l => l.correct).length

  return {
    totalPredictions: logs.length,
    resolvedPredictions: resolved.length,
    correctPredictions: correct.length,
    accuracy: ((correct.length / resolved.length) * 100).toFixed(1),
    profitableTrades: profitable.length,
    totalPips: totalPips.toFixed(1),
    avgPipsPerTrade: (totalPips / resolved.length).toFixed(1),
    winRate: ((profitable.length / resolved.length) * 100).toFixed(1),
    byPair,
    byDirection,
    recentAccuracy: recent.length > 0 ? ((recentCorrect / recent.length) * 100).toFixed(1) : 0,
    lastUpdated: new Date().toISOString()
  }
}

// Get pending predictions (not yet resolved)
export function getPendingPredictions() {
  const logs = getPredictionLogs()
  return logs.filter(l => l.outcome === null)
}

// Auto-resolve old predictions (after specified hours)
export function autoResolvePredictions(currentPrices, maxAgeHours = 4) {
  const logs = getPredictionLogs()
  const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000)
  let updated = false

  logs.forEach((log, index) => {
    if (log.outcome === null && new Date(log.timestamp).getTime() < cutoffTime) {
      const currentPrice = currentPrices[log.pair]
      if (currentPrice) {
        const priceAtPrediction = parseFloat(log.priceAtPrediction)
        const current = parseFloat(currentPrice)
        const priceDiff = current - priceAtPrediction
        const percentMove = (priceDiff / priceAtPrediction) * 100

        let correct = false
        let outcome = 'NEUTRAL'

        if (log.direction === 'UP' && priceDiff > 0) {
          correct = true
          outcome = 'PROFIT'
        } else if (log.direction === 'DOWN' && priceDiff < 0) {
          correct = true
          outcome = 'PROFIT'
        } else if (log.direction === 'NEUTRAL' && Math.abs(percentMove) < 0.1) {
          correct = true
        } else if (priceDiff !== 0) {
          outcome = 'LOSS'
        }

        const pipMultiplier = log.pair.includes('JPY') ? 100 : 10000
        const pnlPips = log.direction === 'UP'
          ? priceDiff * pipMultiplier
          : log.direction === 'DOWN'
            ? -priceDiff * pipMultiplier
            : 0

        logs[index] = {
          ...log,
          outcome,
          actualMove: percentMove.toFixed(4),
          pnlPips: pnlPips.toFixed(1),
          correct,
          priceAtResolution: currentPrice,
          resolvedAt: new Date().toISOString(),
          autoResolved: true
        }
        updated = true
      }
    }
  })

  if (updated) {
    savePredictionLogs(logs)
    updateAccuracyStats()
  }

  return updated
}

// Suggested Trades Management
export function getSuggestedTrades() {
  return JSON.parse(localStorage.getItem(SUGGESTED_TRADES_KEY) || '[]')
}

export function saveSuggestedTrade(trade) {
  const trades = getSuggestedTrades()

  const newTrade = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    pair: trade.pair,
    direction: trade.direction,
    signal: trade.signal,
    confidence: trade.confidence,
    entryPrice: trade.entryPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    riskRewardRatio: trade.riskRewardRatio,
    potentialPips: trade.potentialPips,
    reasoning: trade.reasoning,
    indicators: trade.indicators,
    status: 'PENDING', // PENDING, ACTIVE, HIT_TP, HIT_SL, EXPIRED, CANCELLED
    predictionId: trade.predictionId
  }

  trades.unshift(newTrade)

  // Keep last 100 suggested trades
  const trimmed = trades.slice(0, 100)
  localStorage.setItem(SUGGESTED_TRADES_KEY, JSON.stringify(trimmed))

  return newTrade
}

export function updateSuggestedTradeStatus(tradeId, status, exitPrice = null) {
  const trades = getSuggestedTrades()
  const index = trades.findIndex(t => t.id === tradeId)

  if (index === -1) return null

  trades[index] = {
    ...trades[index],
    status,
    exitPrice,
    closedAt: new Date().toISOString()
  }

  localStorage.setItem(SUGGESTED_TRADES_KEY, JSON.stringify(trades))
  return trades[index]
}

// Clear all logs (for testing)
export function clearAllLogs() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(ACCURACY_KEY)
  localStorage.removeItem(SUGGESTED_TRADES_KEY)
}

// Export logs for analysis
export function exportLogs() {
  return {
    predictions: getPredictionLogs(),
    accuracy: getAccuracyStats(),
    suggestedTrades: getSuggestedTrades(),
    exportedAt: new Date().toISOString()
  }
}
