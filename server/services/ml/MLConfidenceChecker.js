/**
 * MLConfidenceChecker - Validates ML predictions and decides fallback
 *
 * Phase B: Real ML Implementation
 *
 * Checks:
 * - Model loaded and ready
 * - Prediction confidence above threshold
 * - Features within training distribution
 * - Recent ML performance acceptable
 */

import { getSetting, getMLTrainingData } from '../../database.js'

export class MLConfidenceChecker {
  constructor() {
    // Track recent ML performance
    this.recentMLTrades = []
    this.maxRecentTrades = 20
  }

  /**
   * Check if ML should be used for this prediction
   * @param {Object} context - Prediction context
   * @returns {Object} Decision with reason
   */
  shouldUseML(context) {
    const { modelLoaded, confidence, distributionCheck, features } = context

    const settings = {
      mlConfidenceThreshold: getSetting('mlConfidenceThreshold') ?? 0.7,
      useMLForSLTP: getSetting('useMLForSLTP') ?? false
    }

    // Check master toggle
    if (!settings.useMLForSLTP) {
      return {
        useML: false,
        reason: 'ML disabled in settings',
        code: 'DISABLED'
      }
    }

    // Check model loaded
    if (!modelLoaded) {
      return {
        useML: false,
        reason: 'ML model not loaded',
        code: 'NO_MODEL'
      }
    }

    // Check confidence threshold
    if (confidence < settings.mlConfidenceThreshold) {
      return {
        useML: false,
        reason: `Confidence ${(confidence * 100).toFixed(0)}% below threshold ${(settings.mlConfidenceThreshold * 100).toFixed(0)}%`,
        code: 'LOW_CONFIDENCE'
      }
    }

    // Check feature distribution
    if (distributionCheck && !distributionCheck.inDistribution) {
      return {
        useML: false,
        reason: `${distributionCheck.outlierCount} feature(s) outside training distribution`,
        code: 'OUT_OF_DISTRIBUTION',
        outliers: distributionCheck.outliers
      }
    }

    // Check recent ML performance
    const perfCheck = this.checkRecentPerformance()
    if (!perfCheck.acceptable) {
      return {
        useML: false,
        reason: perfCheck.reason,
        code: 'POOR_RECENT_PERFORMANCE',
        performance: perfCheck
      }
    }

    return {
      useML: true,
      reason: 'All checks passed',
      code: 'OK',
      confidence
    }
  }

  /**
   * Record ML trade outcome for performance tracking
   * @param {Object} trade - Trade with ML prediction
   */
  recordMLTrade(trade) {
    this.recentMLTrades.push({
      tradeId: trade.id,
      pnlPips: trade.pnl_pips ?? trade.pnlPips,
      mlPredictedSl: trade.mlPredictedSl,
      mlPredictedTp: trade.mlPredictedTp,
      closeReason: trade.close_reason ?? trade.closeReason,
      timestamp: Date.now()
    })

    // Keep only recent trades
    if (this.recentMLTrades.length > this.maxRecentTrades) {
      this.recentMLTrades.shift()
    }
  }

  /**
   * Check if recent ML performance is acceptable
   */
  checkRecentPerformance() {
    if (this.recentMLTrades.length < 5) {
      return { acceptable: true, reason: 'Not enough history to evaluate' }
    }

    // Calculate win rate
    const winners = this.recentMLTrades.filter(t => t.pnlPips > 0).length
    const winRate = winners / this.recentMLTrades.length

    // Calculate average P/L
    const avgPnl = this.recentMLTrades.reduce((sum, t) => sum + (t.pnlPips ?? 0), 0) / this.recentMLTrades.length

    // Compare to baseline (assume 50% win rate, 0 avg P/L as baseline)
    const underperforming = winRate < 0.35 || avgPnl < -10

    if (underperforming) {
      return {
        acceptable: false,
        reason: `ML underperforming: ${(winRate * 100).toFixed(0)}% win rate, ${avgPnl.toFixed(1)} avg pips`,
        winRate,
        avgPnl,
        trades: this.recentMLTrades.length
      }
    }

    return {
      acceptable: true,
      reason: 'Performance acceptable',
      winRate,
      avgPnl,
      trades: this.recentMLTrades.length
    }
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    if (this.recentMLTrades.length === 0) {
      return {
        trades: 0,
        message: 'No ML trades recorded yet'
      }
    }

    const winners = this.recentMLTrades.filter(t => t.pnlPips > 0).length
    const losers = this.recentMLTrades.filter(t => t.pnlPips < 0).length
    const breakeven = this.recentMLTrades.length - winners - losers

    const totalPnl = this.recentMLTrades.reduce((sum, t) => sum + (t.pnlPips ?? 0), 0)
    const avgPnl = totalPnl / this.recentMLTrades.length

    const winnerPnl = this.recentMLTrades
      .filter(t => t.pnlPips > 0)
      .reduce((sum, t) => sum + t.pnlPips, 0)
    const loserPnl = Math.abs(this.recentMLTrades
      .filter(t => t.pnlPips < 0)
      .reduce((sum, t) => sum + t.pnlPips, 0))

    return {
      trades: this.recentMLTrades.length,
      winners,
      losers,
      breakeven,
      winRate: (winners / this.recentMLTrades.length * 100).toFixed(1),
      totalPnl: totalPnl.toFixed(1),
      avgPnl: avgPnl.toFixed(1),
      profitFactor: loserPnl > 0 ? (winnerPnl / loserPnl).toFixed(2) : '∞'
    }
  }

  /**
   * Reset performance tracking (e.g., after model retrain)
   */
  reset() {
    this.recentMLTrades = []
  }
}
