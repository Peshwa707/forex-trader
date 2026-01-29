/**
 * ML Service Entry Point - Phase B: Real ML Implementation
 *
 * Provides ML-optimized SL/TP predictions based on trade history.
 * Starts OFF by default, requires training data before activation.
 */

import { MLDataCollector } from './MLDataCollector.js'
import { SLTPModel } from './SLTPModel.js'
import { FeatureNormalizer } from './FeatureNormalizer.js'
import { MLTrainingPipeline } from './MLTrainingPipeline.js'
import { MLInference } from './MLInference.js'
import { MLConfidenceChecker } from './MLConfidenceChecker.js'
import { MLExplainer } from './MLExplainer.js'
import { ABTestingService } from './ABTestingService.js'
import { getSetting, getMLTrainingDataCount, getActiveMLModel } from '../../database.js'

class MLService {
  constructor() {
    this.isInitialized = false
    this.model = null
    this.normalizer = new FeatureNormalizer()
    this.collector = new MLDataCollector()
    this.inference = null
    this.confidenceChecker = new MLConfidenceChecker()
    this.explainer = new MLExplainer()
    this.abTesting = new ABTestingService()
    this.trainingPipeline = null
  }

  async initialize() {
    if (this.isInitialized) return

    console.log('[ML] Initializing ML Service...')

    // Load normalizer statistics if available
    await this.normalizer.loadStats()

    // Try to load existing model
    const activeModel = getActiveMLModel()
    if (activeModel) {
      try {
        this.model = new SLTPModel()
        await this.model.load(activeModel.model_path)
        this.inference = new MLInference(this.model, this.normalizer, this.confidenceChecker)
        console.log(`[ML] Loaded model v${activeModel.version} (trained on ${activeModel.training_samples} samples)`)
      } catch (error) {
        console.warn('[ML] Failed to load model:', error.message)
        this.model = null
      }
    }

    // Initialize training pipeline
    this.trainingPipeline = new MLTrainingPipeline(this.normalizer)

    this.isInitialized = true
    console.log('[ML] ML Service initialized')
  }

  /**
   * Get ML status for dashboard display
   */
  getStatus() {
    const settings = {
      useMLForSLTP: getSetting('useMLForSLTP'),
      mlConfidenceThreshold: getSetting('mlConfidenceThreshold'),
      minTradesForTraining: getSetting('minTradesForTraining'),
      abTestEnabled: getSetting('abTestEnabled')
    }

    const trainingDataCount = getMLTrainingDataCount()
    const activeModel = getActiveMLModel()
    const activeABTest = this.abTesting.getActiveTest()

    return {
      isInitialized: this.isInitialized,
      modelLoaded: this.model !== null,
      settings,
      trainingDataCount,
      minTradesForTraining: settings.minTradesForTraining,
      readyForTraining: trainingDataCount >= settings.minTradesForTraining,
      activeModel: activeModel ? {
        version: activeModel.version,
        trainedAt: activeModel.trained_at,
        trainingSamples: activeModel.training_samples,
        validationLoss: activeModel.validation_loss,
        backtestImprovement: activeModel.backtest_improvement
      } : null,
      abTest: activeABTest ? {
        id: activeABTest.id,
        name: activeABTest.test_name,
        startedAt: activeABTest.started_at,
        controlTrades: activeABTest.control_trades,
        treatmentTrades: activeABTest.treatment_trades
      } : null
    }
  }

  /**
   * Predict optimal SL/TP multipliers for a trade
   * @param {Object} analysis - Technical analysis results
   * @param {string} direction - 'BUY' or 'SELL'
   * @param {number} confidence - Trade confidence score
   * @returns {Object} Prediction with multipliers and explanation
   */
  async predictSLTP(analysis, direction, confidence) {
    const settings = {
      useMLForSLTP: getSetting('useMLForSLTP'),
      mlConfidenceThreshold: getSetting('mlConfidenceThreshold'),
      abTestEnabled: getSetting('abTestEnabled'),
      abTestSplitRatio: getSetting('abTestSplitRatio')
    }

    // Check if ML is enabled and ready
    if (!settings.useMLForSLTP || !this.model || !this.inference) {
      return {
        useML: false,
        reason: !settings.useMLForSLTP ? 'ML disabled in settings' : 'Model not loaded',
        slMultiplier: 1.5,  // Default
        tpMultiplier: 2.5,  // Default
        abTestGroup: null
      }
    }

    // A/B testing logic
    let abTestGroup = null
    if (settings.abTestEnabled) {
      abTestGroup = this.abTesting.assignGroup(settings.abTestSplitRatio)
      if (abTestGroup === 'CONTROL') {
        return {
          useML: false,
          reason: 'A/B test control group',
          slMultiplier: 1.5,
          tpMultiplier: 2.5,
          abTestGroup: 'CONTROL'
        }
      }
    }

    // Extract features from analysis
    const features = this.collector.extractFeatures(analysis, direction, confidence)

    // Get ML prediction
    const prediction = await this.inference.predict(features)

    // Check if we should use ML or fall back
    if (!prediction.shouldUseML) {
      return {
        useML: false,
        reason: prediction.fallbackReason,
        slMultiplier: 1.5,
        tpMultiplier: 2.5,
        abTestGroup: abTestGroup || null
      }
    }

    // Generate explanation
    const explanation = this.explainer.explain(features, prediction)

    return {
      useML: true,
      slMultiplier: prediction.slMultiplier,
      tpMultiplier: prediction.tpMultiplier,
      confidence: prediction.confidence,
      explanation,
      abTestGroup: abTestGroup || 'TREATMENT',
      features: features  // Include for data collection
    }
  }

  /**
   * Capture trade data for ML training
   * @param {Object} trade - Trade object with entry details
   * @param {Object} analysis - Technical analysis at entry
   * @param {Object} mlPrediction - ML prediction used (if any)
   */
  captureTradeEntry(trade, analysis, mlPrediction) {
    return this.collector.captureEntry(trade, analysis, mlPrediction)
  }

  /**
   * Update training data when trade closes
   * @param {number} tradeId - Trade ID
   * @param {Object} outcome - Trade outcome data
   */
  captureTradeOutcome(tradeId, outcome) {
    return this.collector.captureOutcome(tradeId, outcome)
  }

  /**
   * Update max favorable/adverse excursion during trade
   * @param {number} tradeId - Trade ID
   * @param {number} currentPnlPips - Current P/L in pips
   */
  updateExcursion(tradeId, currentPnlPips) {
    return this.collector.updateExcursion(tradeId, currentPnlPips)
  }

  /**
   * Train or retrain the ML model
   */
  async train() {
    if (!this.trainingPipeline) {
      throw new Error('Training pipeline not initialized')
    }

    const result = await this.trainingPipeline.train()

    if (result.success) {
      // Load the new model
      this.model = result.model
      this.inference = new MLInference(this.model, this.normalizer, this.confidenceChecker)
    }

    return result
  }

  /**
   * Get A/B test results
   */
  getABTestResults() {
    return this.abTesting.getResults()
  }

  /**
   * Start a new A/B test
   */
  startABTest(testName = 'ML vs Rule-Based') {
    return this.abTesting.start(testName)
  }

  /**
   * Stop and conclude the A/B test
   */
  stopABTest() {
    return this.abTesting.stop()
  }
}

// Singleton instance
export const mlService = new MLService()

export {
  MLDataCollector,
  SLTPModel,
  FeatureNormalizer,
  MLTrainingPipeline,
  MLInference,
  MLConfidenceChecker,
  MLExplainer,
  ABTestingService
}
