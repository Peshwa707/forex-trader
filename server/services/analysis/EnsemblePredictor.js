/**
 * Ensemble Predictor
 * Phase 3 Risk Improvement: Combine multiple analysis methods for consensus
 *
 * Implements:
 * - Weighted voting across analysis methods
 * - Confidence calibration based on agreement
 * - Adaptive weights based on recent performance
 * - Consensus threshold for trade execution
 */

import * as db from '../../database.js'
import { regimeDetector } from './RegimeDetector.js'
import { mtfAnalyzer } from './MultiTimeframeAnalyzer.js'
import { hurstAnalyzer } from './HurstAnalyzer.js'
import { orderFlowAnalyzer } from './OrderFlowAnalyzer.js'

// Ensemble methods
export const EnsembleMethod = {
  MAJORITY_VOTE: 'MAJORITY_VOTE',       // Simple majority wins
  WEIGHTED_VOTE: 'WEIGHTED_VOTE',       // Weighted by confidence
  UNANIMOUS: 'UNANIMOUS',               // All must agree
  CONFIDENCE_WEIGHTED: 'CONFIDENCE_WEIGHTED' // Weight by individual confidence
}

// Default configuration
export const DEFAULT_ENSEMBLE_CONFIG = {
  enabled: false,                       // Disabled by default for safety
  method: EnsembleMethod.WEIGHTED_VOTE,
  minAnalysisAgreement: 0.6,            // 60% of analyses must agree
  weights: {
    regime: 0.25,                       // ADX regime detection
    mtf: 0.25,                          // Multi-timeframe
    hurst: 0.25,                        // Hurst exponent
    orderFlow: 0.25                     // Order flow analysis
  },
  adaptiveWeights: false,               // Adjust weights based on performance
  requireMinAnalyses: 2,                // Min analyses that must be available
  consensusBoost: 10,                   // Confidence boost for full consensus
  disagreementPenalty: 15               // Confidence penalty for disagreement
}

/**
 * EnsemblePredictor - Combines multiple analysis methods for consensus signals
 */
export class EnsemblePredictor {
  constructor() {
    this.config = { ...DEFAULT_ENSEMBLE_CONFIG }
    this.performanceHistory = new Map() // Track method performance
  }

  /**
   * Configure with custom settings
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_ENSEMBLE_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      enabled: settings.ensembleEnabled !== undefined
        ? settings.ensembleEnabled
        : this.config.enabled,
      method: settings.ensembleMethod || this.config.method,
      minAnalysisAgreement: settings.ensembleMinAgreement || this.config.minAnalysisAgreement,
      weights: settings.ensembleWeights || this.config.weights,
      adaptiveWeights: settings.ensembleAdaptiveWeights || this.config.adaptiveWeights,
      requireMinAnalyses: settings.ensembleMinAnalyses || this.config.requireMinAnalyses,
      consensusBoost: settings.ensembleConsensusBoost || this.config.consensusBoost,
      disagreementPenalty: settings.ensembleDisagreementPenalty || this.config.disagreementPenalty
    }
  }

  /**
   * Run all analysis methods and collect votes
   */
  async collectVotes(pair, priceHistory, proposedDirection) {
    const votes = []
    const analysisResults = {}

    // 1. Regime Detection
    try {
      const regimeResult = regimeDetector.detectRegime(pair, priceHistory)
      analysisResults.regime = regimeResult

      if (regimeResult.enabled !== false && regimeResult.trendDirection) {
        const agrees = regimeResult.trendDirection === proposedDirection
        votes.push({
          method: 'regime',
          direction: regimeResult.trendDirection,
          agrees,
          confidence: regimeResult.adx ? Math.min(100, regimeResult.adx * 2) : 50,
          details: `ADX: ${regimeResult.adx?.toFixed(1)}, Regime: ${regimeResult.regime}`
        })
      }
    } catch (err) {
      console.warn('[Ensemble] Regime detection failed:', err.message)
    }

    // 2. Multi-Timeframe Analysis
    try {
      const mtfResult = mtfAnalyzer.analyzeMultipleTimeframes(pair, priceHistory)
      analysisResults.mtf = mtfResult

      if (mtfResult.enabled && mtfResult.overallDirection !== 'NEUTRAL') {
        const agrees = mtfResult.overallDirection === proposedDirection
        votes.push({
          method: 'mtf',
          direction: mtfResult.overallDirection,
          agrees,
          confidence: mtfResult.alignmentScore || 50,
          details: `Alignment: ${mtfResult.alignmentScore?.toFixed(0)}%, ${mtfResult.alignedTimeframes}/${mtfResult.totalTimeframes} TFs`
        })
      }
    } catch (err) {
      console.warn('[Ensemble] MTF analysis failed:', err.message)
    }

    // 3. Hurst Analysis
    try {
      const hurstResult = hurstAnalyzer.analyzeMarketCharacter(pair, priceHistory)
      analysisResults.hurst = hurstResult

      if (hurstResult.enabled && !hurstResult.insufficient) {
        // Hurst doesn't give direction directly, but informs strategy appropriateness
        // For trending markets (H > 0.5), we favor the proposed direction
        // For mean-reverting (H < 0.5), we might prefer counter-trend
        let impliedDirection = proposedDirection

        if (hurstResult.hurst < 0.45) {
          // Mean-reverting - favor counter-trend
          impliedDirection = proposedDirection === 'UP' ? 'DOWN' : 'UP'
        }

        const agrees = impliedDirection === proposedDirection
        votes.push({
          method: 'hurst',
          direction: impliedDirection,
          agrees,
          confidence: hurstResult.confidence || 50,
          details: `H=${hurstResult.hurst?.toFixed(3)}, ${hurstResult.character}`
        })
      }
    } catch (err) {
      console.warn('[Ensemble] Hurst analysis failed:', err.message)
    }

    // 4. Order Flow Analysis
    try {
      const flowResult = orderFlowAnalyzer.analyzeOrderFlow(pair, priceHistory)
      analysisResults.orderFlow = flowResult

      if (flowResult.enabled && flowResult.signal !== 'NEUTRAL') {
        const flowDirection = flowResult.signal.includes('BUY') ? 'UP' : 'DOWN'
        const agrees = flowDirection === proposedDirection
        votes.push({
          method: 'orderFlow',
          direction: flowDirection,
          agrees,
          confidence: flowResult.pressure ? Math.abs(flowResult.pressure.buyPressure - 50) * 2 : 50,
          details: `${flowResult.signal}, Buy: ${flowResult.pressure?.buyPressure}%`
        })
      }
    } catch (err) {
      console.warn('[Ensemble] Order flow analysis failed:', err.message)
    }

    return { votes, analysisResults }
  }

  /**
   * Calculate ensemble prediction
   */
  async predict(pair, priceHistory, proposedDirection, baseConfidence) {
    const config = this.getConfig()

    if (!config.enabled) {
      return {
        enabled: false,
        direction: proposedDirection,
        confidence: baseConfidence,
        reason: 'Ensemble prediction disabled'
      }
    }

    // Collect votes from all methods
    const { votes, analysisResults } = await this.collectVotes(pair, priceHistory, proposedDirection)

    if (votes.length < config.requireMinAnalyses) {
      return {
        enabled: true,
        direction: proposedDirection,
        confidence: baseConfidence,
        insufficient: true,
        reason: `Only ${votes.length} analyses available, need ${config.requireMinAnalyses}`,
        votes
      }
    }

    // Calculate consensus based on method
    let result
    switch (config.method) {
      case EnsembleMethod.MAJORITY_VOTE:
        result = this.majorityVote(votes, proposedDirection, baseConfidence, config)
        break
      case EnsembleMethod.WEIGHTED_VOTE:
        result = this.weightedVote(votes, proposedDirection, baseConfidence, config)
        break
      case EnsembleMethod.UNANIMOUS:
        result = this.unanimousVote(votes, proposedDirection, baseConfidence, config)
        break
      case EnsembleMethod.CONFIDENCE_WEIGHTED:
        result = this.confidenceWeightedVote(votes, proposedDirection, baseConfidence, config)
        break
      default:
        result = this.weightedVote(votes, proposedDirection, baseConfidence, config)
    }

    return {
      enabled: true,
      pair,
      proposedDirection,
      ...result,
      votes,
      analysisResults,
      method: config.method
    }
  }

  /**
   * Simple majority vote
   */
  majorityVote(votes, proposedDirection, baseConfidence, config) {
    const agreeing = votes.filter(v => v.agrees).length
    const total = votes.length
    const agreementRatio = agreeing / total

    const passesThreshold = agreementRatio >= config.minAnalysisAgreement

    let confidenceAdjustment = 0
    if (agreementRatio === 1) {
      confidenceAdjustment = config.consensusBoost
    } else if (agreementRatio < 0.5) {
      confidenceAdjustment = -config.disagreementPenalty
    }

    return {
      direction: proposedDirection,
      confidence: Math.max(10, Math.min(95, baseConfidence + confidenceAdjustment)),
      consensus: passesThreshold,
      agreementRatio,
      agreeing,
      total,
      confidenceAdjustment,
      reason: passesThreshold
        ? `Majority consensus: ${agreeing}/${total} (${(agreementRatio * 100).toFixed(0)}%) agree`
        : `No consensus: only ${agreeing}/${total} agree`
    }
  }

  /**
   * Weighted vote based on configured weights
   */
  weightedVote(votes, proposedDirection, baseConfidence, config) {
    let agreeWeight = 0
    let disagreeWeight = 0
    let totalWeight = 0

    for (const vote of votes) {
      const weight = config.weights[vote.method] || 0.25
      totalWeight += weight

      if (vote.agrees) {
        agreeWeight += weight
      } else {
        disagreeWeight += weight
      }
    }

    const agreementRatio = totalWeight > 0 ? agreeWeight / totalWeight : 0.5
    const passesThreshold = agreementRatio >= config.minAnalysisAgreement

    let confidenceAdjustment = 0
    if (agreementRatio > 0.8) {
      confidenceAdjustment = config.consensusBoost
    } else if (agreementRatio < 0.4) {
      confidenceAdjustment = -config.disagreementPenalty
    }

    return {
      direction: proposedDirection,
      confidence: Math.max(10, Math.min(95, baseConfidence + confidenceAdjustment)),
      consensus: passesThreshold,
      agreementRatio,
      agreeWeight,
      disagreeWeight,
      totalWeight,
      confidenceAdjustment,
      reason: passesThreshold
        ? `Weighted consensus: ${(agreementRatio * 100).toFixed(0)}% weighted agreement`
        : `No consensus: ${(agreementRatio * 100).toFixed(0)}% weighted agreement`
    }
  }

  /**
   * Unanimous vote - all must agree
   */
  unanimousVote(votes, proposedDirection, baseConfidence, config) {
    const allAgree = votes.every(v => v.agrees)
    const agreeing = votes.filter(v => v.agrees).length

    let confidenceAdjustment = 0
    if (allAgree) {
      confidenceAdjustment = config.consensusBoost * 1.5 // Bigger boost for unanimous
    } else {
      confidenceAdjustment = -config.disagreementPenalty
    }

    return {
      direction: proposedDirection,
      confidence: Math.max(10, Math.min(95, baseConfidence + confidenceAdjustment)),
      consensus: allAgree,
      agreementRatio: agreeing / votes.length,
      agreeing,
      total: votes.length,
      confidenceAdjustment,
      reason: allAgree
        ? `Unanimous: All ${votes.length} analyses agree`
        : `Not unanimous: ${agreeing}/${votes.length} agree`
    }
  }

  /**
   * Confidence-weighted vote
   */
  confidenceWeightedVote(votes, proposedDirection, baseConfidence, config) {
    let agreeScore = 0
    let disagreeScore = 0

    for (const vote of votes) {
      const baseWeight = config.weights[vote.method] || 0.25
      const confidenceMultiplier = vote.confidence / 100
      const weight = baseWeight * confidenceMultiplier

      if (vote.agrees) {
        agreeScore += weight
      } else {
        disagreeScore += weight
      }
    }

    const totalScore = agreeScore + disagreeScore
    const agreementRatio = totalScore > 0 ? agreeScore / totalScore : 0.5
    const passesThreshold = agreementRatio >= config.minAnalysisAgreement

    let confidenceAdjustment = Math.round((agreementRatio - 0.5) * 30)

    return {
      direction: proposedDirection,
      confidence: Math.max(10, Math.min(95, baseConfidence + confidenceAdjustment)),
      consensus: passesThreshold,
      agreementRatio,
      agreeScore,
      disagreeScore,
      confidenceAdjustment,
      reason: passesThreshold
        ? `Confidence-weighted consensus: ${(agreementRatio * 100).toFixed(0)}%`
        : `No consensus: ${(agreementRatio * 100).toFixed(0)}% weighted`
    }
  }

  /**
   * Record prediction outcome for adaptive weights
   */
  recordOutcome(pair, direction, wasCorrect, votes) {
    if (!this.config.adaptiveWeights) return

    for (const vote of votes) {
      const key = vote.method
      if (!this.performanceHistory.has(key)) {
        this.performanceHistory.set(key, { correct: 0, total: 0 })
      }

      const history = this.performanceHistory.get(key)
      history.total++
      if ((vote.agrees && wasCorrect) || (!vote.agrees && !wasCorrect)) {
        history.correct++
      }
    }
  }

  /**
   * Get adaptive weights based on performance
   */
  getAdaptiveWeights() {
    const weights = {}
    let totalAccuracy = 0

    for (const [method, history] of this.performanceHistory.entries()) {
      if (history.total >= 10) {
        weights[method] = history.correct / history.total
        totalAccuracy += weights[method]
      }
    }

    // Normalize weights
    if (totalAccuracy > 0) {
      for (const method in weights) {
        weights[method] /= totalAccuracy
      }
    }

    return weights
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const config = this.getConfig()

    const methodPerformance = {}
    for (const [method, history] of this.performanceHistory.entries()) {
      methodPerformance[method] = {
        accuracy: history.total > 0 ? (history.correct / history.total * 100).toFixed(1) + '%' : 'N/A',
        trades: history.total
      }
    }

    return {
      enabled: config.enabled,
      method: config.method,
      minAgreement: config.minAnalysisAgreement,
      weights: config.weights,
      adaptiveWeights: config.adaptiveWeights,
      adaptiveWeightsCalculated: this.getAdaptiveWeights(),
      methodPerformance
    }
  }

  /**
   * Clear performance history
   */
  clearHistory() {
    this.performanceHistory.clear()
  }
}

// Singleton instance
export const ensemblePredictor = new EnsemblePredictor()
export default ensemblePredictor
