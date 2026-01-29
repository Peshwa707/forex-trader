/**
 * MLExplainer - Human-readable explanations for ML predictions
 *
 * Phase B: Real ML Implementation
 *
 * Generates explanations like:
 * "Wider SL (2.1x ATR) due to London session volatility"
 * "Tighter TP (2.8x ATR) - RSI near overbought zone"
 */

export class MLExplainer {
  constructor() {
    // Feature importance thresholds
    this.significantThreshold = 0.6  // Normalized value above this is "significant"
  }

  /**
   * Generate explanation for ML prediction
   * @param {Object} features - Raw features used for prediction
   * @param {Object} prediction - ML prediction result
   * @returns {Object} Explanation with summary and details
   */
  explain(features, prediction) {
    const reasons = []
    const slReasons = []
    const tpReasons = []

    // Analyze session impact
    const sessionExplanation = this._explainSession(features, prediction)
    if (sessionExplanation) {
      reasons.push(sessionExplanation)
      if (sessionExplanation.affectsSL) slReasons.push(sessionExplanation.text)
      if (sessionExplanation.affectsTP) tpReasons.push(sessionExplanation.text)
    }

    // Analyze RSI impact
    const rsiExplanation = this._explainRSI(features, prediction)
    if (rsiExplanation) {
      reasons.push(rsiExplanation)
      if (rsiExplanation.affectsSL) slReasons.push(rsiExplanation.text)
      if (rsiExplanation.affectsTP) tpReasons.push(rsiExplanation.text)
    }

    // Analyze volatility impact
    const volatilityExplanation = this._explainVolatility(features, prediction)
    if (volatilityExplanation) {
      reasons.push(volatilityExplanation)
      if (volatilityExplanation.affectsSL) slReasons.push(volatilityExplanation.text)
      if (volatilityExplanation.affectsTP) tpReasons.push(volatilityExplanation.text)
    }

    // Analyze trend alignment
    const trendExplanation = this._explainTrend(features, prediction)
    if (trendExplanation) {
      reasons.push(trendExplanation)
      if (trendExplanation.affectsSL) slReasons.push(trendExplanation.text)
      if (trendExplanation.affectsTP) tpReasons.push(trendExplanation.text)
    }

    // Analyze signal agreement
    const signalExplanation = this._explainSignalAgreement(features, prediction)
    if (signalExplanation) {
      reasons.push(signalExplanation)
      if (signalExplanation.affectsSL) slReasons.push(signalExplanation.text)
      if (signalExplanation.affectsTP) tpReasons.push(signalExplanation.text)
    }

    // Generate summary
    const summary = this._generateSummary(prediction, reasons)

    return {
      summary,
      slExplanation: slReasons.length > 0
        ? `SL ${prediction.slMultiplier.toFixed(1)}x ATR: ${slReasons.join('; ')}`
        : `SL ${prediction.slMultiplier.toFixed(1)}x ATR (ML-optimized)`,
      tpExplanation: tpReasons.length > 0
        ? `TP ${prediction.tpMultiplier.toFixed(1)}x ATR: ${tpReasons.join('; ')}`
        : `TP ${prediction.tpMultiplier.toFixed(1)}x ATR (ML-optimized)`,
      confidence: `${(prediction.confidence * 100).toFixed(0)}%`,
      reasons: reasons.map(r => r.text)
    }
  }

  /**
   * Explain session impact
   */
  _explainSession(features, prediction) {
    const sessions = []
    if (features.sessionAsian) sessions.push('Asian')
    if (features.sessionLondon) sessions.push('London')
    if (features.sessionOverlap) sessions.push('Overlap')
    if (features.sessionNewyork) sessions.push('NY')

    const session = sessions[0] || 'Off-hours'

    // Different sessions have different characteristics
    if (session === 'London' || session === 'Overlap') {
      if (prediction.slMultiplier > 1.8) {
        return {
          text: `${session} session - higher volatility expected`,
          affectsSL: true,
          affectsTP: false,
          factor: 'session'
        }
      }
    }

    if (session === 'Asian') {
      if (prediction.slMultiplier < 1.5) {
        return {
          text: 'Asian session - typically lower volatility',
          affectsSL: true,
          affectsTP: false,
          factor: 'session'
        }
      }
    }

    return null
  }

  /**
   * Explain RSI impact
   */
  _explainRSI(features, prediction) {
    const rsi = features.rsi14

    if (rsi < 30) {
      // Oversold
      if (features.tradeDirection > 0) {  // BUY
        return {
          text: `RSI oversold (${rsi.toFixed(0)}) - potential for strong bounce`,
          affectsSL: false,
          affectsTP: prediction.tpMultiplier > 2.5,
          factor: 'rsi'
        }
      }
    }

    if (rsi > 70) {
      // Overbought
      if (features.tradeDirection < 0) {  // SELL
        return {
          text: `RSI overbought (${rsi.toFixed(0)}) - potential for pullback`,
          affectsSL: false,
          affectsTP: prediction.tpMultiplier > 2.5,
          factor: 'rsi'
        }
      }
    }

    // RSI near extremes suggests tighter targets
    if ((rsi < 35 || rsi > 65) && prediction.tpMultiplier < 2.5) {
      return {
        text: `RSI near extreme (${rsi.toFixed(0)}) - conservative target`,
        affectsSL: false,
        affectsTP: true,
        factor: 'rsi'
      }
    }

    return null
  }

  /**
   * Explain volatility impact
   */
  _explainVolatility(features, prediction) {
    const bbWidth = features.bbWidth
    const atr = features.atr14

    // High volatility (wide BB)
    if (bbWidth > 0.03) {
      if (prediction.slMultiplier > 2.0) {
        return {
          text: 'High volatility - wider stop to avoid noise',
          affectsSL: true,
          affectsTP: false,
          factor: 'volatility'
        }
      }
    }

    // Low volatility (narrow BB)
    if (bbWidth < 0.015) {
      if (prediction.slMultiplier < 1.5) {
        return {
          text: 'Low volatility - tighter stop appropriate',
          affectsSL: true,
          affectsTP: false,
          factor: 'volatility'
        }
      }
    }

    return null
  }

  /**
   * Explain trend alignment
   */
  _explainTrend(features, prediction) {
    const trendAligned = (features.trendDirection > 0 && features.tradeDirection > 0) ||
                        (features.trendDirection < 0 && features.tradeDirection < 0)

    if (trendAligned && prediction.tpMultiplier > 3.0) {
      return {
        text: 'Trading with trend - extended target possible',
        affectsSL: false,
        affectsTP: true,
        factor: 'trend'
      }
    }

    if (!trendAligned && features.trendDirection !== 0) {
      if (prediction.tpMultiplier < 2.5) {
        return {
          text: 'Counter-trend trade - conservative target',
          affectsSL: false,
          affectsTP: true,
          factor: 'trend'
        }
      }
    }

    return null
  }

  /**
   * Explain signal agreement
   */
  _explainSignalAgreement(features, prediction) {
    const agreement = features.signalAgreementRatio

    if (agreement > 0.8 && prediction.confidence > 0.75) {
      return {
        text: 'Strong signal agreement across indicators',
        affectsSL: false,
        affectsTP: true,
        factor: 'signals'
      }
    }

    if (agreement < 0.4) {
      return {
        text: 'Mixed signals - conservative approach',
        affectsSL: true,
        affectsTP: true,
        factor: 'signals'
      }
    }

    return null
  }

  /**
   * Generate overall summary
   */
  _generateSummary(prediction, reasons) {
    const slDirection = prediction.slMultiplier > 1.8 ? 'wider' :
                       prediction.slMultiplier < 1.3 ? 'tighter' : 'standard'
    const tpDirection = prediction.tpMultiplier > 3.0 ? 'extended' :
                       prediction.tpMultiplier < 2.0 ? 'conservative' : 'standard'

    if (reasons.length === 0) {
      return `ML suggests ${slDirection} SL (${prediction.slMultiplier.toFixed(1)}x) and ${tpDirection} TP (${prediction.tpMultiplier.toFixed(1)}x)`
    }

    const mainReason = reasons[0].text.toLowerCase()
    return `${slDirection.charAt(0).toUpperCase() + slDirection.slice(1)} SL, ${tpDirection} TP - ${mainReason}`
  }

  /**
   * Generate fallback explanation (when ML not used)
   */
  explainFallback(reason) {
    return {
      summary: `Using rule-based SL/TP (1.5x/2.5x ATR)`,
      reason: reason,
      slExplanation: 'SL 1.5x ATR (default)',
      tpExplanation: 'TP 2.5x ATR (default)',
      confidence: 'N/A',
      reasons: [reason]
    }
  }
}
