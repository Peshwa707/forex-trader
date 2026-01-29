/**
 * ML Prediction Service for Server
 * Uses technical analysis to generate trade predictions
 *
 * Phase A Enhancement: Historical pattern-based confidence adjustment
 * Phase B Enhancement: ML-optimized SL/TP calculation
 */

import { analyzeForML, calculateTradeLevels } from './technicalAnalysis.js'
import { calculateConfidenceAdjustment } from './TradeAnalytics.js'
import { getMarketSession, getAllSettings } from '../database.js'

// Swing Trading Services (lazy loaded)
let swingServices = null
async function getSwingServices() {
  if (!swingServices) {
    try {
      const module = await import('./swing/index.js')
      swingServices = module
    } catch (error) {
      console.warn('[mlPrediction] Failed to load swing services:', error.message)
      return null
    }
  }
  return swingServices
}

// Swing ML Model (lazy loaded)
let swingMLModel = null
async function getSwingMLModel() {
  if (!swingMLModel) {
    try {
      const { swingDirectionModel } = await import('./ml/SwingDirectionModel.js')
      await swingDirectionModel.initialize()
      swingMLModel = swingDirectionModel
    } catch (error) {
      console.warn('[mlPrediction] Failed to load swing ML model:', error.message)
      return null
    }
  }
  return swingMLModel
}

// Phase 2: Analysis services import (lazy loaded)
let analysisServices = null
async function getAnalysisServices() {
  if (!analysisServices) {
    try {
      const module = await import('./analysis/index.js')
      analysisServices = module
    } catch (error) {
      console.warn('[mlPrediction] Failed to load analysis services:', error.message)
      return null
    }
  }
  return analysisServices
}

// Phase B: ML Service import (lazy loaded to avoid circular dependencies)
let mlService = null
async function getMLService() {
  if (!mlService) {
    try {
      const mlModule = await import('./ml/index.js')
      mlService = mlModule.mlService
      await mlService.initialize()
    } catch (error) {
      console.warn('[mlPrediction] Failed to load ML service:', error.message)
      return null
    }
  }
  return mlService
}

/**
 * Generate swing trading prediction
 * Uses swing strategies and ML model for multi-day trades
 */
export async function generateSwingPrediction(pair, priceHistory, dailyCandles) {
  const settings = getAllSettings()

  if (!dailyCandles || dailyCandles.length < 30) {
    return {
      success: false,
      pair,
      confidence: 0,
      reason: 'Insufficient daily candle data for swing analysis'
    }
  }

  try {
    // Get swing services
    const swingModule = await getSwingServices()
    if (!swingModule) {
      return { success: false, pair, confidence: 0, reason: 'Swing services not available' }
    }

    const { swingStrategyEngine, swingExitManager, swingPointDetector, fibonacciAnalyzer } = swingModule

    // Get indicators from technical analysis
    const analysis = analyzeForML(priceHistory)
    const indicators = analysis?.indicators || {}

    // Run swing strategy analysis
    const swingAnalysis = swingStrategyEngine.analyzeForSwingTrade(
      pair,
      dailyCandles,
      priceHistory,
      indicators
    )

    if (!swingAnalysis.shouldTrade) {
      return {
        success: false,
        isSwing: true,
        pair,
        confidence: swingAnalysis.confidence || 0,
        reason: swingAnalysis.reasoning?.join('; ') || 'No swing setup found',
        analysis: swingAnalysis
      }
    }

    // Get swing ML prediction if available
    let mlPrediction = null
    const swingModel = await getSwingMLModel()
    if (swingModel && settings.swingMLEnabled) {
      const { swingFeatureExtractor } = await import('./ml/SwingFeatureExtractor.js')
      const features = swingFeatureExtractor.extractFeatures(
        pair,
        dailyCandles,
        null,
        priceHistory,
        indicators
      )
      mlPrediction = await swingModel.predict(features)

      // Override direction if ML has strong conviction
      if (mlPrediction.success && mlPrediction.confidence > 0.7) {
        if (mlPrediction.direction !== swingAnalysis.direction) {
          console.log(`[SwingPrediction] ML overrides strategy direction: ${mlPrediction.direction}`)
        }
      }
    }

    // Calculate ATR for stop loss
    const atr = dailyCandles.slice(-14).reduce((sum, c) => sum + (c.high - c.low), 0) / 14

    // Get swing points for stop placement
    const swingPoints = swingPointDetector.getDistanceToSwings(
      dailyCandles[dailyCandles.length - 1].close,
      dailyCandles
    )

    // Calculate stop loss
    const stopInfo = swingExitManager.calculateSwingStopLoss(
      swingAnalysis.direction,
      swingAnalysis.suggestedEntry,
      atr,
      swingPoints
    )

    // Calculate take profit targets
    const tpInfo = swingExitManager.calculateSwingTakeProfits(
      swingAnalysis.direction,
      swingAnalysis.suggestedEntry,
      stopInfo.stopLoss,
      atr
    )

    // Calculate pip values
    const pipValue = pair.includes('JPY') ? 0.01 : 0.0001
    const stopLossPips = Math.abs(swingAnalysis.suggestedEntry - stopInfo.stopLoss) / pipValue
    const takeProfitPips = Math.abs(tpInfo.tp1 - swingAnalysis.suggestedEntry) / pipValue

    return {
      success: true,
      isSwing: true,
      pair,
      direction: swingAnalysis.direction,
      signal: swingAnalysis.direction === 'UP' ? 'BUY' : 'SELL',
      confidence: swingAnalysis.confidence,
      strategy: swingAnalysis.strategy,
      entryPrice: swingAnalysis.suggestedEntry,
      stopLoss: stopInfo.stopLoss,
      takeProfit: tpInfo.tp1,
      stopLossPips,
      takeProfitPips: takeProfitPips,
      potentialPips: takeProfitPips,
      // Swing-specific data
      atrAtEntry: atr,
      stopMethod: stopInfo.method,
      tpTargets: tpInfo.targets,
      swingPoints,
      // ML prediction if available
      swingML: mlPrediction ? {
        useML: mlPrediction.useML,
        direction: mlPrediction.direction,
        confidence: mlPrediction.confidence,
        magnitudePips: mlPrediction.magnitudePips,
        probabilities: mlPrediction.probabilities
      } : null,
      reasoning: [
        ...swingAnalysis.reasoning,
        stopInfo.explanation,
        tpInfo.explanation
      ].join('. '),
      timestamp: Date.now()
    }
  } catch (error) {
    console.error('[SwingPrediction] Error:', error.message)
    return {
      success: false,
      isSwing: true,
      pair,
      confidence: 0,
      reason: error.message
    }
  }
}

/**
 * Generate prediction for a currency pair
 * Phase B: Now supports async for ML integration
 * Routes to swing prediction when swing trading is enabled
 */
export async function generatePrediction(pair, priceHistory, options = {}) {
  const settings = getAllSettings()

  // Route to swing prediction if enabled and daily candles provided
  if (settings.swingTradingEnabled && options.dailyCandles) {
    return generateSwingPrediction(pair, priceHistory, options.dailyCandles)
  }

  // Original intraday prediction logic follows...
  // Use extended analysis for ML features
  const analysis = analyzeForML(priceHistory)

  if (!analysis) {
    return null
  }

  const { signals, trend, trendStrength, indicators, mlFeatures } = analysis

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

  let confidence = Math.min(90, Math.max(30,
    baseConfidence * 0.6 + signalAgreement * 40
  ))

  // Phase A: Apply historical pattern-based confidence adjustment
  let patternAdjustment = null
  try {
    const now = new Date()
    const tradeContext = {
      rsi: indicators.rsi,
      marketSession: getMarketSession(now),
      hourOfDay: now.getUTCHours(),
      trend
    }
    patternAdjustment = calculateConfidenceAdjustment(tradeContext)
    if (patternAdjustment && patternAdjustment.adjustment !== 0) {
      confidence = Math.min(95, Math.max(25, confidence + patternAdjustment.adjustment))
    }
  } catch (err) {
    // If pattern analysis fails, continue without adjustment
    console.warn('Pattern adjustment failed:', err.message)
  }

  // Phase 2: Regime detection and multi-timeframe analysis
  let phase2Analysis = null
  let phase2Blocked = false
  let phase2BlockReason = null
  try {
    const analysisModule = await getAnalysisServices()
    if (analysisModule) {
      phase2Analysis = analysisModule.analyzeSignal(pair, direction, priceHistory, confidence)

      if (phase2Analysis) {
        // Apply confidence adjustment from regime and MTF
        if (phase2Analysis.confidenceChange !== 0) {
          confidence = Math.min(95, Math.max(25, phase2Analysis.adjustedConfidence))
        }

        // Check if trade should be blocked
        if (!phase2Analysis.shouldTrade) {
          phase2Blocked = true
          phase2BlockReason = phase2Analysis.blockReason
        }
      }
    }
  } catch (err) {
    console.warn('[mlPrediction] Phase 2 analysis failed:', err.message)
  }

  // Phase 3: Ensemble prediction for consensus validation
  let phase3Ensemble = null
  let phase3Blocked = false
  let phase3BlockReason = null
  try {
    const analysisModule = await getAnalysisServices()
    if (analysisModule && analysisModule.ensemblePredictor) {
      const ensembleResult = await analysisModule.ensemblePredictor.predict(
        pair, priceHistory, direction, confidence
      )

      if (ensembleResult && ensembleResult.enabled) {
        phase3Ensemble = ensembleResult

        // Apply ensemble confidence adjustment
        if (ensembleResult.confidence !== confidence) {
          confidence = Math.min(95, Math.max(25, ensembleResult.confidence))
        }

        // Check if ensemble blocks the trade (no consensus)
        if (!ensembleResult.consensus) {
          phase3Blocked = true
          phase3BlockReason = `Ensemble: ${ensembleResult.reason}`
        }
      }
    }
  } catch (err) {
    console.warn('[mlPrediction] Phase 3 ensemble failed:', err.message)
  }

  // Phase B: Get ML prediction for SL/TP optimization
  let mlPrediction = null
  try {
    const ml = await getMLService()
    if (ml) {
      // Build extended analysis object for ML
      const mlAnalysis = {
        ...analysis,
        rsi: indicators.rsi,
        rsi7: indicators.rsi7,
        macd: indicators.macd,
        bollingerBands: indicators.bollinger,
        stochastic: indicators.stochastic,
        atr: indicators.atr,
        atr7: indicators.atr7,
        currentPrice: analysis.currentPrice,
        sma20: mlFeatures?.sma20 ?? indicators.sma20,
        sma50: mlFeatures?.sma50 ?? indicators.sma50,
        bbWidth: mlFeatures?.bbWidth,
        bbPosition: mlFeatures?.bbPosition,
        smaCross: mlFeatures?.smaCross,
        emaCross: mlFeatures?.emaCross,
        volatility: mlFeatures?.recentVolatility,
        trend
      }
      mlPrediction = await ml.predictSLTP(mlAnalysis, direction, Math.round(confidence))
    }
  } catch (err) {
    console.warn('[mlPrediction] ML SL/TP prediction failed:', err.message)
  }

  // Generate trade levels (with ML if available)
  const levels = calculateTradeLevels(analysis, direction, { mlPrediction })

  // Generate reasoning
  const activeSignals = signals
    .filter(s => s.signal === (direction === 'UP' ? 'BUY' : 'SELL'))
    .map(s => s.indicator)

  const reasoning = generateReasoning(direction, activeSignals, indicators, trend)

  // Shariah compliance: Check indicator confluence
  // Note: settings already declared at function start (line 221)
  let shariahBlocked = false
  let shariahBlockReason = null
  if (settings.shariahCompliant) {
    const minConfluence = settings.shariahMinIndicatorConfluence || 3
    const confluence = activeSignals.length
    if (confluence < minConfluence) {
      shariahBlocked = true
      shariahBlockReason = `Shariah: Only ${confluence} indicators agree, need ${minConfluence}+`
    }
  }

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
    // Phase A: Include pattern adjustment for transparency
    patternAdjustment: patternAdjustment ? {
      adjustment: patternAdjustment.adjustment,
      reasons: patternAdjustment.reasons
    } : null,
    // Phase B: Include ML prediction details
    mlPrediction: mlPrediction ? {
      useML: mlPrediction.useML,
      slMultiplier: mlPrediction.slMultiplier,
      tpMultiplier: mlPrediction.tpMultiplier,
      confidence: mlPrediction.confidence,
      explanation: mlPrediction.explanation,
      abTestGroup: mlPrediction.abTestGroup,
      reason: mlPrediction.reason
    } : null,
    // Shariah compliance: Confluence check
    shariahBlocked,
    shariahBlockReason,
    indicatorConfluence: activeSignals.length,
    // Phase 2: Regime and MTF analysis
    phase2Blocked,
    phase2BlockReason,
    regimeAnalysis: phase2Analysis ? {
      regime: phase2Analysis.regime?.type,
      adx: phase2Analysis.regime?.adx,
      trendDirection: phase2Analysis.regime?.trendDirection,
      strategy: phase2Analysis.regime?.strategy
    } : null,
    mtfAnalysis: phase2Analysis ? {
      direction: phase2Analysis.multiTimeframe?.direction,
      alignmentScore: phase2Analysis.multiTimeframe?.alignmentScore,
      aligned: phase2Analysis.multiTimeframe?.aligned
    } : null,
    // Phase 3: Ensemble prediction
    phase3Blocked,
    phase3BlockReason,
    ensembleAnalysis: phase3Ensemble ? {
      method: phase3Ensemble.method,
      confidence: phase3Ensemble.confidence,
      consensus: phase3Ensemble.consensus,
      agreement: phase3Ensemble.agreement,
      votes: phase3Ensemble.votes,
      reason: phase3Ensemble.reason
    } : null,
    // Extended analysis for data collection
    _analysis: analysis,
    _mlFeatures: mlFeatures,
    timestamp: Date.now()
  }
}

/**
 * Generate detailed human-readable explanation
 * Phase A: Trust Foundation - Explains WHY each trade is made
 */
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
 * Generate detailed trade explanation for UI display
 * Phase A: Trust Foundation - Human-readable explanation system
 */
export function generateDetailedExplanation(prediction, decision, settings) {
  const { pair, direction, signal, confidence, indicators, entryPrice, stopLoss, takeProfit, patternAdjustment } = prediction
  const action = decision === 'EXECUTE' ? 'BOUGHT' : decision === 'SOLD' ? 'SOLD' : 'SKIPPED'

  // Build indicator summaries
  const indicatorParts = []

  if (indicators?.rsi) {
    const rsiVal = parseFloat(indicators.rsi)
    if (rsiVal < 30) {
      indicatorParts.push(`RSI shows oversold (${indicators.rsi})`)
    } else if (rsiVal > 70) {
      indicatorParts.push(`RSI shows overbought (${indicators.rsi})`)
    } else {
      indicatorParts.push(`RSI is neutral (${indicators.rsi})`)
    }
  }

  if (indicators?.macd) {
    const macdSignal = indicators.macd === 'Bullish' || parseFloat(indicators.macd) > 0
    indicatorParts.push(`MACD ${macdSignal ? 'crossed bullish' : 'is bearish'}`)
  }

  if (indicators?.trend) {
    indicatorParts.push(`trend is ${indicators.trend.toLowerCase()}`)
  }

  // Add pattern adjustment reasons if available
  if (patternAdjustment?.reasons?.length > 0) {
    patternAdjustment.reasons.forEach(r => {
      const adj = r.adjustment >= 0 ? `+${r.adjustment}%` : `${r.adjustment}%`
      indicatorParts.push(`${r.factor} pattern (${adj} based on ${r.historical})`)
    })
  }

  // Build the explanation based on decision
  let explanation = {
    timestamp: new Date().toISOString(),
    pair,
    action,
    direction,
    signal,
    confidence,
    entryPrice,
    minConfidence: settings.minConfidence
  }

  if (decision === 'EXECUTE') {
    const actionVerb = direction === 'UP' ? 'buying' : 'selling'
    explanation.headline = `${actionVerb.toUpperCase()} ${pair} @ ${entryPrice}`
    explanation.reason = `I'm ${actionVerb} ${pair} because ${indicatorParts.slice(0, 3).join(', ')}.`
    explanation.details = {
      indicators: indicatorParts,
      stopLoss: `Stop loss at ${stopLoss}`,
      takeProfit: `Take profit at ${takeProfit}`,
      confidence: `Confidence: ${confidence}% (threshold: ${settings.minConfidence}%)`
    }
    // Include pattern adjustment info if present
    if (patternAdjustment && patternAdjustment.adjustment !== 0) {
      explanation.details.patternAdjustment = `Adjusted by ${patternAdjustment.adjustment >= 0 ? '+' : ''}${patternAdjustment.adjustment}% based on historical patterns`
      explanation.patternReasons = patternAdjustment.reasons
    }
    explanation.type = 'TRADE_EXECUTED'
  } else if (decision === 'SKIP_LOW_CONFIDENCE') {
    explanation.headline = `NOT trading ${pair}`
    explanation.reason = `I'm NOT trading ${pair} because confidence is only ${confidence}% (need ${settings.minConfidence}% minimum).`
    explanation.details = {
      indicators: indicatorParts,
      confidence: `Current: ${confidence}% | Required: ${settings.minConfidence}%`
    }
    explanation.type = 'TRADE_SKIPPED'
  } else if (decision === 'SKIP_RISK_LIMIT') {
    explanation.headline = `BLOCKED: ${pair} trade`
    explanation.reason = `Trade blocked by risk management limits.`
    explanation.type = 'TRADE_BLOCKED'
  } else {
    explanation.headline = `Analyzing ${pair}`
    explanation.reason = `Current analysis for ${pair}.`
    explanation.type = 'ANALYSIS'
  }

  return explanation
}

/**
 * Generate post-trade explanation after a trade closes
 */
export function generateTradeResultExplanation(trade) {
  const pnl = parseFloat(trade.pnl || 0)
  const pnlPips = parseFloat(trade.pnl_pips || trade.pnlPips || 0)
  const isProfit = pnl >= 0
  const closeReason = trade.close_reason || trade.closeReason || 'Manual'

  const explanation = {
    timestamp: new Date().toISOString(),
    pair: trade.pair,
    type: 'TRADE_RESULT',
    action: isProfit ? 'WIN' : 'LOSS',
    headline: `${trade.pair}: ${isProfit ? '+' : ''}$${pnl.toFixed(2)} (${pnlPips >= 0 ? '+' : ''}${pnlPips.toFixed(1)} pips)`,
    reason: `This trade ${isProfit ? 'made' : 'lost'} $${Math.abs(pnl).toFixed(2)} because ${trade.pair} ${
      trade.direction === 'UP'
        ? (isProfit ? 'rose' : 'fell')
        : (isProfit ? 'fell' : 'rose')
    } ${Math.abs(pnlPips).toFixed(1)} pips ${closeReason === 'TP_HIT' ? 'as predicted' : closeReason === 'SL_HIT' ? 'against the prediction' : ''}.`,
    details: {
      entryPrice: trade.entry_price || trade.entryPrice,
      exitPrice: trade.current_price || trade.currentPrice,
      closeReason,
      duration: trade.opened_at ? calculateDuration(trade.opened_at, trade.closed_at) : 'Unknown'
    }
  }

  return explanation
}

function calculateDuration(openedAt, closedAt) {
  const open = new Date(openedAt)
  const close = closedAt ? new Date(closedAt) : new Date()
  const diffMs = close - open
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)

  if (diffHours > 0) {
    return `${diffHours}h ${diffMins % 60}m`
  }
  return `${diffMins}m`
}

/**
 * Generate predictions for all pairs
 * Phase B: Now async for ML integration
 */
export async function generateAllPredictions(priceHistories) {
  const predictions = []

  for (const [pair, history] of Object.entries(priceHistories)) {
    const prediction = await generatePrediction(pair, history)
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
