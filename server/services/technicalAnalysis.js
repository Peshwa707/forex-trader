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

  // Calculate MACD line for each point to build history for signal EMA
  const macdHistory = []
  for (let i = 0; i <= signalPeriod; i++) {
    const priceSlice = prices.slice(i)
    if (priceSlice.length >= slowPeriod) {
      const fastEMA = calculateEMA(priceSlice, fastPeriod)
      const slowEMA = calculateEMA(priceSlice, slowPeriod)
      if (fastEMA !== null && slowEMA !== null) {
        macdHistory.push(fastEMA - slowEMA)
      }
    }
  }

  if (macdHistory.length < signalPeriod) {
    // Fallback if not enough history
    const fastEMA = calculateEMA(prices, fastPeriod)
    const slowEMA = calculateEMA(prices, slowPeriod)
    const macdLine = fastEMA - slowEMA
    return {
      macd: macdLine,
      signal: macdLine * 0.9, // Approximate when insufficient data
      histogram: macdLine * 0.1
    }
  }

  const macdLine = macdHistory[0]
  // Calculate signal as EMA of MACD history
  const multiplier = 2 / (signalPeriod + 1)
  let signal = macdHistory.slice(-signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod
  for (let i = macdHistory.length - signalPeriod - 1; i >= 0; i--) {
    signal = (macdHistory[i] - signal) * multiplier + signal
  }

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
export function calculateStochastic(prices, highs, lows, period = 14, smoothK = 3) {
  if (prices.length < period + smoothK) return null

  // Calculate %K for multiple periods to get %D (3-period SMA of %K)
  const kValues = []
  for (let i = 0; i < smoothK; i++) {
    const closePrice = prices[i]
    const highestHigh = Math.max(...highs.slice(i, i + period))
    const lowestLow = Math.min(...lows.slice(i, i + period))
    const range = highestHigh - lowestLow
    if (range > 0) {
      kValues.push(((closePrice - lowestLow) / range) * 100)
    }
  }

  if (kValues.length === 0) return null

  const k = kValues[0]
  // %D is 3-period SMA of %K
  const d = kValues.reduce((a, b) => a + b, 0) / kValues.length

  return {
    k: k,
    d: d
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
// Phase B: Now accepts optional mlPrediction for ML-optimized SL/TP multipliers
export function calculateTradeLevels(analysis, direction, options = {}) {
  const { currentPrice, indicators } = analysis
  const atr = indicators.atr || (currentPrice * 0.001) // Default 0.1% if no ATR
  const { mlPrediction, pair } = options

  // Use ML-optimized multipliers if available, otherwise use defaults
  let slMultiplier = 1.5
  let tpMultiplier = 2.5
  let usingML = false

  if (mlPrediction && mlPrediction.useML) {
    slMultiplier = mlPrediction.slMultiplier
    tpMultiplier = mlPrediction.tpMultiplier
    usingML = true
  }

  let stopLoss, takeProfit
  // Detect JPY pairs by checking pair name, not price magnitude
  // JPY pairs: USD/JPY, EUR/JPY, GBP/JPY, etc. have pip value of 0.01
  const isJPY = pair ? pair.toUpperCase().includes('JPY') : currentPrice > 10

  if (direction === 'UP') {
    stopLoss = currentPrice - (atr * slMultiplier)
    takeProfit = currentPrice + (atr * tpMultiplier)
  } else {
    stopLoss = currentPrice + (atr * slMultiplier)
    takeProfit = currentPrice - (atr * tpMultiplier)
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
    riskRewardRatio: riskReward,
    // Phase B: Include ML metadata
    mlOptimized: usingML,
    slMultiplier,
    tpMultiplier,
    atr
  }
}

// Phase B: Calculate RSI with custom period
export function calculateRSI7(prices) {
  return calculateRSI(prices, 7)
}

// Phase B: Calculate ATR with custom period
export function calculateATR7(highs, lows, closes) {
  return calculateATR(highs, lows, closes, 7)
}

// Phase B: Extended analysis for ML features
export function analyzeForML(priceHistory) {
  const baseAnalysis = analyzePrice(priceHistory)
  if (!baseAnalysis) return null

  const prices = priceHistory.map(p => p.price || p)
  const highs = prices.map(p => p * 1.001)
  const lows = prices.map(p => p * 0.999)

  // Additional indicators for ML
  const rsi7 = calculateRSI(prices, 7)
  const atr7 = calculateATR(highs, lows, prices, 7)

  // Bollinger Band width and position
  const bb = baseAnalysis.indicators.bollinger
  const bbWidth = bb ? (bb.upper - bb.lower) / bb.middle : 0.02
  const bbPosition = bb && baseAnalysis.currentPrice
    ? (baseAnalysis.currentPrice - bb.lower) / (bb.upper - bb.lower)
    : 0.5

  // SMA and EMA cross signals
  const sma20 = baseAnalysis.indicators.sma20
  const sma50 = baseAnalysis.indicators.sma50
  const ema12 = baseAnalysis.indicators.ema12
  const ema26 = baseAnalysis.indicators.ema26

  const smaCross = sma20 && sma50
    ? (sma20 > sma50 ? 'BULLISH' : sma20 < sma50 ? 'BEARISH' : 'NEUTRAL')
    : 'NEUTRAL'
  const emaCross = ema12 && ema26
    ? (ema12 > ema26 ? 'BULLISH' : ema12 < ema26 ? 'BEARISH' : 'NEUTRAL')
    : 'NEUTRAL'

  // Calculate recent volatility (rolling standard deviation)
  const recentPrices = prices.slice(0, 10)
  const mean = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length
  const variance = recentPrices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / recentPrices.length
  const recentVolatility = Math.sqrt(variance)

  return {
    ...baseAnalysis,
    indicators: {
      ...baseAnalysis.indicators,
      rsi7,
      atr7
    },
    mlFeatures: {
      bbWidth,
      bbPosition,
      smaCross,
      emaCross,
      recentVolatility,
      sma20,
      sma50
    }
  }
}
