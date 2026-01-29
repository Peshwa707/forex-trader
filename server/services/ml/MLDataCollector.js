/**
 * MLDataCollector - Captures features and outcomes for ML training
 *
 * Phase B: Real ML Implementation
 * Collects 25 input features at trade entry and tracks excursions during trade.
 */

import {
  createMLTrainingRecord,
  updateMLTrainingOutcome,
  getMLTrainingRecordByTradeId,
  getMarketSession
} from '../../database.js'

export class MLDataCollector {
  constructor() {
    // Track max excursions in memory (updated frequently)
    this.excursionTracker = new Map()
  }

  /**
   * Extract 25 features from technical analysis
   * @param {Object} analysis - Technical analysis results
   * @param {string} direction - 'BUY' or 'SELL'
   * @param {number} confidence - Trade confidence score
   * @returns {Object} Feature vector for ML model
   */
  extractFeatures(analysis, direction, confidence) {
    const now = new Date()
    const hour = now.getUTCHours()
    const dayOfWeek = now.getUTCDay()
    const session = getMarketSession(now)

    // Cyclical encoding for time features
    const hourSin = Math.sin(2 * Math.PI * hour / 24)
    const hourCos = Math.cos(2 * Math.PI * hour / 24)
    const daySin = Math.sin(2 * Math.PI * dayOfWeek / 7)
    const dayCos = Math.cos(2 * Math.PI * dayOfWeek / 7)

    // Session one-hot encoding
    const sessionAsian = session === 'ASIAN'
    const sessionLondon = session === 'LONDON'
    const sessionOverlap = session === 'OVERLAP'
    const sessionNewyork = session === 'NEW_YORK'

    // Extract indicators from analysis
    const rsi14 = analysis.rsi ?? 50
    const rsi7 = analysis.rsi7 ?? analysis.rsi ?? 50

    const macdHistogram = analysis.macd?.histogram ?? 0

    // Bollinger Band metrics
    const bbWidth = analysis.bollingerBands
      ? (analysis.bollingerBands.upper - analysis.bollingerBands.lower) / analysis.bollingerBands.middle
      : 0.02
    const bbPosition = analysis.bollingerBands && analysis.currentPrice
      ? (analysis.currentPrice - analysis.bollingerBands.lower) /
        (analysis.bollingerBands.upper - analysis.bollingerBands.lower)
      : 0.5

    // Stochastic
    const stochK = analysis.stochastic?.k ?? 50

    // ATR values
    const atr14 = analysis.atr ?? 0.001
    const atr7 = analysis.atr7 ?? analysis.atr ?? 0.001

    // Price ratios to SMAs
    const currentPrice = analysis.currentPrice ?? 1
    const sma20 = analysis.sma20 ?? currentPrice
    const sma50 = analysis.sma50 ?? currentPrice
    const priceToSma20Ratio = currentPrice / sma20
    const priceToSma50Ratio = currentPrice / sma50

    // Trend direction as numeric (-1 bearish, 0 neutral, 1 bullish)
    let trendDirection = 0
    if (analysis.trend === 'BULLISH') trendDirection = 1
    else if (analysis.trend === 'BEARISH') trendDirection = -1

    // Recent volatility (rolling stddev of price changes)
    const recentVolatility = analysis.volatility ?? analysis.atr ?? 0.001

    // Trade direction as numeric
    const tradeDirectionNum = direction === 'BUY' ? 1 : -1

    // Confidence score normalized
    const confidenceScore = confidence / 100

    // Signal agreement metrics
    const smaCrossSignal = analysis.smaCross === 'BULLISH' ? 1 :
                          analysis.smaCross === 'BEARISH' ? -1 : 0
    const emaCrossSignal = analysis.emaCross === 'BULLISH' ? 1 :
                          analysis.emaCross === 'BEARISH' ? -1 : 0

    // Count agreeing signals
    const signals = [
      analysis.rsiSignal === direction ? 1 : 0,
      analysis.macdSignal === direction ? 1 : 0,
      analysis.bbSignal === direction ? 1 : 0,
      analysis.stochSignal === direction ? 1 : 0,
      (smaCrossSignal === 1 && direction === 'BUY') ||
      (smaCrossSignal === -1 && direction === 'SELL') ? 1 : 0
    ]
    const signalAgreementRatio = signals.reduce((a, b) => a + b, 0) / signals.length

    return {
      // Momentum indicators (5)
      rsi14,
      rsi7,
      macdHistogram,
      stochK,
      confidenceScore,

      // Volatility indicators (4)
      bbWidth,
      bbPosition,
      atr14,
      atr7,

      // Price ratios (2)
      priceToSma20Ratio,
      priceToSma50Ratio,

      // Trend (1)
      trendDirection,

      // Time features - cyclical encoding (4)
      hourSin,
      hourCos,
      daySin,
      dayCos,

      // Session flags - one-hot (4)
      sessionAsian,
      sessionLondon,
      sessionOverlap,
      sessionNewyork,

      // Volatility (1)
      recentVolatility,

      // Trade context (4)
      tradeDirection: tradeDirectionNum,
      smaCrossSignal,
      emaCrossSignal,
      signalAgreementRatio
    }
  }

  /**
   * Convert features object to array for model input
   * @param {Object} features - Feature object
   * @returns {number[]} Feature array in correct order
   */
  featuresToArray(features) {
    return [
      features.rsi14,
      features.rsi7,
      features.macdHistogram,
      features.bbWidth,
      features.stochK,
      features.atr14,
      features.atr7,
      features.priceToSma20Ratio,
      features.priceToSma50Ratio,
      features.bbPosition,
      features.trendDirection,
      features.hourSin,
      features.hourCos,
      features.daySin,
      features.dayCos,
      features.sessionAsian ? 1 : 0,
      features.sessionLondon ? 1 : 0,
      features.sessionOverlap ? 1 : 0,
      features.sessionNewyork ? 1 : 0,
      features.recentVolatility,
      features.tradeDirection,
      features.confidenceScore,
      features.smaCrossSignal,
      features.emaCrossSignal,
      features.signalAgreementRatio
    ]
  }

  /**
   * Capture trade entry data for ML training
   * @param {Object} trade - Trade object
   * @param {Object} analysis - Technical analysis at entry
   * @param {Object} mlPrediction - ML prediction used (if any)
   * @returns {number} Training record ID
   */
  captureEntry(trade, analysis, mlPrediction = null) {
    const features = this.extractFeatures(analysis, trade.direction, trade.confidence)

    // Calculate SL/TP multipliers used
    const atr = analysis.atr ?? 0.001
    const slPips = Math.abs(trade.entryPrice - trade.stopLoss)
    const tpPips = Math.abs(trade.takeProfit - trade.entryPrice)
    const slMultiplier = slPips / atr
    const tpMultiplier = tpPips / atr

    const recordId = createMLTrainingRecord({
      tradeId: trade.id,
      ...features,
      slMultiplierUsed: slMultiplier,
      tpMultiplierUsed: tpMultiplier,
      abTestGroup: mlPrediction?.abTestGroup ?? null,
      mlPredictedSl: mlPrediction?.slMultiplier ?? null,
      mlPredictedTp: mlPrediction?.tpMultiplier ?? null,
      mlConfidence: mlPrediction?.confidence ?? null
    })

    // Initialize excursion tracking
    this.excursionTracker.set(trade.id, {
      maxFavorable: 0,
      maxAdverse: 0
    })

    return recordId
  }

  /**
   * Update max favorable/adverse excursion during trade
   * @param {number} tradeId - Trade ID
   * @param {number} currentPnlPips - Current unrealized P/L in pips
   */
  updateExcursion(tradeId, currentPnlPips) {
    const excursion = this.excursionTracker.get(tradeId)
    if (!excursion) return

    if (currentPnlPips > 0) {
      excursion.maxFavorable = Math.max(excursion.maxFavorable, currentPnlPips)
    } else {
      excursion.maxAdverse = Math.min(excursion.maxAdverse, currentPnlPips)
    }
  }

  /**
   * Capture trade outcome when trade closes
   * @param {number} tradeId - Trade ID
   * @param {Object} outcome - Trade outcome data
   */
  captureOutcome(tradeId, outcome) {
    const excursion = this.excursionTracker.get(tradeId) ?? { maxFavorable: 0, maxAdverse: 0 }

    // Calculate what optimal SL/TP would have been based on excursions
    // Optimal SL = max adverse excursion + small buffer
    // Optimal TP = max favorable excursion (for winning trades)
    const optimalSl = Math.abs(excursion.maxAdverse) + 2  // Add 2 pip buffer
    const optimalTp = excursion.maxFavorable > 0 ? excursion.maxFavorable : outcome.tpPips

    updateMLTrainingOutcome(tradeId, {
      maxFavorableExcursion: excursion.maxFavorable,
      maxAdverseExcursion: excursion.maxAdverse,
      optimalSl,
      optimalTp,
      pnlPips: outcome.pnlPips,
      closeReason: outcome.closeReason
    })

    // Clean up memory
    this.excursionTracker.delete(tradeId)
  }

  /**
   * Get feature names in order (for debugging/display)
   */
  static getFeatureNames() {
    return [
      'rsi_14', 'rsi_7', 'macd_histogram', 'bb_width', 'stoch_k',
      'atr_14', 'atr_7', 'price_to_sma20_ratio', 'price_to_sma50_ratio', 'bb_position',
      'trend_direction', 'hour_sin', 'hour_cos', 'day_sin', 'day_cos',
      'session_asian', 'session_london', 'session_overlap', 'session_newyork',
      'recent_volatility', 'trade_direction', 'confidence_score',
      'sma_cross_signal', 'ema_cross_signal', 'signal_agreement_ratio'
    ]
  }
}
