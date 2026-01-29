/**
 * FeatureNormalizer - Preprocessing and scaling for ML features
 *
 * Phase B: Real ML Implementation
 * Normalizes 25 input features to [-1, 1] or [0, 1] range for neural network.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getMLTrainingData } from '../../database.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATS_PATH = path.join(__dirname, '../../../data/ml_normalizer_stats.json')

export class FeatureNormalizer {
  constructor() {
    // Feature statistics for normalization
    this.stats = null
    this.isReady = false

    // Feature ranges for clamping (known bounds)
    this.knownBounds = {
      rsi14: { min: 0, max: 100 },
      rsi7: { min: 0, max: 100 },
      stochK: { min: 0, max: 100 },
      bbPosition: { min: 0, max: 1 },
      priceToSma20Ratio: { min: 0.9, max: 1.1 },
      priceToSma50Ratio: { min: 0.85, max: 1.15 },
      trendDirection: { min: -1, max: 1 },
      hourSin: { min: -1, max: 1 },
      hourCos: { min: -1, max: 1 },
      daySin: { min: -1, max: 1 },
      dayCos: { min: -1, max: 1 },
      sessionAsian: { min: 0, max: 1 },
      sessionLondon: { min: 0, max: 1 },
      sessionOverlap: { min: 0, max: 1 },
      sessionNewyork: { min: 0, max: 1 },
      tradeDirection: { min: -1, max: 1 },
      confidenceScore: { min: 0, max: 1 },
      smaCrossSignal: { min: -1, max: 1 },
      emaCrossSignal: { min: -1, max: 1 },
      signalAgreementRatio: { min: 0, max: 1 }
    }

    // Features that need dynamic scaling (learned from data)
    this.dynamicFeatures = [
      'macdHistogram', 'bbWidth', 'atr14', 'atr7', 'recentVolatility'
    ]
  }

  /**
   * Load normalization statistics from file
   */
  async loadStats() {
    try {
      if (fs.existsSync(STATS_PATH)) {
        const data = fs.readFileSync(STATS_PATH, 'utf-8')
        this.stats = JSON.parse(data)
        this.isReady = true
        console.log('[Normalizer] Loaded normalization stats')
        return true
      }
    } catch (error) {
      console.warn('[Normalizer] Failed to load stats:', error.message)
    }

    // Initialize with default stats
    this.stats = this._getDefaultStats()
    this.isReady = true
    return false
  }

  /**
   * Compute statistics from training data
   */
  async computeStats() {
    const data = getMLTrainingData(10000)

    if (data.length < 50) {
      console.warn('[Normalizer] Not enough data to compute stats, using defaults')
      this.stats = this._getDefaultStats()
      this.isReady = true
      return
    }

    const stats = {}

    // For each dynamic feature, compute mean and std
    for (const feature of this.dynamicFeatures) {
      const values = data.map(row => row[this._toSnakeCase(feature)] ?? 0).filter(v => !isNaN(v))

      if (values.length === 0) {
        stats[feature] = { mean: 0, std: 1, min: -1, max: 1 }
        continue
      }

      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
      const std = Math.sqrt(variance) || 1

      // Also track min/max for outlier handling
      const min = Math.min(...values)
      const max = Math.max(...values)

      stats[feature] = { mean, std, min, max }
    }

    this.stats = stats
    this.isReady = true

    // Save stats to file
    this.saveStats()

    console.log('[Normalizer] Computed normalization stats from', data.length, 'samples')
  }

  /**
   * Save normalization statistics to file
   */
  saveStats() {
    try {
      const dir = path.dirname(STATS_PATH)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(STATS_PATH, JSON.stringify(this.stats, null, 2))
    } catch (error) {
      console.error('[Normalizer] Failed to save stats:', error.message)
    }
  }

  /**
   * Normalize a feature array for model input
   * @param {number[]} features - Raw feature array (25 values)
   * @returns {number[]} Normalized feature array
   */
  normalize(features) {
    if (!this.isReady) {
      console.warn('[Normalizer] Stats not loaded, using raw features')
      return features
    }

    const featureNames = [
      'rsi14', 'rsi7', 'macdHistogram', 'bbWidth', 'stochK',
      'atr14', 'atr7', 'priceToSma20Ratio', 'priceToSma50Ratio', 'bbPosition',
      'trendDirection', 'hourSin', 'hourCos', 'daySin', 'dayCos',
      'sessionAsian', 'sessionLondon', 'sessionOverlap', 'sessionNewyork',
      'recentVolatility', 'tradeDirection', 'confidenceScore',
      'smaCrossSignal', 'emaCrossSignal', 'signalAgreementRatio'
    ]

    return features.map((value, i) => {
      const name = featureNames[i]

      // Handle NaN/undefined
      if (value === null || value === undefined || isNaN(value)) {
        return 0
      }

      // Use known bounds for fixed-range features
      if (this.knownBounds[name]) {
        const { min, max } = this.knownBounds[name]
        // Normalize to [0, 1] then shift to [-1, 1] for non-binary features
        const normalized = (value - min) / (max - min)
        if (max === 1 && min === 0) {
          return normalized  // Keep [0, 1] for binary features
        }
        return normalized * 2 - 1  // Scale to [-1, 1]
      }

      // Use z-score normalization for dynamic features
      if (this.stats[name]) {
        const { mean, std } = this.stats[name]
        // Z-score then clip to [-3, 3] then scale to [-1, 1]
        const zscore = (value - mean) / std
        const clipped = Math.max(-3, Math.min(3, zscore))
        return clipped / 3
      }

      // Fallback: return as-is
      return value
    })
  }

  /**
   * Denormalize model output (SL/TP multipliers)
   * @param {number[]} output - Model output [slMultiplier, tpMultiplier]
   * @param {Object} bounds - Bounds from settings
   * @returns {Object} Denormalized multipliers
   */
  denormalizeOutput(output, bounds) {
    const { slMin, slMax, tpMin, tpMax } = bounds

    // Model outputs are in [0, 1] range, scale to actual ranges
    const slMultiplier = output[0] * (slMax - slMin) + slMin
    const tpMultiplier = output[1] * (tpMax - tpMin) + tpMin

    return {
      slMultiplier: Math.max(slMin, Math.min(slMax, slMultiplier)),
      tpMultiplier: Math.max(tpMin, Math.min(tpMax, tpMultiplier))
    }
  }

  /**
   * Check if a feature vector is within training distribution
   * @param {number[]} features - Raw feature array
   * @returns {Object} Distribution check result
   */
  checkDistribution(features) {
    if (!this.isReady || !this.stats) {
      return { inDistribution: true, outliers: [] }
    }

    const featureNames = [
      'rsi14', 'rsi7', 'macdHistogram', 'bbWidth', 'stochK',
      'atr14', 'atr7', 'priceToSma20Ratio', 'priceToSma50Ratio', 'bbPosition',
      'trendDirection', 'hourSin', 'hourCos', 'daySin', 'dayCos',
      'sessionAsian', 'sessionLondon', 'sessionOverlap', 'sessionNewyork',
      'recentVolatility', 'tradeDirection', 'confidenceScore',
      'smaCrossSignal', 'emaCrossSignal', 'signalAgreementRatio'
    ]

    const outliers = []

    features.forEach((value, i) => {
      const name = featureNames[i]

      // Check dynamic features for outliers
      if (this.stats[name]) {
        const { mean, std, min, max } = this.stats[name]
        const zscore = Math.abs((value - mean) / std)

        // Flag if > 4 standard deviations from mean
        if (zscore > 4) {
          outliers.push({
            feature: name,
            value,
            zscore,
            expected: { mean, std, min, max }
          })
        }
      }
    })

    return {
      inDistribution: outliers.length === 0,
      outliers,
      outlierCount: outliers.length
    }
  }

  /**
   * Get default statistics for initialization
   */
  _getDefaultStats() {
    return {
      macdHistogram: { mean: 0, std: 0.001, min: -0.01, max: 0.01 },
      bbWidth: { mean: 0.02, std: 0.01, min: 0.005, max: 0.1 },
      atr14: { mean: 0.001, std: 0.0005, min: 0.0002, max: 0.005 },
      atr7: { mean: 0.001, std: 0.0005, min: 0.0002, max: 0.005 },
      recentVolatility: { mean: 0.001, std: 0.0005, min: 0.0002, max: 0.005 }
    }
  }

  /**
   * Convert camelCase to snake_case
   */
  _toSnakeCase(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase()
  }
}
