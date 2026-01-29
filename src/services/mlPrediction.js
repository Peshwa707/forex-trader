/**
 * Machine Learning Price Prediction using TensorFlow.js
 * Uses neural network for time series forecasting
 */

import * as tf from '@tensorflow/tfjs'
import { calculateRSI, calculateMACD, calculateSMA, calculateBollingerBands } from './technicalAnalysis'

// Model storage
let model = null
let isTraining = false
let trainingProgress = 0
let trainingLock = null // Mutex-like lock to prevent concurrent training

// Prepare features from price data
function prepareFeatures(prices, sequenceLength = 30) {
  if (prices.length < sequenceLength + 50) {
    return null
  }

  // Calculate technical indicators
  const rsi = calculateRSI(prices, 14)
  const macd = calculateMACD(prices)
  const sma20 = calculateSMA(prices, 20)
  const sma50 = calculateSMA(prices, 50)
  const bb = calculateBollingerBands(prices, 20)

  // Normalize price returns instead of absolute prices
  const returns = []
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
  }

  // Align all indicators to same length
  const minLength = Math.min(
    returns.length,
    rsi.length,
    macd.histogram.length,
    sma20.length - 30,
    sma50.length,
    bb.middle.length
  )

  const features = []
  const offset = prices.length - minLength - 1

  for (let i = 0; i < minLength; i++) {
    const priceIdx = offset + i + 1
    const rsiIdx = i
    const macdIdx = i
    const smaIdx = i + 30 // SMA offset

    features.push([
      returns[offset + i] * 100, // Price return scaled
      (rsi[rsiIdx] || 50) / 100, // RSI normalized
      (macd.histogram[macdIdx] || 0) * 1000, // MACD scaled
      prices[priceIdx] > (sma20[smaIdx] || prices[priceIdx]) ? 1 : 0, // Above SMA20
      prices[priceIdx] > (sma50[smaIdx - 30] || prices[priceIdx]) ? 1 : 0, // Above SMA50
    ])
  }

  return features
}

// Build the neural network model
function buildModel(inputShape) {
  const model = tf.sequential()

  // Input layer with LSTM-like dense layers
  model.add(tf.layers.dense({
    units: 128,
    activation: 'relu',
    inputShape: inputShape,
    kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
  }))

  model.add(tf.layers.dropout({ rate: 0.2 }))

  model.add(tf.layers.dense({
    units: 64,
    activation: 'relu',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
  }))

  model.add(tf.layers.dropout({ rate: 0.2 }))

  model.add(tf.layers.dense({
    units: 32,
    activation: 'relu'
  }))

  // Output layer - predicts direction probability
  model.add(tf.layers.dense({
    units: 3, // [DOWN, NEUTRAL, UP]
    activation: 'softmax'
  }))

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  })

  return model
}

// Train the model on historical data
export async function trainModel(priceHistory, onProgress = () => {}) {
  // Use mutex-like lock to prevent concurrent training (race condition fix)
  if (trainingLock) {
    return { success: false, message: 'Training already in progress' }
  }

  // Create lock synchronously before any async operation
  trainingLock = Date.now()
  const ourLock = trainingLock

  // Double-check pattern: verify we still hold the lock
  await new Promise(resolve => setTimeout(resolve, 0))
  if (trainingLock !== ourLock) {
    return { success: false, message: 'Training already in progress' }
  }

  isTraining = true
  trainingProgress = 0

  try {
    const features = prepareFeatures(priceHistory)
    if (!features || features.length < 100) {
      throw new Error('Insufficient data for training')
    }

    // Prepare training data
    const sequenceLength = 10
    const X = []
    const y = []

    for (let i = sequenceLength; i < features.length - 1; i++) {
      // Flatten sequence of features
      const sequence = features.slice(i - sequenceLength, i).flat()
      X.push(sequence)

      // Target is next period's return direction
      const nextReturn = features[i][0] // Price return
      if (nextReturn < -0.05) y.push([1, 0, 0]) // DOWN
      else if (nextReturn > 0.05) y.push([0, 0, 1]) // UP
      else y.push([0, 1, 0]) // NEUTRAL
    }

    const inputShape = [X[0].length]

    // Build model
    model = buildModel(inputShape)

    // Convert to tensors
    const xTensor = tf.tensor2d(X)
    const yTensor = tf.tensor2d(y)

    // Train
    const epochs = 50
    const batchSize = 32

    await model.fit(xTensor, yTensor, {
      epochs,
      batchSize,
      validationSplit: 0.2,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          trainingProgress = ((epoch + 1) / epochs) * 100
          onProgress({
            epoch: epoch + 1,
            totalEpochs: epochs,
            loss: logs.loss,
            accuracy: logs.acc,
            valLoss: logs.val_loss,
            valAccuracy: logs.val_acc,
            progress: trainingProgress
          })
        }
      }
    })

    // Cleanup tensors
    xTensor.dispose()
    yTensor.dispose()

    isTraining = false
    trainingLock = null // Release lock
    return {
      success: true,
      message: 'Model trained successfully',
      accuracy: trainingProgress
    }
  } catch (error) {
    isTraining = false
    trainingLock = null // Release lock on error
    console.error('Training error:', error)
    return { success: false, message: error.message }
  }
}

// Make prediction using trained model
export async function predict(priceHistory) {
  if (!model) {
    // Return heuristic-based prediction if no model
    return heuristicPrediction(priceHistory)
  }

  try {
    const features = prepareFeatures(priceHistory)
    if (!features || features.length < 10) {
      return heuristicPrediction(priceHistory)
    }

    // Get last sequence
    const sequenceLength = 10
    const lastSequence = features.slice(-sequenceLength).flat()

    const inputTensor = tf.tensor2d([lastSequence])
    const prediction = model.predict(inputTensor)
    const probabilities = await prediction.data()

    inputTensor.dispose()
    prediction.dispose()

    const [downProb, neutralProb, upProb] = probabilities

    let direction = 'NEUTRAL'
    let confidence = neutralProb * 100

    if (upProb > downProb && upProb > neutralProb) {
      direction = 'UP'
      confidence = upProb * 100
    } else if (downProb > upProb && downProb > neutralProb) {
      direction = 'DOWN'
      confidence = downProb * 100
    }

    return {
      direction,
      confidence: Math.round(confidence),
      probabilities: {
        up: Math.round(upProb * 100),
        neutral: Math.round(neutralProb * 100),
        down: Math.round(downProb * 100)
      },
      signal: direction === 'UP' ? 'BUY' : direction === 'DOWN' ? 'SELL' : 'HOLD',
      source: 'ML Model'
    }
  } catch (error) {
    console.error('Prediction error:', error)
    return heuristicPrediction(priceHistory)
  }
}

// Heuristic-based prediction when no ML model
function heuristicPrediction(prices) {
  if (prices.length < 50) {
    return {
      direction: 'NEUTRAL',
      confidence: 50,
      probabilities: { up: 33, neutral: 34, down: 33 },
      signal: 'HOLD',
      source: 'Insufficient Data'
    }
  }

  // Calculate indicators
  const rsi = calculateRSI(prices, 14)
  const macd = calculateMACD(prices)
  const sma20 = calculateSMA(prices, 20)
  const sma50 = calculateSMA(prices, 50)

  const currentPrice = prices[prices.length - 1]
  const currentRSI = rsi[rsi.length - 1] || 50
  const currentMACD = macd.histogram[macd.histogram.length - 1] || 0
  const currentSMA20 = sma20[sma20.length - 1] || currentPrice
  const currentSMA50 = sma50[sma50.length - 1] || currentPrice

  let bullScore = 0
  let bearScore = 0

  // RSI signals
  if (currentRSI < 30) bullScore += 25
  else if (currentRSI < 40) bullScore += 10
  else if (currentRSI > 70) bearScore += 25
  else if (currentRSI > 60) bearScore += 10

  // MACD signals
  if (currentMACD > 0) bullScore += 20
  else bearScore += 20

  // Moving average signals
  if (currentPrice > currentSMA20) bullScore += 15
  else bearScore += 15

  if (currentPrice > currentSMA50) bullScore += 15
  else bearScore += 15

  // Trend momentum
  const recentReturns = []
  for (let i = Math.max(0, prices.length - 5); i < prices.length; i++) {
    if (i > 0) recentReturns.push((prices[i] - prices[i - 1]) / prices[i - 1])
  }
  const avgReturn = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length

  if (avgReturn > 0.001) bullScore += 15
  else if (avgReturn < -0.001) bearScore += 15

  const totalScore = bullScore + bearScore
  const neutralScore = Math.max(0, 100 - totalScore)

  let direction = 'NEUTRAL'
  let confidence = 50

  if (bullScore > bearScore + 15) {
    direction = 'UP'
    confidence = Math.min(85, 50 + (bullScore - bearScore))
  } else if (bearScore > bullScore + 15) {
    direction = 'DOWN'
    confidence = Math.min(85, 50 + (bearScore - bullScore))
  }

  return {
    direction,
    confidence: Math.round(confidence),
    probabilities: {
      up: Math.round((bullScore / totalScore) * 100) || 33,
      neutral: Math.round(neutralScore) || 34,
      down: Math.round((bearScore / totalScore) * 100) || 33
    },
    signal: direction === 'UP' ? 'BUY' : direction === 'DOWN' ? 'SELL' : 'HOLD',
    source: 'Technical Analysis',
    indicators: {
      rsi: Math.round(currentRSI),
      macd: currentMACD > 0 ? 'Bullish' : 'Bearish',
      trend: avgReturn > 0 ? 'Up' : avgReturn < 0 ? 'Down' : 'Flat'
    }
  }
}

// Get model status
export function getModelStatus() {
  return {
    trained: model !== null,
    isTraining,
    progress: trainingProgress
  }
}

// Generate simulated historical data for training
export function generateHistoricalData(basePrice = 1.0850, days = 365) {
  const data = [basePrice]
  let price = basePrice

  for (let i = 1; i < days * 24; i++) { // Hourly data
    // Random walk with mean reversion
    const trend = (Math.random() - 0.5) * 0.001
    const meanReversion = (basePrice - price) * 0.001
    const volatility = (Math.random() - 0.5) * 0.002

    price = price * (1 + trend + meanReversion + volatility)
    data.push(price)
  }

  return data
}

// Analyze pair and return full analysis
export async function analyzePair(priceHistory, pair) {
  const prediction = await predict(priceHistory)

  // Calculate additional metrics
  const rsi = calculateRSI(priceHistory, 14)
  const macd = calculateMACD(priceHistory)
  const bb = calculateBollingerBands(priceHistory, 20)
  const sma20 = calculateSMA(priceHistory, 20)
  const sma50 = calculateSMA(priceHistory, 50)

  const currentPrice = priceHistory[priceHistory.length - 1]
  const currentBBUpper = bb.upper[bb.upper.length - 1]
  const currentBBLower = bb.lower[bb.lower.length - 1]
  const bbPosition = (currentPrice - currentBBLower) / (currentBBUpper - currentBBLower)

  return {
    pair,
    prediction,
    indicators: {
      rsi: Math.round(rsi[rsi.length - 1] || 50),
      macdHistogram: macd.histogram[macd.histogram.length - 1]?.toFixed(5) || '0',
      macdSignal: macd.histogram[macd.histogram.length - 1] > 0 ? 'Bullish' : 'Bearish',
      sma20: sma20[sma20.length - 1]?.toFixed(5) || currentPrice,
      sma50: sma50[sma50.length - 1]?.toFixed(5) || currentPrice,
      bbPosition: Math.round(bbPosition * 100),
      trend: currentPrice > sma20[sma20.length - 1] ? 'Bullish' : 'Bearish'
    },
    support: currentBBLower?.toFixed(5),
    resistance: currentBBUpper?.toFixed(5),
    currentPrice: currentPrice?.toFixed(5)
  }
}
