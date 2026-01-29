/**
 * MLInference - Runtime prediction service for SL/TP optimization
 *
 * Phase B: Real ML Implementation
 *
 * Handles:
 * - Feature normalization
 * - Model inference
 * - Output clamping and denormalization
 * - Confidence checking and fallback decisions
 */

import { getSetting } from '../../database.js'

export class MLInference {
  constructor(model, normalizer, confidenceChecker) {
    this.model = model
    this.normalizer = normalizer
    this.confidenceChecker = confidenceChecker
  }

  /**
   * Make a prediction for SL/TP multipliers
   * @param {Object} features - Raw features from MLDataCollector.extractFeatures()
   * @returns {Object} Prediction result with multipliers and metadata
   */
  async predict(features) {
    const settings = {
      mlConfidenceThreshold: getSetting('mlConfidenceThreshold') ?? 0.7,
      slMin: getSetting('slMultiplierMin') ?? 0.5,
      slMax: getSetting('slMultiplierMax') ?? 3.0,
      tpMin: getSetting('tpMultiplierMin') ?? 1.0,
      tpMax: getSetting('tpMultiplierMax') ?? 5.0
    }

    // Convert features object to array
    const featureArray = this._featuresToArray(features)

    // Check if features are within training distribution
    const distributionCheck = this.normalizer.checkDistribution(featureArray)
    if (!distributionCheck.inDistribution) {
      return {
        shouldUseML: false,
        fallbackReason: `Features outside training distribution (${distributionCheck.outlierCount} outliers)`,
        outliers: distributionCheck.outliers
      }
    }

    // Normalize features
    const normalizedFeatures = this.normalizer.normalize(featureArray)

    // Get model prediction
    const rawOutput = this.model.predictOne(normalizedFeatures)

    // Denormalize output to actual multiplier ranges
    const { slMultiplier, tpMultiplier } = this.normalizer.denormalizeOutput(rawOutput, {
      slMin: settings.slMin,
      slMax: settings.slMax,
      tpMin: settings.tpMin,
      tpMax: settings.tpMax
    })

    // Calculate prediction confidence
    const confidence = this._calculateConfidence(rawOutput, features, normalizedFeatures)

    // Check if confidence meets threshold
    if (confidence < settings.mlConfidenceThreshold) {
      return {
        shouldUseML: false,
        fallbackReason: `Confidence too low (${(confidence * 100).toFixed(1)}% < ${(settings.mlConfidenceThreshold * 100).toFixed(0)}% threshold)`,
        confidence,
        rawPrediction: { slMultiplier, tpMultiplier }
      }
    }

    // Check additional safety constraints
    const safetyCheck = this._checkSafetyConstraints(slMultiplier, tpMultiplier, settings)
    if (!safetyCheck.passed) {
      return {
        shouldUseML: false,
        fallbackReason: safetyCheck.reason,
        confidence,
        rawPrediction: { slMultiplier, tpMultiplier }
      }
    }

    return {
      shouldUseML: true,
      slMultiplier,
      tpMultiplier,
      confidence,
      rawOutput,
      normalizedFeatures
    }
  }

  /**
   * Convert features object to array in expected order
   */
  _featuresToArray(features) {
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
   * Calculate confidence score for prediction
   * Based on:
   * - How centered the output is (not at extremes)
   * - Feature stability (not extreme values)
   * - Signal agreement
   */
  _calculateConfidence(rawOutput, features, normalizedFeatures) {
    let confidence = 1.0

    // Penalty for extreme outputs (near 0 or 1)
    const slExtremity = Math.min(rawOutput[0], 1 - rawOutput[0]) * 2  // 0-1, 1 at center
    const tpExtremity = Math.min(rawOutput[1], 1 - rawOutput[1]) * 2
    const outputCenteredness = (slExtremity + tpExtremity) / 2

    // Boost confidence when output is moderate (not extreme)
    confidence *= (0.5 + outputCenteredness * 0.5)

    // Boost for signal agreement
    const signalAgreement = features.signalAgreementRatio ?? 0.5
    confidence *= (0.7 + signalAgreement * 0.3)

    // Slight penalty for extreme feature values (possible outliers)
    const extremeFeatures = normalizedFeatures.filter(f =>
      Math.abs(f) > 0.9
    ).length
    if (extremeFeatures > 5) {
      confidence *= 0.8
    }

    // Boost for trade confidence
    const tradeConfidence = features.confidenceScore ?? 0.5
    confidence *= (0.8 + tradeConfidence * 0.2)

    return Math.max(0, Math.min(1, confidence))
  }

  /**
   * Check safety constraints on predictions
   */
  _checkSafetyConstraints(slMultiplier, tpMultiplier, settings) {
    // Minimum risk:reward ratio (1:1.2)
    const riskReward = tpMultiplier / slMultiplier
    if (riskReward < 1.2) {
      return {
        passed: false,
        reason: `Risk:reward ratio too low (${riskReward.toFixed(2)} < 1.2 minimum)`
      }
    }

    // SL should not be wider than TP (unusual and risky)
    if (slMultiplier > tpMultiplier) {
      return {
        passed: false,
        reason: `SL (${slMultiplier.toFixed(2)}) wider than TP (${tpMultiplier.toFixed(2)})`
      }
    }

    // Very tight SL warning
    if (slMultiplier < 0.8) {
      return {
        passed: false,
        reason: `SL too tight (${slMultiplier.toFixed(2)} < 0.8x ATR)`
      }
    }

    return { passed: true }
  }

  /**
   * Get feature importance (approximation using gradients)
   * Note: This is a simplified version - true importance would need more analysis
   */
  getFeatureImportance(features) {
    const featureNames = [
      'RSI-14', 'RSI-7', 'MACD Histogram', 'BB Width', 'Stochastic K',
      'ATR-14', 'ATR-7', 'Price/SMA20', 'Price/SMA50', 'BB Position',
      'Trend', 'Hour (sin)', 'Hour (cos)', 'Day (sin)', 'Day (cos)',
      'Asian Session', 'London Session', 'Overlap Session', 'NY Session',
      'Volatility', 'Direction', 'Signal Confidence', 'SMA Cross', 'EMA Cross',
      'Signal Agreement'
    ]

    // Return top contributing features based on absolute values
    const featureArray = this._featuresToArray(features)
    const normalizedFeatures = this.normalizer.normalize(featureArray)

    const importance = normalizedFeatures.map((value, i) => ({
      name: featureNames[i],
      value: featureArray[i],
      normalizedValue: value,
      contribution: Math.abs(value)
    }))

    // Sort by absolute contribution
    importance.sort((a, b) => b.contribution - a.contribution)

    return importance.slice(0, 5)  // Top 5 features
  }
}
