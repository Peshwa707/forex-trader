/**
 * ML Prediction Service for Server
 * Uses technical analysis to generate trade predictions
 */

import { analyzePrice, calculateTradeLevels } from './technicalAnalysis.js'

/**
 * Generate prediction for a currency pair
 */
export function generatePrediction(pair, priceHistory) {
  const analysis = analyzePrice(priceHistory)

  if (!analysis) {
    return null
  }

  const { signals, trend, trendStrength, indicators, currentPrice } = analysis

  // Count buy/sell signals
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

  // Determine direction and confidence
  const direction = buyScore > sellScore ? 'UP' : 'DOWN'
  const dominantScore = Math.max(buyScore, sellScore)
  const baseConfidence = totalStrength > 0 ? (dominantScore / totalStrength) * 100 : 50

  // Adjust confidence based on signal agreement
  const signalAgreement = signals.filter(s =>
    (direction === 'UP' && s.signal === 'BUY') ||
    (direction === 'DOWN' && s.signal === 'SELL')
  ).length / Math.max(signals.length, 1)

  const confidence = Math.min(90, Math.max(30,
    baseConfidence * 0.6 + signalAgreement * 40
  ))

  // Generate trade levels
  const levels = calculateTradeLevels(analysis, direction)

  // Generate reasoning
  const activeSignals = signals
    .filter(s => s.signal === (direction === 'UP' ? 'BUY' : 'SELL'))
    .map(s => s.indicator)

  const reasoning = generateReasoning(direction, activeSignals, indicators, trend)

  return {
    pair,
    direction,
    signal: direction === 'UP' ? 'BUY' : 'SELL',
    confidence: Math.round(confidence),
    ...levels,
    potentialPips: levels.takeProfitPips,
    reasoning,
    indicators: {
      rsi: indicators.rsi?.toFixed(1),
      macd: indicators.macd?.histogram?.toFixed(5),
      trend,
      trendStrength: trendStrength.toFixed(1)
    },
    timestamp: Date.now()
  }
}

function generateReasoning(direction, activeSignals, indicators, trend) {
  const parts = []

  if (trend === direction || trend === (direction === 'UP' ? 'UP' : 'DOWN')) {
    parts.push(`Trend is ${trend.toLowerCase()}`)
  }

  if (indicators.rsi) {
    if (indicators.rsi < 30) parts.push('RSI oversold')
    else if (indicators.rsi > 70) parts.push('RSI overbought')
    else if (indicators.rsi < 45) parts.push('RSI approaching oversold')
    else if (indicators.rsi > 55) parts.push('RSI approaching overbought')
  }

  if (indicators.macd?.histogram) {
    if (indicators.macd.histogram > 0) parts.push('MACD bullish')
    else parts.push('MACD bearish')
  }

  if (activeSignals.length > 0) {
    parts.push(`${activeSignals.join(', ')} confirming`)
  }

  if (indicators.bollinger) {
    const price = indicators.sma20 // Approximate current
    if (price && indicators.bollinger.lower && price < indicators.bollinger.lower) {
      parts.push('Price below lower BB')
    } else if (price && indicators.bollinger.upper && price > indicators.bollinger.upper) {
      parts.push('Price above upper BB')
    }
  }

  if (parts.length === 0) {
    parts.push('Multiple indicators aligned')
  }

  return parts.slice(0, 3).join('. ') + '.'
}

/**
 * Generate predictions for all pairs
 */
export function generateAllPredictions(priceHistories) {
  const predictions = []

  for (const [pair, history] of Object.entries(priceHistories)) {
    const prediction = generatePrediction(pair, history)
    if (prediction && prediction.confidence >= 50) {
      predictions.push(prediction)
    }
  }

  // Sort by confidence
  return predictions.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Validate prediction outcome
 */
export function validatePrediction(prediction, currentPrice) {
  const entry = parseFloat(prediction.entryPrice || prediction.entry_price)
  const stopLoss = parseFloat(prediction.stopLoss || prediction.stop_loss)
  const takeProfit = parseFloat(prediction.takeProfit || prediction.take_profit)
  const direction = prediction.direction

  const pipValue = prediction.pair.includes('JPY') ? 0.01 : 0.0001
  let pnlPips, outcome, correct

  if (direction === 'UP') {
    if (currentPrice >= takeProfit) {
      outcome = 'PROFIT'
      correct = true
      pnlPips = (takeProfit - entry) / pipValue
    } else if (currentPrice <= stopLoss) {
      outcome = 'LOSS'
      correct = false
      pnlPips = (stopLoss - entry) / pipValue
    } else {
      // Still open
      pnlPips = (currentPrice - entry) / pipValue
      return { resolved: false, pnlPips: pnlPips.toFixed(1) }
    }
  } else {
    if (currentPrice <= takeProfit) {
      outcome = 'PROFIT'
      correct = true
      pnlPips = (entry - takeProfit) / pipValue
    } else if (currentPrice >= stopLoss) {
      outcome = 'LOSS'
      correct = false
      pnlPips = (entry - stopLoss) / pipValue
    } else {
      // Still open
      pnlPips = (entry - currentPrice) / pipValue
      return { resolved: false, pnlPips: pnlPips.toFixed(1) }
    }
  }

  return {
    resolved: true,
    outcome,
    correct,
    pnlPips: pnlPips.toFixed(1),
    priceAtResolution: currentPrice
  }
}
