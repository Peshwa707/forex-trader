/**
 * Swing Strategy Engine
 * Implements swing trading entry strategies:
 * 1. Trend Pullback (Primary) - Enter on pullbacks to Fib/MA levels in trends
 * 2. Breakout - Enter on breakouts from consolidation
 * 3. Mean Reversion - Enter at extremes in ranging markets
 */

import { getAllSettings } from '../../database.js'
import { swingPointDetector } from '../analysis/SwingPointDetector.js'
import { fibonacciAnalyzer } from '../analysis/FibonacciAnalyzer.js'
import { regimeDetector } from '../analysis/RegimeDetector.js'

/**
 * Strategy types
 */
export const SwingStrategy = {
  TREND_PULLBACK: 'TREND_PULLBACK',
  BREAKOUT: 'BREAKOUT',
  MEAN_REVERSION: 'MEAN_REVERSION'
}

/**
 * @typedef {Object} SwingSignal
 * @property {boolean} shouldTrade - Whether a trade should be taken
 * @property {string} direction - 'UP' or 'DOWN'
 * @property {string} strategy - The strategy that triggered
 * @property {number} confidence - Confidence score 0-100
 * @property {number} entryPrice - Suggested entry price
 * @property {number} stopLoss - Suggested stop loss
 * @property {number} takeProfit - Suggested take profit
 * @property {string} reasoning - Explanation of the signal
 */

class SwingStrategyEngine {
  constructor() {
    this.cache = new Map()
  }

  /**
   * Analyze candles and generate a swing trade signal
   * @param {string} pair - Currency pair
   * @param {Array} dailyCandles - Array of daily candles (oldest to newest)
   * @param {Array} priceHistory - Recent tick prices for indicators
   * @param {Object} indicators - Technical indicators (RSI, MACD, BB, etc.)
   * @returns {SwingSignal} The swing trade signal
   */
  async analyzeForSwingTrade(pair, dailyCandles, priceHistory, indicators) {
    const settings = getAllSettings()

    if (!settings.swingTradingEnabled) {
      return {
        shouldTrade: false,
        reason: 'Swing trading is disabled'
      }
    }

    if (!dailyCandles || dailyCandles.length < 20) {
      return {
        shouldTrade: false,
        reason: `Insufficient daily candle data (${dailyCandles?.length || 0}/20 required)`
      }
    }

    const currentPrice = dailyCandles[dailyCandles.length - 1].close
    const strategy = settings.swingStrategy || SwingStrategy.TREND_PULLBACK

    // Get market structure analysis
    const marketStructure = swingPointDetector.analyzeMarketStructure(dailyCandles)

    // Get regime detection
    const regime = regimeDetector.detectRegime(pair, priceHistory)

    // Route to appropriate strategy
    let signal
    switch (strategy) {
      case SwingStrategy.TREND_PULLBACK:
        signal = await this.analyzeTrendPullback(pair, dailyCandles, currentPrice, marketStructure, regime, indicators, settings)
        break
      case SwingStrategy.BREAKOUT:
        signal = await this.analyzeBreakout(pair, dailyCandles, currentPrice, marketStructure, regime, indicators, settings)
        break
      case SwingStrategy.MEAN_REVERSION:
        signal = await this.analyzeMeanReversion(pair, dailyCandles, currentPrice, marketStructure, regime, indicators, settings)
        break
      default:
        signal = await this.analyzeTrendPullback(pair, dailyCandles, currentPrice, marketStructure, regime, indicators, settings)
    }

    return signal
  }

  /**
   * Strategy 1: Trend Pullback
   * Enter on pullbacks to Fib levels or moving averages in established trends
   */
  async analyzeTrendPullback(pair, dailyCandles, currentPrice, marketStructure, regime, indicators, settings) {
    const minADX = settings.swingMinADX || 25

    // Check 1: Is there a trend? (ADX > 25)
    if (!regime || regime.adx < minADX) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.TREND_PULLBACK,
        reason: `ADX ${regime?.adx?.toFixed(1) || 'N/A'} below threshold ${minADX} - no trend`
      }
    }

    // Check 2: Market structure confirms trend
    const trendDirection = regime.trendDirection // 'UP' or 'DOWN'
    if (marketStructure.trend === 'RANGING') {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.TREND_PULLBACK,
        reason: 'Market structure shows ranging, not trending'
      }
    }

    // Check 3: Get swing points for Fibonacci calculation
    const swingHighs = swingPointDetector.detectSwingHighs(dailyCandles)
    const swingLows = swingPointDetector.detectSwingLows(dailyCandles)

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.TREND_PULLBACK,
        reason: 'Insufficient swing points for Fibonacci analysis'
      }
    }

    const lastSwingHigh = swingHighs[swingHighs.length - 1]
    const lastSwingLow = swingLows[swingLows.length - 1]

    // Check 4: Analyze Fibonacci position
    const fibAnalysis = fibonacciAnalyzer.analyzePosition(
      currentPrice,
      lastSwingHigh.price,
      lastSwingLow.price,
      trendDirection
    )

    // Check 5: Is price in the pullback zone (38.2% - 61.8%)?
    const inPullbackZone = fibAnalysis.inEntryZone ||
      (fibAnalysis.retracementRatio >= 0.382 && fibAnalysis.retracementRatio <= 0.618)

    if (!inPullbackZone) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.TREND_PULLBACK,
        reason: `Price not in pullback zone (${fibAnalysis.retracementPercent} retraced, need 38.2-61.8%)`
      }
    }

    // Check 6: RSI confirmation
    const rsi = indicators?.rsi
    const rsiOversold = settings.swingRSIOversold || 40
    const rsiOverbought = settings.swingRSIOverbought || 60

    let rsiConfirms = false
    if (trendDirection === 'UP' && rsi && rsi < rsiOversold) {
      rsiConfirms = true // Oversold in uptrend = buy opportunity
    } else if (trendDirection === 'DOWN' && rsi && rsi > rsiOverbought) {
      rsiConfirms = true // Overbought in downtrend = sell opportunity
    }

    // Build confidence score
    let confidence = 50 // Base

    // ADX strength bonus
    if (regime.adx > 40) confidence += 15
    else if (regime.adx > 30) confidence += 10
    else confidence += 5

    // Fibonacci level bonus
    if (fibAnalysis.entryQuality === 'EXCELLENT') confidence += 20
    else if (fibAnalysis.entryQuality === 'GOOD') confidence += 10

    // RSI confirmation bonus
    if (rsiConfirms) confidence += 15

    // Market structure bonus
    if (marketStructure.strength > 70) confidence += 10

    // Cap confidence
    confidence = Math.min(95, confidence)

    // Check minimum confidence
    const minConfidence = settings.swingConfidenceThreshold || 65
    if (confidence < minConfidence) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.TREND_PULLBACK,
        confidence,
        reason: `Confidence ${confidence}% below threshold ${minConfidence}%`
      }
    }

    // Calculate entry levels
    const direction = trendDirection
    const signal = direction === 'UP' ? 'BUY' : 'SELL'

    // Stop loss: Below/above last swing point with ATR buffer
    const atr = indicators?.atr || (lastSwingHigh.price - lastSwingLow.price) * 0.1
    const slMultiplier = settings.swingATRMultiplierSL || 2.0
    const tpMultiplier = settings.swingATRMultiplierTP || 3.0

    let stopLoss, takeProfit
    if (direction === 'UP') {
      stopLoss = Math.min(lastSwingLow.price, currentPrice - (atr * slMultiplier))
      takeProfit = currentPrice + (atr * tpMultiplier)
    } else {
      stopLoss = Math.max(lastSwingHigh.price, currentPrice + (atr * slMultiplier))
      takeProfit = currentPrice - (atr * tpMultiplier)
    }

    // Risk calculation
    const riskPips = Math.abs(currentPrice - stopLoss) / (pair.includes('JPY') ? 0.01 : 0.0001)
    const rewardPips = Math.abs(takeProfit - currentPrice) / (pair.includes('JPY') ? 0.01 : 0.0001)

    return {
      shouldTrade: true,
      pair,
      direction,
      signal,
      strategy: SwingStrategy.TREND_PULLBACK,
      confidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      stopLossPips: riskPips,
      takeProfitPips: rewardPips,
      riskRewardRatio: rewardPips / riskPips,
      reasoning: this.buildReasoning('TREND_PULLBACK', {
        adx: regime.adx,
        trendDirection,
        fibLevel: fibAnalysis.retracementPercent,
        rsi,
        rsiConfirms,
        entryQuality: fibAnalysis.entryQuality
      }),
      analysis: {
        regime,
        marketStructure,
        fibAnalysis,
        indicators: { rsi, atr }
      }
    }
  }

  /**
   * Strategy 2: Breakout
   * Enter on breakouts from consolidation near S/R levels
   */
  async analyzeBreakout(pair, dailyCandles, currentPrice, marketStructure, regime, indicators, settings) {
    // Check for consolidation (low ADX, tight Bollinger Bands)
    const isConsolidating = regime && regime.adx < 25

    if (!isConsolidating) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.BREAKOUT,
        reason: `ADX ${regime?.adx?.toFixed(1) || 'N/A'} indicates trending, not consolidating`
      }
    }

    // Check Bollinger Band squeeze
    const bbWidth = indicators?.bbWidth
    const isSqueezing = bbWidth && bbWidth < 0.02 // Tight bands

    if (!isSqueezing) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.BREAKOUT,
        reason: `No volatility squeeze detected (BB width: ${bbWidth?.toFixed(4) || 'N/A'})`
      }
    }

    // Find key levels
    const keyLevels = swingPointDetector.findKeyLevels(dailyCandles)

    // Check if price is near a key level
    const nearResistance = keyLevels.nearestResistance &&
      Math.abs(currentPrice - keyLevels.nearestResistance.center) / currentPrice < 0.005
    const nearSupport = keyLevels.nearestSupport &&
      Math.abs(currentPrice - keyLevels.nearestSupport.center) / currentPrice < 0.005

    if (!nearResistance && !nearSupport) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.BREAKOUT,
        reason: 'Price not near key support/resistance level'
      }
    }

    // Check for breakout confirmation (price closing beyond level)
    const lastCandle = dailyCandles[dailyCandles.length - 1]
    let breakoutDirection = null

    if (nearResistance && lastCandle.close > keyLevels.nearestResistance.center) {
      breakoutDirection = 'UP'
    } else if (nearSupport && lastCandle.close < keyLevels.nearestSupport.center) {
      breakoutDirection = 'DOWN'
    }

    if (!breakoutDirection) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.BREAKOUT,
        reason: 'No confirmed breakout yet - price has not closed beyond level'
      }
    }

    // Build confidence
    let confidence = 55

    // Volume/momentum confirmation would boost this
    if (bbWidth < 0.015) confidence += 10 // Very tight squeeze
    if (regime.adx < 20) confidence += 5 // Stronger consolidation

    // Key level strength
    const levelStrength = breakoutDirection === 'UP'
      ? keyLevels.nearestResistance?.strength
      : keyLevels.nearestSupport?.strength
    if (levelStrength >= 3) confidence += 15

    confidence = Math.min(90, confidence)

    const minConfidence = settings.swingConfidenceThreshold || 65
    if (confidence < minConfidence) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.BREAKOUT,
        confidence,
        reason: `Confidence ${confidence}% below threshold ${minConfidence}%`
      }
    }

    // Calculate levels
    const direction = breakoutDirection
    const signal = direction === 'UP' ? 'BUY' : 'SELL'
    const atr = indicators?.atr || Math.abs(lastCandle.high - lastCandle.low)
    const slMultiplier = settings.swingATRMultiplierSL || 2.0
    const tpMultiplier = settings.swingATRMultiplierTP || 3.0

    let stopLoss, takeProfit
    if (direction === 'UP') {
      // Stop below the broken resistance (now support)
      stopLoss = keyLevels.nearestResistance.center - (atr * slMultiplier)
      takeProfit = currentPrice + (atr * tpMultiplier)
    } else {
      // Stop above the broken support (now resistance)
      stopLoss = keyLevels.nearestSupport.center + (atr * slMultiplier)
      takeProfit = currentPrice - (atr * tpMultiplier)
    }

    return {
      shouldTrade: true,
      pair,
      direction,
      signal,
      strategy: SwingStrategy.BREAKOUT,
      confidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      reasoning: this.buildReasoning('BREAKOUT', {
        adx: regime.adx,
        bbWidth,
        breakoutDirection,
        levelStrength
      }),
      analysis: { regime, keyLevels, indicators }
    }
  }

  /**
   * Strategy 3: Mean Reversion
   * Enter at extremes in ranging markets
   */
  async analyzeMeanReversion(pair, dailyCandles, currentPrice, marketStructure, regime, indicators, settings) {
    // Check for ranging market (low ADX)
    if (regime && regime.adx > 20) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.MEAN_REVERSION,
        reason: `ADX ${regime.adx.toFixed(1)} indicates trending, mean reversion requires ranging (ADX < 20)`
      }
    }

    // Check Bollinger Band position
    const bbPosition = indicators?.bbPosition // -1 to 1 (lower band to upper band)

    if (bbPosition === undefined) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.MEAN_REVERSION,
        reason: 'Bollinger Band data not available'
      }
    }

    // Need price at extremes
    const atUpperExtreme = bbPosition > 0.9
    const atLowerExtreme = bbPosition < -0.9

    if (!atUpperExtreme && !atLowerExtreme) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.MEAN_REVERSION,
        reason: `Price not at BB extremes (position: ${(bbPosition * 100).toFixed(1)}%)`
      }
    }

    // RSI divergence check
    const rsi = indicators?.rsi
    let hasDivergence = false

    if (atUpperExtreme && rsi && rsi < 70) {
      hasDivergence = true // Price at upper BB but RSI not overbought = bearish divergence
    } else if (atLowerExtreme && rsi && rsi > 30) {
      hasDivergence = true // Price at lower BB but RSI not oversold = bullish divergence
    }

    // Build confidence
    let confidence = 50

    // BB extreme
    if (Math.abs(bbPosition) > 0.95) confidence += 15
    else confidence += 10

    // Divergence
    if (hasDivergence) confidence += 20

    // Market structure ranging
    if (marketStructure.trend === 'RANGING') confidence += 10

    confidence = Math.min(85, confidence) // Cap lower for mean reversion

    const minConfidence = settings.swingConfidenceThreshold || 65
    if (confidence < minConfidence) {
      return {
        shouldTrade: false,
        strategy: SwingStrategy.MEAN_REVERSION,
        confidence,
        reason: `Confidence ${confidence}% below threshold ${minConfidence}%`
      }
    }

    // Calculate levels
    const direction = atUpperExtreme ? 'DOWN' : 'UP' // Fade the extreme
    const signal = direction === 'UP' ? 'BUY' : 'SELL'

    // Get recent swing range for stops
    const recentRange = swingPointDetector.getDistanceToSwings(currentPrice, dailyCandles)
    const atr = indicators?.atr || (recentRange.swingRange || 0.01)

    let stopLoss, takeProfit
    if (direction === 'UP') {
      // Buying at lower extreme
      stopLoss = currentPrice - (atr * 1.5) // Tighter stop for mean reversion
      takeProfit = indicators?.bollinger?.middle || (currentPrice + atr * 2) // Target middle BB
    } else {
      // Selling at upper extreme
      stopLoss = currentPrice + (atr * 1.5)
      takeProfit = indicators?.bollinger?.middle || (currentPrice - atr * 2)
    }

    return {
      shouldTrade: true,
      pair,
      direction,
      signal,
      strategy: SwingStrategy.MEAN_REVERSION,
      confidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      reasoning: this.buildReasoning('MEAN_REVERSION', {
        adx: regime?.adx,
        bbPosition,
        rsi,
        hasDivergence,
        extreme: atUpperExtreme ? 'UPPER' : 'LOWER'
      }),
      analysis: { regime, indicators, marketStructure }
    }
  }

  /**
   * Build human-readable reasoning for the signal
   */
  buildReasoning(strategy, data) {
    const parts = []

    switch (strategy) {
      case 'TREND_PULLBACK':
        parts.push(`ADX at ${data.adx?.toFixed(1)} confirms ${data.trendDirection} trend`)
        parts.push(`Price has retraced ${data.fibLevel} (${data.entryQuality} entry zone)`)
        if (data.rsiConfirms) {
          parts.push(`RSI at ${data.rsi?.toFixed(1)} confirms ${data.trendDirection === 'UP' ? 'oversold' : 'overbought'} pullback`)
        }
        break

      case 'BREAKOUT':
        parts.push(`Volatility squeeze detected (ADX: ${data.adx?.toFixed(1)}, BB width: ${data.bbWidth?.toFixed(4)})`)
        parts.push(`${data.breakoutDirection} breakout confirmed`)
        if (data.levelStrength >= 3) {
          parts.push(`Breaking strong level tested ${data.levelStrength} times`)
        }
        break

      case 'MEAN_REVERSION':
        parts.push(`Ranging market (ADX: ${data.adx?.toFixed(1)})`)
        parts.push(`Price at ${data.extreme} Bollinger Band extreme`)
        if (data.hasDivergence) {
          parts.push(`RSI divergence at ${data.rsi?.toFixed(1)} suggests reversal`)
        }
        break
    }

    return parts.join('. ') + '.'
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const settings = getAllSettings()
    return {
      enabled: settings.swingTradingEnabled,
      activeStrategy: settings.swingStrategy || SwingStrategy.TREND_PULLBACK,
      confidenceThreshold: settings.swingConfidenceThreshold || 65,
      minADX: settings.swingMinADX || 25
    }
  }
}

// Singleton instance
export const swingStrategyEngine = new SwingStrategyEngine()

// Named export for class
export { SwingStrategyEngine }

export default SwingStrategyEngine
