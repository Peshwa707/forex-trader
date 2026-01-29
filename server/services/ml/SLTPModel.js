/**
 * SLTPModel - TensorFlow.js Neural Network for SL/TP Optimization
 *
 * Phase B: Real ML Implementation
 *
 * Architecture:
 * Input: 25 features (normalized)
 *   ↓
 * Dense(64, ReLU) → Dropout(0.2)
 *   ↓
 * Dense(32, ReLU) → Dropout(0.2)
 *   ↓
 * Dense(16, ReLU)
 *   ↓
 * Output: 2 values (SL_multiplier, TP_multiplier) with sigmoid activation
 */

import * as tf from '@tensorflow/tfjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = path.join(__dirname, '../../../data/models')

export class SLTPModel {
  constructor() {
    this.model = null
    this.isLoaded = false
    this.inputShape = [25]  // 25 features
    this.outputShape = [2]   // SL multiplier, TP multiplier
  }

  /**
   * Build the neural network architecture
   */
  build() {
    this.model = tf.sequential()

    // Input layer + first hidden layer
    this.model.add(tf.layers.dense({
      inputShape: this.inputShape,
      units: 64,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
    }))
    this.model.add(tf.layers.dropout({ rate: 0.2 }))

    // Second hidden layer
    this.model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
    }))
    this.model.add(tf.layers.dropout({ rate: 0.2 }))

    // Third hidden layer
    this.model.add(tf.layers.dense({
      units: 16,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }))

    // Output layer - sigmoid to output [0, 1] range
    // Will be scaled to [slMin, slMax] and [tpMin, tpMax] after
    this.model.add(tf.layers.dense({
      units: 2,
      activation: 'sigmoid'
    }))

    // Compile with MSE loss (regression task)
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
      metrics: ['mse']
    })

    console.log('[SLTPModel] Model built')
    this.model.summary()

    return this
  }

  /**
   * Train the model on prepared data
   * @param {Object} data - { xTrain, yTrain, xVal, yVal }
   * @param {Object} options - Training options
   * @returns {Object} Training history
   */
  async train(data, options = {}) {
    const {
      epochs = 100,
      batchSize = 32,
      earlyStoppingPatience = 10,
      verbose = 1
    } = options

    if (!this.model) {
      this.build()
    }

    const { xTrain, yTrain, xVal, yVal } = data

    // Convert to tensors
    const xTrainTensor = tf.tensor2d(xTrain)
    const yTrainTensor = tf.tensor2d(yTrain)
    const xValTensor = tf.tensor2d(xVal)
    const yValTensor = tf.tensor2d(yVal)

    // Training with early stopping
    let bestValLoss = Infinity
    let patience = earlyStoppingPatience
    const history = {
      loss: [],
      val_loss: [],
      mse: [],
      val_mse: []
    }

    for (let epoch = 0; epoch < epochs; epoch++) {
      const result = await this.model.fit(xTrainTensor, yTrainTensor, {
        epochs: 1,
        batchSize,
        validationData: [xValTensor, yValTensor],
        verbose: 0
      })

      const loss = result.history.loss[0]
      const valLoss = result.history.val_loss[0]
      const mse = result.history.mse[0]
      const valMse = result.history.val_mse[0]

      history.loss.push(loss)
      history.val_loss.push(valLoss)
      history.mse.push(mse)
      history.val_mse.push(valMse)

      if (verbose) {
        console.log(`Epoch ${epoch + 1}/${epochs} - loss: ${loss.toFixed(4)} - val_loss: ${valLoss.toFixed(4)}`)
      }

      // Early stopping check
      if (valLoss < bestValLoss) {
        bestValLoss = valLoss
        patience = earlyStoppingPatience
      } else {
        patience--
        if (patience <= 0) {
          console.log(`[SLTPModel] Early stopping at epoch ${epoch + 1}`)
          break
        }
      }
    }

    // Cleanup tensors
    xTrainTensor.dispose()
    yTrainTensor.dispose()
    xValTensor.dispose()
    yValTensor.dispose()

    this.isLoaded = true

    return {
      history,
      finalLoss: history.loss[history.loss.length - 1],
      finalValLoss: history.val_loss[history.val_loss.length - 1],
      epochs: history.loss.length
    }
  }

  /**
   * Make predictions
   * @param {number[][]} inputs - Array of feature vectors
   * @returns {number[][]} Array of [slMultiplier, tpMultiplier] predictions
   */
  predict(inputs) {
    if (!this.model || !this.isLoaded) {
      throw new Error('Model not loaded')
    }

    const inputTensor = tf.tensor2d(inputs)
    const outputTensor = this.model.predict(inputTensor)
    const outputs = outputTensor.arraySync()

    inputTensor.dispose()
    outputTensor.dispose()

    return outputs
  }

  /**
   * Predict for a single input
   * @param {number[]} input - Single feature vector
   * @returns {number[]} [slMultiplier, tpMultiplier]
   */
  predictOne(input) {
    const outputs = this.predict([input])
    return outputs[0]
  }

  /**
   * Save model to disk
   * @param {string} version - Model version string
   * @returns {string} Path where model was saved
   */
  async save(version) {
    if (!this.model) {
      throw new Error('No model to save')
    }

    const modelDir = path.join(MODELS_DIR, `sltp_v${version}`)

    // Ensure directory exists
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true })
    }

    const modelPath = `file://${modelDir}`
    await this.model.save(modelPath)

    console.log(`[SLTPModel] Model saved to ${modelDir}`)
    return modelDir
  }

  /**
   * Load model from disk
   * @param {string} modelPath - Path to model directory
   */
  async load(modelPath) {
    try {
      // Handle both file:// prefix and plain paths
      const loadPath = modelPath.startsWith('file://')
        ? modelPath
        : `file://${modelPath}`

      this.model = await tf.loadLayersModel(`${loadPath}/model.json`)

      // Recompile after loading
      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'meanSquaredError',
        metrics: ['mse']
      })

      this.isLoaded = true
      console.log(`[SLTPModel] Model loaded from ${modelPath}`)
    } catch (error) {
      console.error('[SLTPModel] Failed to load model:', error.message)
      throw error
    }
  }

  /**
   * Get model summary as string
   */
  getSummary() {
    if (!this.model) {
      return 'Model not built'
    }

    let summary = []
    this.model.summary(undefined, undefined, (line) => summary.push(line))
    return summary.join('\n')
  }

  /**
   * Dispose of the model to free memory
   */
  dispose() {
    if (this.model) {
      this.model.dispose()
      this.model = null
      this.isLoaded = false
    }
  }
}
