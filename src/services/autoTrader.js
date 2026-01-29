/**
 * Auto Trader Service
 * Generates trade suggestions with entry, SL, TP based on ML predictions
 */

import { analyzePair, generateHistoricalData } from './mlPrediction'
import { calculateATR, calculateBollingerBands } from './technicalAnalysis'
import { logPrediction, saveSuggestedTrade, autoResolvePredictions, getAccuracyStats } from './predictionLogger'

// Base prices for pairs
const BASE_PRICES = {
  'EUR/USD': 1.0850,
  'GBP/USD': 1.2700,
  'USD/JPY': 149.50,
  'USD/CHF': 0.8700,
  'AUD/USD': 0.6650,
  'USD/CAD': 1.3600,
  'NZD/USD': 0.6100,
  'EUR/GBP': 0.8550,
  'EUR/JPY': 162.50,
  'GBP/JPY': 190.00,
  'XAU/USD': 2650.00,
  'XAG/USD': 31.50,
}

// Pip values for different pairs
function getPipValue(pair) {
  if (pair.includes('JPY')) return 0.01
  if (pair.includes('XAU')) return 0.1
  if (pair.includes('XAG')) return 0.01
  return 0.0001
}

// Calculate stop loss and take profit levels
function calculateLevels(pair, currentPrice, direction, atr, bb) {
  const pipValue = getPipValue(pair)
  const price = parseFloat(currentPrice)

  // Use ATR for dynamic SL/TP calculation
  const atrValue = atr || price * 0.005 // Default to 0.5% if no ATR

  // Risk:Reward ratio of 1:2
  const stopLossPips = Math.max(20, Math.round(atrValue / pipValue * 1.5))
  const takeProfitPips = stopLossPips * 2

  let stopLoss, takeProfit

  if (direction === 'UP') {
    stopLoss = price - (stopLossPips * pipValue)
    takeProfit = price + (takeProfitPips * pipValue)
  } else if (direction === 'DOWN') {
    stopLoss = price + (stopLossPips * pipValue)
    takeProfit = price - (takeProfitPips * pipValue)
  } else {
    // Neutral - no trade
    return null
  }

  // Adjust based on Bollinger Bands if available
  if (bb) {
    const upper = bb.upper[bb.upper.length - 1]
    const lower = bb.lower[bb.lower.length - 1]

    if (direction === 'UP') {
      takeProfit = Math.min(takeProfit, upper * 0.998) // Just below upper band
      stopLoss = Math.max(stopLoss, lower * 1.002) // Just above lower band
    } else if (direction === 'DOWN') {
      takeProfit = Math.max(takeProfit, lower * 1.002)
      stopLoss = Math.min(stopLoss, upper * 0.998)
    }
  }

  return {
    stopLoss: stopLoss.toFixed(pair.includes('JPY') ? 3 : 5),
    takeProfit: takeProfit.toFixed(pair.includes('JPY') ? 3 : 5),
    stopLossPips,
    takeProfitPips,
    riskRewardRatio: '1:2'
  }
}

// Generate a trade suggestion for a pair
export async function generateTradeSuggestion(pair, priceHistory = null) {
  const basePrice = BASE_PRICES[pair] || 1.0
  const history = priceHistory || generateHistoricalData(basePrice, 90)
  const currentPrice = history[history.length - 1]

  // Get ML prediction
  const analysis = await analyzePair(history, pair)
  const prediction = analysis.prediction

  // Skip if neutral or low confidence
  if (prediction.direction === 'NEUTRAL' || prediction.confidence < 55) {
    return null
  }

  // Calculate ATR and Bollinger Bands for levels
  const highs = history.map(p => p * 1.001)
  const lows = history.map(p => p * 0.999)
  const atr = calculateATR(highs, lows, history, 14)
  const bb = calculateBollingerBands(history, 20)

  const currentATR = atr[atr.length - 1]
  const levels = calculateLevels(pair, currentPrice, prediction.direction, currentATR, bb)

  if (!levels) return null

  // Build reasoning
  const reasoning = []
  if (analysis.indicators.rsi < 30) reasoning.push('RSI oversold')
  else if (analysis.indicators.rsi > 70) reasoning.push('RSI overbought')

  if (analysis.indicators.macdSignal === 'Bullish') reasoning.push('MACD bullish')
  else reasoning.push('MACD bearish')

  if (analysis.indicators.trend === 'Bullish') reasoning.push('Uptrend')
  else reasoning.push('Downtrend')

  reasoning.push(`${prediction.confidence}% ML confidence`)

  // Log the prediction
  const predictionLog = logPrediction({
    pair,
    direction: prediction.direction,
    signal: prediction.signal,
    confidence: prediction.confidence,
    currentPrice: currentPrice.toFixed(pair.includes('JPY') ? 3 : 5),
    targetPrice: levels.takeProfit,
    stopLoss: levels.stopLoss,
    takeProfit: levels.takeProfit,
    source: prediction.source,
    indicators: analysis.indicators
  })

  // Create trade suggestion
  const trade = saveSuggestedTrade({
    pair,
    direction: prediction.direction,
    signal: prediction.signal,
    confidence: prediction.confidence,
    entryPrice: currentPrice.toFixed(pair.includes('JPY') ? 3 : 5),
    stopLoss: levels.stopLoss,
    takeProfit: levels.takeProfit,
    riskRewardRatio: levels.riskRewardRatio,
    potentialPips: levels.takeProfitPips,
    reasoning: reasoning.join(', '),
    indicators: analysis.indicators,
    predictionId: predictionLog.id
  })

  return {
    ...trade,
    analysis
  }
}

// Generate suggestions for all major pairs
export async function generateAllSuggestions() {
  const pairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'EUR/GBP']
  const suggestions = []

  for (const pair of pairs) {
    try {
      const suggestion = await generateTradeSuggestion(pair)
      if (suggestion) {
        suggestions.push(suggestion)
      }
    } catch (error) {
      console.error(`Error generating suggestion for ${pair}:`, error)
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence)

  return suggestions
}

// Auto-update predictions with current prices
export function updatePredictionsWithPrices(currentPrices) {
  return autoResolvePredictions(currentPrices, 4) // Resolve after 4 hours
}

// Get trading performance summary
export function getTradingPerformance() {
  const stats = getAccuracyStats()

  // Calculate profit factor
  const logs = JSON.parse(localStorage.getItem('forex_prediction_logs') || '[]')
  const resolved = logs.filter(l => l.outcome !== null)

  let grossProfit = 0
  let grossLoss = 0

  resolved.forEach(l => {
    const pips = parseFloat(l.pnlPips || 0)
    if (pips > 0) grossProfit += pips
    else grossLoss += Math.abs(pips)
  })

  // Handle division by zero and edge cases for profit factor
  let profitFactor = 'N/A'
  if (grossLoss > 0 && grossProfit >= 0) {
    profitFactor = (grossProfit / grossLoss).toFixed(2)
  } else if (grossProfit > 0 && grossLoss === 0) {
    profitFactor = '∞'
  } else if (grossProfit === 0 && grossLoss === 0) {
    profitFactor = 'N/A' // No trades to calculate
  } else {
    profitFactor = '0.00'
  }

  // Calculate streak
  let currentStreak = 0
  let maxWinStreak = 0
  let maxLoseStreak = 0
  let tempWinStreak = 0
  let tempLoseStreak = 0

  resolved.forEach(l => {
    if (l.correct) {
      tempWinStreak++
      tempLoseStreak = 0
      maxWinStreak = Math.max(maxWinStreak, tempWinStreak)
    } else {
      tempLoseStreak++
      tempWinStreak = 0
      maxLoseStreak = Math.max(maxLoseStreak, tempLoseStreak)
    }
  })

  // Current streak
  if (resolved.length > 0) {
    const lastCorrect = resolved[resolved.length - 1].correct
    for (let i = resolved.length - 1; i >= 0; i--) {
      if (resolved[i].correct === lastCorrect) {
        currentStreak++
      } else {
        break
      }
    }
    if (!lastCorrect) currentStreak = -currentStreak
  }

  return {
    ...stats,
    grossProfit: grossProfit.toFixed(1),
    grossLoss: grossLoss.toFixed(1),
    profitFactor,
    currentStreak,
    maxWinStreak,
    maxLoseStreak,
    avgWinPips: resolved.filter(l => parseFloat(l.pnlPips) > 0).length > 0
      ? (grossProfit / resolved.filter(l => parseFloat(l.pnlPips) > 0).length).toFixed(1)
      : '0',
    avgLossPips: resolved.filter(l => parseFloat(l.pnlPips) < 0).length > 0
      ? (grossLoss / resolved.filter(l => parseFloat(l.pnlPips) < 0).length).toFixed(1)
      : '0'
  }
}

// Confidence-weighted position sizing suggestion
export function suggestPositionSize(accountBalance, riskPercent, trade) {
  const riskAmount = accountBalance * (riskPercent / 100)
  const pipValue = getPipValue(trade.pair)
  const stopLossPips = Math.abs(parseFloat(trade.entryPrice) - parseFloat(trade.stopLoss)) / pipValue

  // Lot size calculation (assuming standard lot = 100,000 units)
  const pipValuePerLot = trade.pair.includes('JPY') ? 1000 : 10
  const lotSize = (riskAmount / (stopLossPips * pipValuePerLot)).toFixed(2)

  return {
    lotSize: Math.min(parseFloat(lotSize), 1), // Cap at 1 lot for safety
    riskAmount: riskAmount.toFixed(2),
    stopLossPips: stopLossPips.toFixed(0),
    potentialProfit: (riskAmount * 2).toFixed(2) // Based on 1:2 RR
  }
}
