/**
 * Technical Analysis Indicators for Server
 */

// Simple Moving Average
export function calculateSMA(prices, period) {
  if (prices.length < period) return null
  const sum = prices.slice(0, period).reduce((a, b) => a + b, 0)
  return sum / period
}

// Exponential Moving Average
export function calculateEMA(prices, period) {
  if (prices.length < period) return null
  const multiplier = 2 / (period + 1)
  let ema = calculateSMA(prices.slice(-period), period)

  for (let i = prices.length - period - 1; i >= 0; i--) {
    ema = (prices[i] - ema) * multiplier + ema
  }
  return ema
}

// Relative Strength Index
export function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null

  let gains = 0
  let losses = 0

  for (let i = 0; i < period; i++) {
    const change = prices[i] - prices[i + 1]
    if (change > 0) gains += change
    else losses -= change
  }

  const avgGain = gains / period
  const avgLoss = losses / period

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

// MACD
export function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod + signalPeriod) return null

  const fastEMA = calculateEMA(prices, fastPeriod)
  const slowEMA = calculateEMA(prices, slowPeriod)
  const macdLine = fastEMA - slowEMA

  // Simplified signal calculation
  const signal = macdLine * 0.9 // Approximate

  return {
    macd: macdLine,
    signal: signal,
    histogram: macdLine - signal
  }
}

// Bollinger Bands
export function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null

  const sma = calculateSMA(prices, period)
  const squaredDiffs = prices.slice(0, period).map(p => Math.pow(p - sma, 2))
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period
  const std = Math.sqrt(variance)

  return {
    upper: sma + (std * stdDev),
    middle: sma,
    lower: sma - (std * stdDev),
    bandwidth: ((sma + std * stdDev) - (sma - std * stdDev)) / sma
  }
}

// Stochastic Oscillator
export function calculateStochastic(prices, highs, lows, period = 14) {
  if (prices.length < period) return null

  const currentClose = prices[0]
  const highestHigh = Math.max(...highs.slice(0, period))
  const lowestLow = Math.min(...lows.slice(0, period))

  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100

  return {
    k: k,
    d: k * 0.9 // Simplified
  }
}

// Average True Range
export function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null

  let trSum = 0
  for (let i = 0; i < period; i++) {
    const high = highs[i]
    const low = lows[i]
    const prevClose = closes[i + 1]
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    trSum += tr
  }

  return trSum / period
}

// Support and Resistance levels
export function findSupportResistance(prices, lookback = 50) {
  if (prices.length < lookback) return { support: [], resistance: [] }

  const priceRange = prices.slice(0, lookback)
  const max = Math.max(...priceRange)
  const min = Math.min(...priceRange)
  const range = max - min

  // Find local highs and lows
  const levels = { support: [], resistance: [] }

  for (let i = 2; i < lookback - 2; i++) {
    // Local high (resistance)
    if (priceRange[i] > priceRange[i - 1] && priceRange[i] > priceRange[i - 2] &&
        priceRange[i] > priceRange[i + 1] && priceRange[i] > priceRange[i + 2]) {
      levels.resistance.push(priceRange[i])
    }
    // Local low (support)
    if (priceRange[i] < priceRange[i - 1] && priceRange[i] < priceRange[i - 2] &&
        priceRange[i] < priceRange[i + 1] && priceRange[i] < priceRange[i + 2]) {
      levels.support.push(priceRange[i])
    }
  }

  return levels
}

// Generate full technical analysis
export function analyzePrice(priceHistory) {
  if (!priceHistory || priceHistory.length < 30) {
    return null
  }

  const prices = priceHistory.map(p => p.price || p)
  const highs = prices.map(p => p * 1.001) // Approximate highs
  const lows = prices.map(p => p * 0.999) // Approximate lows

  const currentPrice = prices[0]
  const rsi = calculateRSI(prices)
  const macd = calculateMACD(prices)
  const bollinger = calculateBollingerBands(prices)
  const stochastic = calculateStochastic(prices, highs, lows)
  const atr = calculateATR(highs, lows, prices)
  const sma20 = calculateSMA(prices, 20)
  const sma50 = calculateSMA(prices, 50)
  const ema12 = calculateEMA(prices, 12)
  const ema26 = calculateEMA(prices, 26)

  // Calculate trend
  let trend = 'NEUTRAL'
  let trendStrength = 0

  if (sma20 && sma50) {
    if (currentPrice > sma20 && sma20 > sma50) {
      trend = 'UP'
      trendStrength = ((currentPrice - sma50) / sma50) * 100
    } else if (currentPrice < sma20 && sma20 < sma50) {
      trend = 'DOWN'
      trendStrength = ((sma50 - currentPrice) / sma50) * 100
    }
  }

  // Generate signals
  const signals = []

  // RSI signals
  if (rsi !== null) {
    if (rsi < 30) signals.push({ indicator: 'RSI', signal: 'BUY', strength: 30 - rsi })
    else if (rsi > 70) signals.push({ indicator: 'RSI', signal: 'SELL', strength: rsi - 70 })
  }

  // MACD signals
  if (macd) {
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      signals.push({ indicator: 'MACD', signal: 'BUY', strength: Math.abs(macd.histogram) * 1000 })
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      signals.push({ indicator: 'MACD', signal: 'SELL', strength: Math.abs(macd.histogram) * 1000 })
    }
  }

  // Bollinger Band signals
  if (bollinger) {
    if (currentPrice < bollinger.lower) {
      signals.push({ indicator: 'BB', signal: 'BUY', strength: ((bollinger.lower - currentPrice) / currentPrice) * 10000 })
    } else if (currentPrice > bollinger.upper) {
      signals.push({ indicator: 'BB', signal: 'SELL', strength: ((currentPrice - bollinger.upper) / currentPrice) * 10000 })
    }
  }

  // Stochastic signals
  if (stochastic) {
    if (stochastic.k < 20) signals.push({ indicator: 'STOCH', signal: 'BUY', strength: 20 - stochastic.k })
    else if (stochastic.k > 80) signals.push({ indicator: 'STOCH', signal: 'SELL', strength: stochastic.k - 80 })
  }

  // EMA crossover
  if (ema12 && ema26) {
    if (ema12 > ema26) signals.push({ indicator: 'EMA', signal: 'BUY', strength: ((ema12 - ema26) / ema26) * 10000 })
    else signals.push({ indicator: 'EMA', signal: 'SELL', strength: ((ema26 - ema12) / ema26) * 10000 })
  }

  return {
    currentPrice,
    trend,
    trendStrength: Math.min(trendStrength, 100),
    indicators: {
      rsi,
      macd,
      bollinger,
      stochastic,
      atr,
      sma20,
      sma50,
      ema12,
      ema26
    },
    signals
  }
}

// Calculate trade levels (entry, SL, TP)
export function calculateTradeLevels(analysis, direction) {
  const { currentPrice, indicators } = analysis
  const atr = indicators.atr || (currentPrice * 0.001) // Default 0.1% if no ATR

  let stopLoss, takeProfit
  const isJPY = currentPrice > 10 // JPY pairs have different pip values

  if (direction === 'UP') {
    stopLoss = currentPrice - (atr * 1.5)
    takeProfit = currentPrice + (atr * 2.5)
  } else {
    stopLoss = currentPrice + (atr * 1.5)
    takeProfit = currentPrice - (atr * 2.5)
  }

  const pipValue = isJPY ? 0.01 : 0.0001
  const stopLossPips = Math.abs(currentPrice - stopLoss) / pipValue
  const takeProfitPips = Math.abs(takeProfit - currentPrice) / pipValue
  const riskReward = (takeProfitPips / stopLossPips).toFixed(2)

  return {
    entryPrice: currentPrice.toFixed(isJPY ? 3 : 5),
    stopLoss: stopLoss.toFixed(isJPY ? 3 : 5),
    takeProfit: takeProfit.toFixed(isJPY ? 3 : 5),
    stopLossPips: Math.round(stopLossPips),
    takeProfitPips: Math.round(takeProfitPips),
    riskRewardRatio: riskReward
  }
}
