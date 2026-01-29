/**
 * ABTestingService - A/B Testing Framework for ML vs Rule-Based
 *
 * Phase B: Real ML Implementation
 *
 * Tracks:
 * - Random assignment to CONTROL (rule-based) or TREATMENT (ML)
 * - Win rate, P/L, Sharpe ratio per group
 * - Statistical significance (p-value)
 */

import {
  createABTest,
  updateABTestResults,
  endABTest,
  getActiveABTest,
  getABTestHistory,
  getABTestGroupStats,
  saveSetting,
  getSetting
} from '../../database.js'

export class ABTestingService {
  constructor() {
    this.currentTest = null
  }

  /**
   * Start a new A/B test
   * @param {string} testName - Name for this test
   * @returns {Object} Test info
   */
  start(testName = 'ML vs Rule-Based') {
    // Check if test already running
    const existing = getActiveABTest()
    if (existing) {
      return {
        success: false,
        error: 'A/B test already running',
        existingTest: existing
      }
    }

    // Create new test
    const testId = createABTest(testName)

    // Enable A/B testing in settings
    saveSetting('abTestEnabled', true)

    this.currentTest = {
      id: testId,
      name: testName,
      startedAt: new Date().toISOString()
    }

    console.log(`[AB Test] Started test: ${testName} (ID: ${testId})`)

    return {
      success: true,
      testId,
      testName
    }
  }

  /**
   * Stop the current A/B test and calculate results
   * @returns {Object} Final test results
   */
  stop() {
    const activeTest = getActiveABTest()
    if (!activeTest) {
      return {
        success: false,
        error: 'No active A/B test'
      }
    }

    // Disable A/B testing
    saveSetting('abTestEnabled', false)

    // Calculate final results
    const results = this.calculateResults()

    // Determine conclusion
    let conclusion
    if (results.pValue < 0.05) {
      if (results.treatment.avgPnl > results.control.avgPnl) {
        conclusion = 'ML BETTER - Statistically significant improvement'
      } else {
        conclusion = 'RULE-BASED BETTER - ML underperformed'
      }
    } else {
      conclusion = 'NO SIGNIFICANT DIFFERENCE - Need more data'
    }

    // Update and close test
    endABTest(activeTest.id, conclusion)

    this.currentTest = null

    console.log(`[AB Test] Ended test: ${conclusion}`)

    return {
      success: true,
      ...results,
      conclusion
    }
  }

  /**
   * Assign a trade to a test group
   * @param {number} splitRatio - Probability of assignment to TREATMENT (ML)
   * @returns {string} 'CONTROL' or 'TREATMENT'
   */
  assignGroup(splitRatio = 0.5) {
    const isEnabled = getSetting('abTestEnabled')
    if (!isEnabled) {
      return null
    }

    return Math.random() < splitRatio ? 'TREATMENT' : 'CONTROL'
  }

  /**
   * Get current active test
   */
  getActiveTest() {
    return getActiveABTest()
  }

  /**
   * Calculate A/B test results
   */
  calculateResults() {
    const { control, treatment } = getABTestGroupStats()

    const controlStats = this._calculateGroupStats(control)
    const treatmentStats = this._calculateGroupStats(treatment)

    // Calculate p-value using Welch's t-test
    const pValue = this._calculatePValue(control, treatment)

    // Update test results in DB
    const activeTest = getActiveABTest()
    if (activeTest) {
      updateABTestResults(activeTest.id, {
        controlTrades: controlStats.trades,
        treatmentTrades: treatmentStats.trades,
        controlWinRate: controlStats.winRate,
        treatmentWinRate: treatmentStats.winRate,
        controlAvgPnl: controlStats.avgPnl,
        treatmentAvgPnl: treatmentStats.avgPnl,
        controlSharpe: controlStats.sharpe,
        treatmentSharpe: treatmentStats.sharpe,
        pValue
      })
    }

    return {
      control: controlStats,
      treatment: treatmentStats,
      pValue,
      significant: pValue < 0.05,
      improvement: treatmentStats.avgPnl - controlStats.avgPnl
    }
  }

  /**
   * Calculate statistics for a test group
   */
  _calculateGroupStats(trades) {
    if (!trades || trades.length === 0) {
      return {
        trades: 0,
        winRate: 0,
        avgPnl: 0,
        totalPnl: 0,
        sharpe: 0,
        maxDrawdown: 0
      }
    }

    const pnls = trades.map(t => t.pnl_pips ?? 0)
    const winners = pnls.filter(p => p > 0).length

    const totalPnl = pnls.reduce((a, b) => a + b, 0)
    const avgPnl = totalPnl / pnls.length

    // Calculate Sharpe ratio (simplified - assumes daily returns)
    const mean = avgPnl
    const variance = pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pnls.length
    const stdDev = Math.sqrt(variance) || 1
    const sharpe = mean / stdDev * Math.sqrt(252)  // Annualized

    // Calculate max drawdown
    let peak = 0
    let maxDrawdown = 0
    let cumulative = 0
    for (const pnl of pnls) {
      cumulative += pnl
      if (cumulative > peak) peak = cumulative
      const drawdown = (peak - cumulative)
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }

    return {
      trades: trades.length,
      winners,
      winRate: winners / trades.length,
      avgPnl,
      totalPnl,
      sharpe,
      maxDrawdown
    }
  }

  /**
   * Calculate p-value using Welch's t-test
   * Tests if the means of two groups are significantly different
   */
  _calculatePValue(control, treatment) {
    if (control.length < 5 || treatment.length < 5) {
      return 1  // Not enough data
    }

    const pnl1 = control.map(t => t.pnl_pips ?? 0)
    const pnl2 = treatment.map(t => t.pnl_pips ?? 0)

    const n1 = pnl1.length
    const n2 = pnl2.length

    const mean1 = pnl1.reduce((a, b) => a + b, 0) / n1
    const mean2 = pnl2.reduce((a, b) => a + b, 0) / n2

    const var1 = pnl1.reduce((sum, p) => sum + (p - mean1) ** 2, 0) / (n1 - 1)
    const var2 = pnl2.reduce((sum, p) => sum + (p - mean2) ** 2, 0) / (n2 - 1)

    // Welch's t-statistic
    const se = Math.sqrt(var1 / n1 + var2 / n2)
    if (se === 0) return 1

    const t = (mean1 - mean2) / se

    // Degrees of freedom (Welch-Satterthwaite)
    const df = ((var1 / n1 + var2 / n2) ** 2) /
               ((var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1))

    // Approximate p-value using normal distribution for large samples
    // For small samples, this is an approximation
    const absT = Math.abs(t)
    const pValue = 2 * (1 - this._normalCDF(absT))

    return Math.max(0, Math.min(1, pValue))
  }

  /**
   * Standard normal CDF approximation
   */
  _normalCDF(x) {
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const sign = x < 0 ? -1 : 1
    x = Math.abs(x) / Math.sqrt(2)

    const t = 1.0 / (1.0 + p * x)
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

    return 0.5 * (1.0 + sign * y)
  }

  /**
   * Get full results summary for UI
   */
  getResults() {
    const activeTest = getActiveABTest()
    const results = this.calculateResults()
    const history = getABTestHistory(5)

    return {
      active: activeTest ? {
        id: activeTest.id,
        name: activeTest.test_name,
        startedAt: activeTest.started_at,
        ...results
      } : null,
      history: history.map(test => ({
        id: test.id,
        name: test.test_name,
        startedAt: test.started_at,
        endedAt: test.ended_at,
        conclusion: test.conclusion,
        controlTrades: test.control_trades,
        treatmentTrades: test.treatment_trades,
        improvement: test.treatment_avg_pnl - test.control_avg_pnl,
        pValue: test.p_value
      }))
    }
  }
}
