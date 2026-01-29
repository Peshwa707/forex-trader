/**
 * Swing Direction Model
 * Neural network for predicting swing trade direction and magnitude
 *
 * Architecture: 20 inputs → 128 → 64 → 32 → 5 outputs
 * Outputs: [UP_prob, DOWN_prob, NEUTRAL_prob, magnitude_pips, confidence]
 */

import * as tf from '@tensorflow/tfjs'
import { getAllSettings, getSwingTrainingData, getSwingTrainingDataCount } from '../../database.js'
import { swingFeatureExtractor } from './SwingFeatureExtractor.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODEL_DIR = path.join(__dirname, '../../data/models/swing')

class SwingDirectionModel {
  constructor() {
    this.model = null
    this.isLoaded = false
    this.modelVersion = null
    this.inputFeatureCount = swingFeatureExtractor.getFeatureCount() // 20
    this.outputCount = 5 // UP, DOWN, NEUTRAL, magnitude, confidence

    // Normalization parameters (fitted during training)
    this.featureMeans = null
    this.featureStds = null
  }

  /**
   * Initialize the model - load from disk or create new
   */
  async initialize() {
    if (this.isLoaded) return

    try {
      await this.loadModel()
    } catch (error) {
      console.log('[SwingDirectionModel] No saved model found, will need training')
      this.model = null
    }

    this.isLoaded = true
  }

  /**
   * Create a new model architecture
   */
  createModel() {
    const model = tf.sequential()

    // Input layer → Hidden 1 (128 neurons)
    model.add(tf.layers.dense({
      inputShape: [this.inputFeatureCount],
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
    }))
    model.add(tf.layers.batchNormalization())
    model.add(tf.layers.dropout({ rate: 0.3 }))

    // Hidden 2 (64 neurons)
    model.add(tf.layers.dense({
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
    }))
    model.add(tf.layers.batchNormalization())
    model.add(tf.layers.dropout({ rate: 0.2 }))

    // Hidden 3 (32 neurons)
    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }))
    model.add(tf.layers.batchNormalization())

    // Output layer (5 outputs)
    // First 3: direction probabilities (softmax)
    // Last 2: magnitude and confidence (linear)
    model.add(tf.layers.dense({
      units: this.outputCount,
      activation: 'linear' // We'll apply softmax to direction part manually
    }))

    return model
  }

  /**
   * Compile the model with appropriate loss functions
   */
  compileModel(model) {
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError', // Custom loss in training loop
      metrics: ['mse']
    })
    return model
  }

  /**
   * Train the model on swing trading data
   * @param {Object} options - Training options
   * @returns {Object} Training results
   */
  async train(options = {}) {
    const settings = getAllSettings()
    const minSamples = settings.swingMLMinSamples || 500

    // Get training data count
    const dataCount = getSwingTrainingDataCount()
    if (dataCount < minSamples) {
      return {
        success: false,
        reason: `Insufficient training data: ${dataCount}/${minSamples} samples`
      }
    }

    console.log(`[SwingDirectionModel] Starting training with ${dataCount} samples`)

    // Get training data
    const trainingData = getSwingTrainingData(10000) // Get up to 10k samples

    // Prepare features and labels
    const { features, labels } = this.prepareTrainingData(trainingData)

    if (features.length === 0) {
      return {
        success: false,
        reason: 'No valid training samples after preprocessing'
      }
    }

    // Calculate normalization parameters
    this.calculateNormalizationParams(features)

    // Normalize features
    const normalizedFeatures = this.normalizeFeatures(features)

    // Convert to tensors
    const xTensor = tf.tensor2d(normalizedFeatures)
    const yTensor = tf.tensor2d(labels)

    // Create and compile model
    this.model = this.createModel()
    this.compileModel(this.model)

    // Training parameters
    const epochs = options.epochs || 100
    const batchSize = options.batchSize || 32
    const validationSplit = options.validationSplit || 0.2

    // Train
    const history = await this.model.fit(xTensor, yTensor, {
      epochs,
      batchSize,
      validationSplit,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (epoch % 10 === 0) {
            console.log(`[SwingDirectionModel] Epoch ${epoch}: loss=${logs.loss.toFixed(4)}, val_loss=${logs.val_loss?.toFixed(4) || 'N/A'}`)
          }
        }
      }
    })

    // Clean up tensors
    xTensor.dispose()
    yTensor.dispose()

    // Save model
    await this.saveModel()

    const finalLoss = history.history.loss[history.history.loss.length - 1]
    const finalValLoss = history.history.val_loss?.[history.history.val_loss.length - 1]

    console.log(`[SwingDirectionModel] Training complete. Final loss: ${finalLoss.toFixed(4)}`)

    return {
      success: true,
      epochs,
      samples: features.length,
      finalLoss,
      finalValLoss,
      modelVersion: this.modelVersion
    }
  }

  /**
   * Prepare training data from database records
   */
  prepareTrainingData(records) {
    const features = []
    const labels = []

    for (const record of records) {
      // Skip incomplete records
      if (!record.outcome || record.magnitude_pips === null) {
        continue
      }

      // Build feature array
      const featureArray = [
        record.daily_trend || 0,
        record.weekly_trend || 0,
        record.daily_momentum || 0,
        record.htf_alignment || 0,
        (record.days_in_trend || 0) / 30, // Normalize
        record.trend_start_distance || 0,
        (record.adx || 25) / 100, // Normalize
        record.adx_slope || 0,
        record.di_separation || 0,
        record.trend_consistency || 0.5,
        record.hurst_exponent || 0.5,
        record.distance_to_swing_high || 0,
        record.distance_to_swing_low || 0,
        record.swing_range || 0,
        record.price_position_in_swing || 0.5,
        record.hhll_pattern || 0,
        record.nearest_support_distance || 0,
        record.nearest_resistance_distance || 0,
        record.at_support_resistance || 0,
        record.fib_level || 0.5
      ]

      // Build label array [UP_prob, DOWN_prob, NEUTRAL_prob, magnitude, confidence]
      let upProb = 0, downProb = 0, neutralProb = 0
      const magnitude = Math.min(500, Math.abs(record.magnitude_pips || 0)) / 500 // Normalize to 0-1

      if (record.direction_label === 'UP') {
        upProb = 1
      } else if (record.direction_label === 'DOWN') {
        downProb = 1
      } else {
        neutralProb = 1
      }

      // Confidence based on outcome success
      const confidence = record.outcome === 'WIN' ? 0.8 : 0.4

      labels.push([upProb, downProb, neutralProb, magnitude, confidence])
      features.push(featureArray)
    }

    return { features, labels }
  }

  /**
   * Calculate normalization parameters from training data
   */
  calculateNormalizationParams(features) {
    const featureCount = features[0].length
    this.featureMeans = new Array(featureCount).fill(0)
    this.featureStds = new Array(featureCount).fill(1)

    // Calculate means
    for (const sample of features) {
      for (let i = 0; i < featureCount; i++) {
        this.featureMeans[i] += sample[i]
      }
    }
    for (let i = 0; i < featureCount; i++) {
      this.featureMeans[i] /= features.length
    }

    // Calculate standard deviations
    for (const sample of features) {
      for (let i = 0; i < featureCount; i++) {
        this.featureStds[i] += Math.pow(sample[i] - this.featureMeans[i], 2)
      }
    }
    for (let i = 0; i < featureCount; i++) {
      this.featureStds[i] = Math.sqrt(this.featureStds[i] / features.length)
      if (this.featureStds[i] < 0.001) {
        this.featureStds[i] = 1 // Avoid division by zero
      }
    }
  }

  /**
   * Normalize features using z-score normalization
   */
  normalizeFeatures(features) {
    if (!this.featureMeans || !this.featureStds) {
      return features
    }

    return features.map(sample =>
      sample.map((value, i) => (value - this.featureMeans[i]) / this.featureStds[i])
    )
  }

  /**
   * Predict swing direction and magnitude
   * @param {Object} features - Extracted swing features
   * @returns {Object} Prediction with direction, magnitude, confidence
   */
  async predict(features) {
    if (!this.model) {
      return {
        success: false,
        useML: false,
        reason: 'Model not trained'
      }
    }

    try {
      // Convert features to array
      const featureArray = swingFeatureExtractor.featuresToArray(features)

      // Normalize
      const normalized = this.featureMeans
        ? featureArray.map((v, i) => (v - this.featureMeans[i]) / this.featureStds[i])
        : featureArray

      // Create tensor and predict
      const inputTensor = tf.tensor2d([normalized])
      const outputTensor = this.model.predict(inputTensor)
      const output = await outputTensor.data()

      // Clean up
      inputTensor.dispose()
      outputTensor.dispose()

      // Parse output
      const [upProb, downProb, neutralProb, magnitude, confidence] = output

      // Apply softmax to direction probabilities
      const expUp = Math.exp(upProb)
      const expDown = Math.exp(downProb)
      const expNeutral = Math.exp(neutralProb)
      const sumExp = expUp + expDown + expNeutral

      const softmaxUp = expUp / sumExp
      const softmaxDown = expDown / sumExp
      const softmaxNeutral = expNeutral / sumExp

      // Determine direction
      let direction = 'NEUTRAL'
      let directionProbability = softmaxNeutral
      if (softmaxUp > softmaxDown && softmaxUp > softmaxNeutral) {
        direction = 'UP'
        directionProbability = softmaxUp
      } else if (softmaxDown > softmaxUp && softmaxDown > softmaxNeutral) {
        direction = 'DOWN'
        directionProbability = softmaxDown
      }

      // Convert magnitude back to pips
      const magnitudePips = magnitude * 500

      return {
        success: true,
        useML: true,
        direction,
        signal: direction === 'UP' ? 'BUY' : direction === 'DOWN' ? 'SELL' : 'HOLD',
        probabilities: {
          up: softmaxUp,
          down: softmaxDown,
          neutral: softmaxNeutral
        },
        directionProbability,
        magnitudePips: Math.round(magnitudePips),
        confidence: Math.min(1, Math.max(0, confidence)),
        confidencePercent: Math.round(Math.min(1, Math.max(0, confidence)) * 100),
        modelVersion: this.modelVersion
      }
    } catch (error) {
      console.error('[SwingDirectionModel] Prediction error:', error.message)
      return {
        success: false,
        useML: false,
        reason: error.message
      }
    }
  }

  /**
   * Save model to disk
   */
  async saveModel() {
    if (!this.model) return

    // Ensure directory exists
    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true })
    }

    // Generate version
    this.modelVersion = `swing_v${Date.now()}`

    // Save model
    await this.model.save(`file://${MODEL_DIR}`)

    // Save normalization parameters
    const paramsPath = path.join(MODEL_DIR, 'normalization.json')
    fs.writeFileSync(paramsPath, JSON.stringify({
      version: this.modelVersion,
      featureMeans: this.featureMeans,
      featureStds: this.featureStds
    }))

    console.log(`[SwingDirectionModel] Model saved: ${this.modelVersion}`)
  }

  /**
   * Load model from disk
   */
  async loadModel() {
    const modelPath = `file://${MODEL_DIR}/model.json`

    // Check if model exists
    if (!fs.existsSync(path.join(MODEL_DIR, 'model.json'))) {
      throw new Error('No saved model found')
    }

    this.model = await tf.loadLayersModel(modelPath)
    this.compileModel(this.model)

    // Load normalization parameters
    const paramsPath = path.join(MODEL_DIR, 'normalization.json')
    if (fs.existsSync(paramsPath)) {
      const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'))
      this.modelVersion = params.version
      this.featureMeans = params.featureMeans
      this.featureStds = params.featureStds
    }

    console.log(`[SwingDirectionModel] Model loaded: ${this.modelVersion}`)
  }

  /**
   * Get model status
   */
  getStatus() {
    const settings = getAllSettings()
    return {
      enabled: settings.swingMLEnabled,
      isLoaded: this.isLoaded,
      hasModel: !!this.model,
      modelVersion: this.modelVersion,
      inputFeatures: this.inputFeatureCount,
      outputCount: this.outputCount,
      trainingDataCount: getSwingTrainingDataCount(),
      minSamplesRequired: settings.swingMLMinSamples || 500
    }
  }
}

// Singleton instance
export const swingDirectionModel = new SwingDirectionModel()

export default SwingDirectionModel
