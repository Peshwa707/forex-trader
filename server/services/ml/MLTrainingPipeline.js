/**
 * MLTrainingPipeline - Training orchestration for SL/TP model
 *
 * Phase B: Real ML Implementation
 *
 * Handles:
 * - Data preparation from ml_training_data table
 * - Train/validation split
 * - Feature normalization
 * - Model training
 * - Model evaluation and saving
 */

import { SLTPModel } from './SLTPModel.js'
import {
  getMLTrainingData,
  getMLTrainingDataCount,
  saveMLModel,
  getSetting
} from '../../database.js'

export class MLTrainingPipeline {
  constructor(normalizer) {
    this.normalizer = normalizer
    this.model = null
  }

  /**
   * Prepare training data from database
   * @returns {Object} Prepared train/validation data
   */
  async prepareData() {
    const rawData = getMLTrainingData(10000)

    if (rawData.length < 50) {
      throw new Error(`Not enough training data: ${rawData.length} samples (need at least 50)`)
    }

    console.log(`[Training] Preparing ${rawData.length} training samples`)

    // Filter out incomplete records
    const validData = rawData.filter(row =>
      row.pnl_pips !== null &&
      row.max_favorable_excursion !== null &&
      row.max_adverse_excursion !== null
    )

    if (validData.length < 50) {
      throw new Error(`Not enough valid training data: ${validData.length} samples after filtering`)
    }

    // Extract features and labels
    const features = validData.map(row => this._extractFeaturesFromRow(row))
    const labels = validData.map(row => this._extractLabelsFromRow(row))

    // Compute normalization stats
    await this.normalizer.computeStats()

    // Normalize features
    const normalizedFeatures = features.map(f => this.normalizer.normalize(f))

    // Shuffle data
    const indices = [...Array(normalizedFeatures.length).keys()]
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]]
    }

    const shuffledFeatures = indices.map(i => normalizedFeatures[i])
    const shuffledLabels = indices.map(i => labels[i])

    // Train/validation split (80/20)
    const splitIdx = Math.floor(shuffledFeatures.length * 0.8)

    return {
      xTrain: shuffledFeatures.slice(0, splitIdx),
      yTrain: shuffledLabels.slice(0, splitIdx),
      xVal: shuffledFeatures.slice(splitIdx),
      yVal: shuffledLabels.slice(splitIdx),
      totalSamples: validData.length,
      trainSamples: splitIdx,
      valSamples: shuffledFeatures.length - splitIdx
    }
  }

  /**
   * Extract feature array from database row
   */
  _extractFeaturesFromRow(row) {
    return [
      row.rsi_14 ?? 50,
      row.rsi_7 ?? 50,
      row.macd_histogram ?? 0,
      row.bb_width ?? 0.02,
      row.stoch_k ?? 50,
      row.atr_14 ?? 0.001,
      row.atr_7 ?? 0.001,
      row.price_to_sma20_ratio ?? 1,
      row.price_to_sma50_ratio ?? 1,
      row.bb_position ?? 0.5,
      row.trend_direction ?? 0,
      row.hour_sin ?? 0,
      row.hour_cos ?? 1,
      row.day_sin ?? 0,
      row.day_cos ?? 1,
      row.session_asian ?? 0,
      row.session_london ?? 0,
      row.session_overlap ?? 0,
      row.session_newyork ?? 0,
      row.recent_volatility ?? 0.001,
      row.trade_direction ?? 1,
      row.confidence_score ?? 0.5,
      row.sma_cross_signal ?? 0,
      row.ema_cross_signal ?? 0,
      row.signal_agreement_ratio ?? 0.5
    ]
  }

  /**
   * Extract label (optimal SL/TP multipliers) from database row
   * Normalized to [0, 1] range for model output
   */
  _extractLabelsFromRow(row) {
    const settings = {
      slMin: getSetting('slMultiplierMin') ?? 0.5,
      slMax: getSetting('slMultiplierMax') ?? 3.0,
      tpMin: getSetting('tpMultiplierMin') ?? 1.0,
      tpMax: getSetting('tpMultiplierMax') ?? 5.0
    }

    // Calculate optimal multipliers from excursions
    // If trade was profitable, optimal TP was the max favorable excursion
    // If trade was losing, optimal SL was just past the max adverse excursion
    const atr = row.atr_14 ?? 0.001

    // Calculate what optimal would have been based on outcome
    let optimalSl, optimalTp

    if (row.pnl_pips > 0) {
      // Winner: optimal TP could have been the max favorable excursion
      // SL was good enough (trade won)
      optimalSl = row.sl_multiplier_used
      optimalTp = Math.max(row.max_favorable_excursion / (atr * 10000), row.tp_multiplier_used)
    } else {
      // Loser: SL might have been too tight or TP too ambitious
      optimalSl = Math.max(Math.abs(row.max_adverse_excursion) / (atr * 10000) + 0.2, row.sl_multiplier_used)
      optimalTp = row.tp_multiplier_used
    }

    // Clamp to valid ranges
    optimalSl = Math.max(settings.slMin, Math.min(settings.slMax, optimalSl))
    optimalTp = Math.max(settings.tpMin, Math.min(settings.tpMax, optimalTp))

    // Normalize to [0, 1] for model output
    const slNormalized = (optimalSl - settings.slMin) / (settings.slMax - settings.slMin)
    const tpNormalized = (optimalTp - settings.tpMin) / (settings.tpMax - settings.tpMin)

    return [slNormalized, tpNormalized]
  }

  /**
   * Train the model
   * @param {Object} options - Training options
   * @returns {Object} Training results
   */
  async train(options = {}) {
    const {
      epochs = 100,
      batchSize = 32,
      earlyStoppingPatience = 10
    } = options

    console.log('[Training] Starting model training...')

    // Check minimum data requirement
    const dataCount = getMLTrainingDataCount()
    const minRequired = getSetting('minTradesForTraining') ?? 200

    if (dataCount < minRequired) {
      return {
        success: false,
        error: `Not enough training data: ${dataCount}/${minRequired} required`,
        dataCount
      }
    }

    // Prepare data
    let data
    try {
      data = await this.prepareData()
    } catch (error) {
      return {
        success: false,
        error: error.message,
        dataCount
      }
    }

    console.log(`[Training] Training on ${data.trainSamples} samples, validating on ${data.valSamples}`)

    // Build and train model
    this.model = new SLTPModel()
    this.model.build()

    const trainResult = await this.model.train(data, {
      epochs,
      batchSize,
      earlyStoppingPatience,
      verbose: 1
    })

    // Generate version string
    const version = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const versionFull = `${version}_${data.totalSamples}`

    // Save model
    const modelPath = await this.model.save(versionFull)

    // Run quick backtest evaluation
    const backtestResult = await this._evaluateModel(data)

    // Save model metadata to database
    const modelId = saveMLModel({
      version: versionFull,
      trainingSamples: data.totalSamples,
      validationLoss: trainResult.finalValLoss,
      trainingLoss: trainResult.finalLoss,
      backtestImprovement: backtestResult.improvement,
      modelPath,
      config: { epochs: trainResult.epochs, batchSize }
    })

    console.log(`[Training] Model v${versionFull} trained and saved (validation loss: ${trainResult.finalValLoss.toFixed(4)})`)

    return {
      success: true,
      model: this.model,
      version: versionFull,
      modelId,
      modelPath,
      trainingSamples: data.totalSamples,
      trainingLoss: trainResult.finalLoss,
      validationLoss: trainResult.finalValLoss,
      epochs: trainResult.epochs,
      backtestImprovement: backtestResult.improvement,
      history: trainResult.history
    }
  }

  /**
   * Evaluate model against rule-based approach
   */
  async _evaluateModel(data) {
    const settings = {
      slMin: getSetting('slMultiplierMin') ?? 0.5,
      slMax: getSetting('slMultiplierMax') ?? 3.0,
      tpMin: getSetting('tpMultiplierMin') ?? 1.0,
      tpMax: getSetting('tpMultiplierMax') ?? 5.0
    }

    // Get predictions on validation set
    const predictions = this.model.predict(data.xVal)

    // Calculate MSE for ML predictions vs actual labels
    let mlMse = 0
    for (let i = 0; i < predictions.length; i++) {
      mlMse += (predictions[i][0] - data.yVal[i][0]) ** 2
      mlMse += (predictions[i][1] - data.yVal[i][1]) ** 2
    }
    mlMse /= (predictions.length * 2)

    // Calculate MSE for rule-based (1.5x SL, 2.5x TP)
    const ruleBasedSl = (1.5 - settings.slMin) / (settings.slMax - settings.slMin)
    const ruleBasedTp = (2.5 - settings.tpMin) / (settings.tpMax - settings.tpMin)

    let ruleBasedMse = 0
    for (let i = 0; i < data.yVal.length; i++) {
      ruleBasedMse += (ruleBasedSl - data.yVal[i][0]) ** 2
      ruleBasedMse += (ruleBasedTp - data.yVal[i][1]) ** 2
    }
    ruleBasedMse /= (data.yVal.length * 2)

    // Calculate improvement percentage
    const improvement = ((ruleBasedMse - mlMse) / ruleBasedMse) * 100

    console.log(`[Training] Backtest - ML MSE: ${mlMse.toFixed(4)}, Rule-based MSE: ${ruleBasedMse.toFixed(4)}, Improvement: ${improvement.toFixed(1)}%`)

    return {
      mlMse,
      ruleBasedMse,
      improvement
    }
  }

  /**
   * Check if retraining is needed
   */
  shouldRetrain() {
    const settings = {
      autoRetrainEnabled: getSetting('autoRetrainEnabled'),
      retrainIntervalDays: getSetting('retrainIntervalDays') ?? 7,
      minTradesForTraining: getSetting('minTradesForTraining') ?? 200
    }

    if (!settings.autoRetrainEnabled) {
      return { shouldRetrain: false, reason: 'Auto-retrain disabled' }
    }

    const dataCount = getMLTrainingDataCount()
    if (dataCount < settings.minTradesForTraining) {
      return { shouldRetrain: false, reason: `Not enough data (${dataCount}/${settings.minTradesForTraining})` }
    }

    // TODO: Check last training date and compare to retrainIntervalDays

    return { shouldRetrain: true, reason: 'Ready for training' }
  }
}
