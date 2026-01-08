/**
 * Technical Analysis Indicators for Forex Trading
 * Includes: SMA, EMA, RSI, MACD, Bollinger Bands, Stochastic, ATR
 */

// Simple Moving Average
export function calculateSMA(data, period) {
  const result = []
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    result.push(sum / period)
  }
  return result
}

// Exponential Moving Average
export function calculateEMA(data, period) {
  const result = []
  const multiplier = 2 / (period + 1)

  // First EMA is SMA
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period
  result.push(ema)

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema
    result.push(ema)
  }
  return result
}

// Relative Strength Index (RSI)
export function calculateRSI(data, period = 14) {
  const changes = []
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1])
  }

  const gains = changes.map(c => c > 0 ? c : 0)
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0)

  const result = []
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    const rsi = 100 - (100 / (1 + rs))
    result.push(rsi)
  }

  return result
}

// MACD (Moving Average Convergence Divergence)
export function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = calculateEMA(data, fastPeriod)
  const slowEMA = calculateEMA(data, slowPeriod)

  // Align arrays
  const offset = slowPeriod - fastPeriod
  const macdLine = []

  for (let i = 0; i < slowEMA.length; i++) {
    macdLine.push(fastEMA[i + offset] - slowEMA[i])
  }

  const signalLine = calculateEMA(macdLine, signalPeriod)
  const histogram = []

  const signalOffset = signalPeriod - 1
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + signalOffset] - signalLine[i])
  }

  return {
    macd: macdLine.slice(-histogram.length),
    signal: signalLine,
    histogram
  }
}

// Bollinger Bands
export function calculateBollingerBands(data, period = 20, stdDev = 2) {
  const sma = calculateSMA(data, period)
  const upper = []
  const lower = []

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const mean = sma[i - period + 1]
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period
    const std = Math.sqrt(variance)

    upper.push(mean + stdDev * std)
    lower.push(mean - stdDev * std)
  }

  return { upper, middle: sma, lower }
}

// Stochastic Oscillator
export function calculateStochastic(highs, lows, closes, period = 14, smoothK = 3, smoothD = 3) {
  const rawK = []

  for (let i = period - 1; i < closes.length; i++) {
    const highSlice = highs.slice(i - period + 1, i + 1)
    const lowSlice = lows.slice(i - period + 1, i + 1)

    const highestHigh = Math.max(...highSlice)
    const lowestLow = Math.min(...lowSlice)

    const k = ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100
    rawK.push(isNaN(k) ? 50 : k)
  }

  const k = calculateSMA(rawK, smoothK)
  const d = calculateSMA(k, smoothD)

  return { k, d }
}

// Average True Range (ATR)
export function calculateATR(highs, lows, closes, period = 14) {
  const trueRanges = []

  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    )
    trueRanges.push(tr)
  }

  return calculateEMA(trueRanges, period)
}

// Support and Resistance Levels
export function calculateSupportResistance(highs, lows, lookback = 20) {
  const recentHighs = highs.slice(-lookback)
  const recentLows = lows.slice(-lookback)

  const resistance = Math.max(...recentHighs)
  const support = Math.min(...recentLows)

  // Find pivot points
  const pivotHigh = recentHighs.reduce((a, b) => a + b, 0) / recentHighs.length
  const pivotLow = recentLows.reduce((a, b) => a + b, 0) / recentLows.length

  return {
    resistance,
    support,
    pivotHigh,
    pivotLow,
    pivot: (resistance + support) / 2
  }
}

// Generate trading signal based on multiple indicators
export function generateSignal(indicators) {
  let bullishSignals = 0
  let bearishSignals = 0
  const signals = []

  // RSI Signal
  if (indicators.rsi !== undefined) {
    if (indicators.rsi < 30) {
      bullishSignals += 2 // Oversold - strong buy
      signals.push({ indicator: 'RSI', signal: 'BUY', strength: 'Strong', reason: 'Oversold' })
    } else if (indicators.rsi < 40) {
      bullishSignals += 1
      signals.push({ indicator: 'RSI', signal: 'BUY', strength: 'Weak', reason: 'Near oversold' })
    } else if (indicators.rsi > 70) {
      bearishSignals += 2 // Overbought - strong sell
      signals.push({ indicator: 'RSI', signal: 'SELL', strength: 'Strong', reason: 'Overbought' })
    } else if (indicators.rsi > 60) {
      bearishSignals += 1
      signals.push({ indicator: 'RSI', signal: 'SELL', strength: 'Weak', reason: 'Near overbought' })
    }
  }

  // MACD Signal
  if (indicators.macdHistogram !== undefined) {
    if (indicators.macdHistogram > 0 && indicators.macdCrossover === 'bullish') {
      bullishSignals += 2
      signals.push({ indicator: 'MACD', signal: 'BUY', strength: 'Strong', reason: 'Bullish crossover' })
    } else if (indicators.macdHistogram > 0) {
      bullishSignals += 1
      signals.push({ indicator: 'MACD', signal: 'BUY', strength: 'Weak', reason: 'Positive histogram' })
    } else if (indicators.macdHistogram < 0 && indicators.macdCrossover === 'bearish') {
      bearishSignals += 2
      signals.push({ indicator: 'MACD', signal: 'SELL', strength: 'Strong', reason: 'Bearish crossover' })
    } else if (indicators.macdHistogram < 0) {
      bearishSignals += 1
      signals.push({ indicator: 'MACD', signal: 'SELL', strength: 'Weak', reason: 'Negative histogram' })
    }
  }

  // Moving Average Signal
  if (indicators.price !== undefined && indicators.sma20 !== undefined) {
    if (indicators.price > indicators.sma20 && indicators.price > indicators.sma50) {
      bullishSignals += 1
      signals.push({ indicator: 'MA', signal: 'BUY', strength: 'Medium', reason: 'Price above MAs' })
    } else if (indicators.price < indicators.sma20 && indicators.price < indicators.sma50) {
      bearishSignals += 1
      signals.push({ indicator: 'MA', signal: 'SELL', strength: 'Medium', reason: 'Price below MAs' })
    }
  }

  // Bollinger Bands Signal
  if (indicators.bbPosition !== undefined) {
    if (indicators.bbPosition < 0.2) {
      bullishSignals += 1
      signals.push({ indicator: 'BB', signal: 'BUY', strength: 'Medium', reason: 'Near lower band' })
    } else if (indicators.bbPosition > 0.8) {
      bearishSignals += 1
      signals.push({ indicator: 'BB', signal: 'SELL', strength: 'Medium', reason: 'Near upper band' })
    }
  }

  // Stochastic Signal
  if (indicators.stochK !== undefined && indicators.stochD !== undefined) {
    if (indicators.stochK < 20 && indicators.stochK > indicators.stochD) {
      bullishSignals += 1
      signals.push({ indicator: 'Stoch', signal: 'BUY', strength: 'Medium', reason: 'Oversold crossover' })
    } else if (indicators.stochK > 80 && indicators.stochK < indicators.stochD) {
      bearishSignals += 1
      signals.push({ indicator: 'Stoch', signal: 'SELL', strength: 'Medium', reason: 'Overbought crossover' })
    }
  }

  // Calculate overall signal
  const totalSignals = bullishSignals + bearishSignals
  let overallSignal = 'NEUTRAL'
  let confidence = 50

  if (totalSignals > 0) {
    if (bullishSignals > bearishSignals) {
      overallSignal = 'BUY'
      confidence = Math.min(95, 50 + (bullishSignals - bearishSignals) * 10)
    } else if (bearishSignals > bullishSignals) {
      overallSignal = 'SELL'
      confidence = Math.min(95, 50 + (bearishSignals - bullishSignals) * 10)
    }
  }

  return {
    signal: overallSignal,
    confidence,
    bullishSignals,
    bearishSignals,
    details: signals
  }
}
