/**
 * Order Flow Analyzer
 * Phase 3 Risk Improvement: Analyze volume, momentum, and liquidity patterns
 *
 * Implements:
 * - Volume Profile Analysis (approximated from price action)
 * - Momentum divergence detection
 * - Liquidity zone identification
 * - Buy/Sell pressure estimation
 *
 * Note: True order flow requires tick data. This implementation uses
 * price-based proxies suitable for retail forex trading.
 */

import * as db from '../../database.js'

// Order flow signals
export const FlowSignal = {
  STRONG_BUY: 'STRONG_BUY',           // Heavy buying pressure
  BUY: 'BUY',                         // Moderate buying pressure
  NEUTRAL: 'NEUTRAL',                 // Balanced flow
  SELL: 'SELL',                       // Moderate selling pressure
  STRONG_SELL: 'STRONG_SELL'          // Heavy selling pressure
}

// Divergence types
export const DivergenceType = {
  BULLISH_REGULAR: 'BULLISH_REGULAR',   // Lower low price, higher low momentum
  BULLISH_HIDDEN: 'BULLISH_HIDDEN',     // Higher low price, lower low momentum
  BEARISH_REGULAR: 'BEARISH_REGULAR',   // Higher high price, lower high momentum
  BEARISH_HIDDEN: 'BEARISH_HIDDEN',     // Lower high price, higher high momentum
  NONE: 'NONE'
}

// Default configuration
export const DEFAULT_FLOW_CONFIG = {
  enabled: false,                     // Disabled by default for safety
  momentumPeriod: 14,                 // RSI/momentum calculation period
  volumeProfileBins: 20,              // Number of price levels for volume profile
  divergenceLookback: 20,             // Bars to look for divergences
  liquidityZoneStrength: 3,           // Min touches to confirm S/R zone
  flowThreshold: 60,                  // % threshold for buy/sell signal
  adjustConfidenceByFlow: true,       // Apply confidence adjustments
  blockCounterFlowTrades: false       // Block trades against strong flow
}

/**
 * OrderFlowAnalyzer - Analyzes order flow patterns from price action
 */
export class OrderFlowAnalyzer {
  constructor() {
    this.config = { ...DEFAULT_FLOW_CONFIG }
    this.flowCache = new Map()
  }

  /**
   * Configure with custom settings
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_FLOW_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      enabled: settings.orderFlowEnabled !== undefined
        ? settings.orderFlowEnabled
        : this.config.enabled,
      momentumPeriod: settings.flowMomentumPeriod || this.config.momentumPeriod,
      volumeProfileBins: settings.flowVolumeBins || this.config.volumeProfileBins,
      divergenceLookback: settings.flowDivergenceLookback || this.config.divergenceLookback,
      liquidityZoneStrength: settings.flowLiquidityStrength || this.config.liquidityZoneStrength,
      flowThreshold: settings.flowThreshold || this.config.flowThreshold,
      adjustConfidenceByFlow: settings.flowAdjustConfidence !== undefined
        ? settings.flowAdjustConfidence
        : this.config.adjustConfidenceByFlow,
      blockCounterFlowTrades: settings.flowBlockCounter || this.config.blockCounterFlowTrades
    }
  }

  /**
   * Calculate momentum (Rate of Change)
   */
  calculateMomentum(prices, period = 14) {
    const momentum = []
    for (let i = 0; i < prices.length - period; i++) {
      const roc = ((prices[i] - prices[i + period]) / prices[i + period]) * 100
      momentum.push(roc)
    }
    return momentum
  }

  /**
   * Calculate RSI
   */
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50

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

  /**
   * Estimate buying vs selling pressure from price action
   * Uses close position within high-low range as proxy
   */
  estimateBuySellPressure(prices, lookback = 20) {
    if (prices.length < lookback + 1) {
      return { buyPressure: 50, sellPressure: 50, signal: FlowSignal.NEUTRAL }
    }

    let buyBars = 0
    let sellBars = 0

    for (let i = 0; i < lookback && i < prices.length - 1; i++) {
      const current = prices[i]
      const prev = prices[i + 1]

      // Estimate high/low from consecutive prices
      const high = Math.max(current, prev) * 1.001
      const low = Math.min(current, prev) * 0.999
      const range = high - low

      if (range > 0) {
        // Close position within range (0 = low, 1 = high)
        const closePosition = (current - low) / range

        if (closePosition > 0.5) {
          buyBars += closePosition
        } else {
          sellBars += (1 - closePosition)
        }
      }
    }

    const total = buyBars + sellBars
    const buyPressure = total > 0 ? (buyBars / total) * 100 : 50
    const sellPressure = 100 - buyPressure

    const config = this.getConfig()
    let signal

    if (buyPressure > config.flowThreshold + 20) {
      signal = FlowSignal.STRONG_BUY
    } else if (buyPressure > config.flowThreshold) {
      signal = FlowSignal.BUY
    } else if (sellPressure > config.flowThreshold + 20) {
      signal = FlowSignal.STRONG_SELL
    } else if (sellPressure > config.flowThreshold) {
      signal = FlowSignal.SELL
    } else {
      signal = FlowSignal.NEUTRAL
    }

    return {
      buyPressure: Math.round(buyPressure),
      sellPressure: Math.round(sellPressure),
      signal,
      buyBars: Math.round(buyBars),
      sellBars: Math.round(sellBars)
    }
  }

  /**
   * Detect momentum divergences
   */
  detectDivergence(prices, lookback = 20) {
    if (prices.length < lookback + 14) {
      return { type: DivergenceType.NONE, reason: 'Insufficient data' }
    }

    const momentum = this.calculateMomentum(prices, 14)
    if (momentum.length < lookback) {
      return { type: DivergenceType.NONE, reason: 'Insufficient momentum data' }
    }

    // Find price and momentum swings
    const priceSwings = this.findSwings(prices.slice(0, lookback))
    const momSwings = this.findSwings(momentum.slice(0, lookback))

    if (priceSwings.lows.length < 2 || momSwings.lows.length < 2) {
      return { type: DivergenceType.NONE, reason: 'Not enough swings detected' }
    }

    // Check for bullish divergence (price lower low, momentum higher low)
    const priceLow1 = priceSwings.lows[0]
    const priceLow2 = priceSwings.lows[1]
    const momLow1 = momSwings.lows[0]
    const momLow2 = momSwings.lows[1]

    if (priceLow1 && priceLow2 && momLow1 && momLow2) {
      if (priceLow1.value < priceLow2.value && momLow1.value > momLow2.value) {
        return {
          type: DivergenceType.BULLISH_REGULAR,
          strength: Math.abs(momLow1.value - momLow2.value),
          reason: 'Price making lower lows, momentum making higher lows'
        }
      }
      if (priceLow1.value > priceLow2.value && momLow1.value < momLow2.value) {
        return {
          type: DivergenceType.BULLISH_HIDDEN,
          strength: Math.abs(momLow1.value - momLow2.value),
          reason: 'Price making higher lows, momentum making lower lows (trend continuation)'
        }
      }
    }

    // Check for bearish divergence (price higher high, momentum lower high)
    const priceHigh1 = priceSwings.highs[0]
    const priceHigh2 = priceSwings.highs[1]
    const momHigh1 = momSwings.highs[0]
    const momHigh2 = momSwings.highs[1]

    if (priceHigh1 && priceHigh2 && momHigh1 && momHigh2) {
      if (priceHigh1.value > priceHigh2.value && momHigh1.value < momHigh2.value) {
        return {
          type: DivergenceType.BEARISH_REGULAR,
          strength: Math.abs(momHigh1.value - momHigh2.value),
          reason: 'Price making higher highs, momentum making lower highs'
        }
      }
      if (priceHigh1.value < priceHigh2.value && momHigh1.value > momHigh2.value) {
        return {
          type: DivergenceType.BEARISH_HIDDEN,
          strength: Math.abs(momHigh1.value - momHigh2.value),
          reason: 'Price making lower highs, momentum making higher highs (trend continuation)'
        }
      }
    }

    return { type: DivergenceType.NONE, reason: 'No divergence detected' }
  }

  /**
   * Find swing highs and lows
   */
  findSwings(data, minSwingSize = 3) {
    const highs = []
    const lows = []

    for (let i = minSwingSize; i < data.length - minSwingSize; i++) {
      // Check for swing high
      let isHigh = true
      let isLow = true

      for (let j = 1; j <= minSwingSize; j++) {
        if (data[i] <= data[i - j] || data[i] <= data[i + j]) {
          isHigh = false
        }
        if (data[i] >= data[i - j] || data[i] >= data[i + j]) {
          isLow = false
        }
      }

      if (isHigh) highs.push({ index: i, value: data[i] })
      if (isLow) lows.push({ index: i, value: data[i] })
    }

    return { highs, lows }
  }

  /**
   * Identify liquidity zones (support/resistance levels)
   */
  identifyLiquidityZones(prices, bins = 20) {
    if (prices.length < 30) {
      return { zones: [], reason: 'Insufficient data' }
    }

    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const range = max - min
    const binSize = range / bins

    // Count price touches at each level
    const zoneCounts = new Array(bins).fill(0)

    for (const price of prices) {
      const binIndex = Math.min(Math.floor((price - min) / binSize), bins - 1)
      zoneCounts[binIndex]++
    }

    // Find zones with high concentration
    const avgCount = prices.length / bins
    const config = this.getConfig()
    const zones = []

    for (let i = 0; i < bins; i++) {
      if (zoneCounts[i] > avgCount * config.liquidityZoneStrength) {
        const zonePrice = min + (i + 0.5) * binSize
        zones.push({
          price: zonePrice,
          strength: zoneCounts[i],
          type: this.classifyZone(zonePrice, prices[0]) // Current price
        })
      }
    }

    // Sort by strength
    zones.sort((a, b) => b.strength - a.strength)

    return {
      zones: zones.slice(0, 5), // Top 5 zones
      currentPrice: prices[0],
      nearestSupport: zones.find(z => z.type === 'SUPPORT'),
      nearestResistance: zones.find(z => z.type === 'RESISTANCE')
    }
  }

  /**
   * Classify zone as support or resistance
   */
  classifyZone(zonePrice, currentPrice) {
    return zonePrice < currentPrice ? 'SUPPORT' : 'RESISTANCE'
  }

  /**
   * Full order flow analysis for a currency pair
   */
  analyzeOrderFlow(pair, priceHistory) {
    const config = this.getConfig()

    if (!config.enabled) {
      return {
        enabled: false,
        signal: FlowSignal.NEUTRAL,
        reason: 'Order flow analysis disabled'
      }
    }

    // Calculate all components
    const pressure = this.estimateBuySellPressure(priceHistory, 20)
    const divergence = this.detectDivergence(priceHistory, config.divergenceLookback)
    const liquidity = this.identifyLiquidityZones(priceHistory, config.volumeProfileBins)
    const rsi = this.calculateRSI(priceHistory, config.momentumPeriod)

    // Determine overall flow signal
    let overallSignal = pressure.signal
    let confidenceAdjustment = 0

    // Adjust based on divergences
    if (divergence.type === DivergenceType.BULLISH_REGULAR ||
        divergence.type === DivergenceType.BULLISH_HIDDEN) {
      if (overallSignal === FlowSignal.SELL || overallSignal === FlowSignal.STRONG_SELL) {
        overallSignal = FlowSignal.NEUTRAL // Divergence weakens sell signal
      } else {
        confidenceAdjustment += 5
      }
    } else if (divergence.type === DivergenceType.BEARISH_REGULAR ||
               divergence.type === DivergenceType.BEARISH_HIDDEN) {
      if (overallSignal === FlowSignal.BUY || overallSignal === FlowSignal.STRONG_BUY) {
        overallSignal = FlowSignal.NEUTRAL // Divergence weakens buy signal
      } else {
        confidenceAdjustment += 5
      }
    }

    // Apply flow-based confidence adjustment
    if (config.adjustConfidenceByFlow) {
      if (overallSignal === FlowSignal.STRONG_BUY || overallSignal === FlowSignal.STRONG_SELL) {
        confidenceAdjustment += 10
      } else if (overallSignal === FlowSignal.BUY || overallSignal === FlowSignal.SELL) {
        confidenceAdjustment += 5
      }
    }

    // Cache result
    this.flowCache.set(pair, {
      signal: overallSignal,
      pressure,
      timestamp: Date.now()
    })

    return {
      pair,
      enabled: true,
      signal: overallSignal,
      pressure,
      divergence,
      liquidity,
      rsi,
      confidenceAdjustment,
      shouldTrade: this.shouldTrade(overallSignal, config),
      interpretation: this.interpretFlow(overallSignal, pressure, divergence)
    }
  }

  /**
   * Check if trade should proceed based on flow
   */
  shouldTrade(signal, config) {
    if (!config.blockCounterFlowTrades) {
      return { allowed: true }
    }

    // Only block if extremely one-sided
    if (signal === FlowSignal.STRONG_BUY || signal === FlowSignal.STRONG_SELL) {
      return {
        allowed: true,
        direction: signal.includes('BUY') ? 'UP' : 'DOWN'
      }
    }

    return { allowed: true }
  }

  /**
   * Check alignment of trade with flow
   */
  checkFlowAlignment(tradeDirection, flowAnalysis) {
    const signal = flowAnalysis.signal

    const flowBullish = signal === FlowSignal.BUY || signal === FlowSignal.STRONG_BUY
    const flowBearish = signal === FlowSignal.SELL || signal === FlowSignal.STRONG_SELL
    const tradeBullish = tradeDirection === 'UP'

    if (flowBullish && tradeBullish) {
      return { aligned: true, boost: signal === FlowSignal.STRONG_BUY ? 10 : 5 }
    } else if (flowBearish && !tradeBullish) {
      return { aligned: true, boost: signal === FlowSignal.STRONG_SELL ? 10 : 5 }
    } else if (flowBullish && !tradeBullish) {
      return { aligned: false, penalty: signal === FlowSignal.STRONG_BUY ? -10 : -5 }
    } else if (flowBearish && tradeBullish) {
      return { aligned: false, penalty: signal === FlowSignal.STRONG_SELL ? -10 : -5 }
    }

    return { aligned: true, boost: 0 } // Neutral flow
  }

  /**
   * Human-readable flow interpretation
   */
  interpretFlow(signal, pressure, divergence) {
    const parts = []

    parts.push(`Flow: ${signal} (Buy ${pressure.buyPressure}% / Sell ${pressure.sellPressure}%)`)

    if (divergence.type !== DivergenceType.NONE) {
      parts.push(`Divergence: ${divergence.type} - ${divergence.reason}`)
    }

    return parts.join('. ')
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const config = this.getConfig()
    const cachedFlows = {}

    for (const [pair, data] of this.flowCache.entries()) {
      cachedFlows[pair] = {
        signal: data.signal,
        buyPressure: data.pressure.buyPressure,
        sellPressure: data.pressure.sellPressure,
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's ago'
      }
    }

    return {
      enabled: config.enabled,
      momentumPeriod: config.momentumPeriod,
      flowThreshold: config.flowThreshold,
      blockCounterFlow: config.blockCounterFlowTrades,
      cachedFlows
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.flowCache.clear()
  }
}

// Singleton instance
export const orderFlowAnalyzer = new OrderFlowAnalyzer()
export default orderFlowAnalyzer
