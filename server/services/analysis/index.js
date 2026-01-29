/**
 * Analysis Services - Index
 * Phase 2 & 3 Risk Improvements
 *
 * Exports:
 * Phase 2:
 * - RegimeDetector: ADX-based market regime detection
 * - MultiTimeframeAnalyzer: Higher timeframe confirmation
 * - PartialProfitManager: Scale out at profit targets
 *
 * Phase 3:
 * - HurstAnalyzer: Hurst exponent for trending vs mean-reverting detection
 * - OrderFlowAnalyzer: Buy/sell pressure, divergence, liquidity zones
 * - EnsemblePredictor: Combine multiple analysis methods for consensus
 */

// Phase 2: Market Regime Detection
export {
  RegimeDetector,
  regimeDetector,
  MarketRegime,
  RegimeStrategy,
  DEFAULT_REGIME_CONFIG
} from './RegimeDetector.js'

// Phase 2: Multi-Timeframe Analysis
export {
  MultiTimeframeAnalyzer,
  mtfAnalyzer,
  Timeframe,
  DEFAULT_MTF_CONFIG
} from './MultiTimeframeAnalyzer.js'

// Phase 2: Partial Profit Taking
export {
  PartialProfitManager,
  partialProfitManager,
  PartialCloseStrategy,
  DEFAULT_PROFIT_TARGETS,
  DEFAULT_PARTIAL_CONFIG
} from './PartialProfitManager.js'

// Phase 3: Hurst Exponent Analysis
export {
  HurstAnalyzer,
  hurstAnalyzer,
  MarketCharacter,
  CharacterStrategy,
  DEFAULT_HURST_CONFIG
} from './HurstAnalyzer.js'

// Phase 3: Order Flow Analysis
export {
  OrderFlowAnalyzer,
  orderFlowAnalyzer,
  FlowSignal,
  DivergenceType,
  DEFAULT_FLOW_CONFIG
} from './OrderFlowAnalyzer.js'

// Phase 3: Ensemble Prediction
export {
  EnsemblePredictor,
  ensemblePredictor,
  EnsembleMethod,
  DEFAULT_ENSEMBLE_CONFIG
} from './EnsemblePredictor.js'

// Swing Trading: Swing Point Detection
export {
  SwingPointDetector,
  swingPointDetector
} from './SwingPointDetector.js'

// Swing Trading: Fibonacci Analysis
export {
  FibonacciAnalyzer,
  fibonacciAnalyzer,
  FIB_RETRACEMENT_LEVELS,
  FIB_EXTENSION_LEVELS
} from './FibonacciAnalyzer.js'

// Import instances for combined status function
import { regimeDetector as rd } from './RegimeDetector.js'
import { mtfAnalyzer as mtf } from './MultiTimeframeAnalyzer.js'
import { partialProfitManager as ppm } from './PartialProfitManager.js'
import { hurstAnalyzer as hurst } from './HurstAnalyzer.js'
import { orderFlowAnalyzer as flow } from './OrderFlowAnalyzer.js'
import { ensemblePredictor as ensemble } from './EnsemblePredictor.js'
import { swingPointDetector as swingDetector } from './SwingPointDetector.js'
import { fibonacciAnalyzer as fib } from './FibonacciAnalyzer.js'

/**
 * Get combined status of all analysis services for dashboard
 */
export function getAnalysisServicesStatus() {
  return {
    // Phase 2
    regimeDetection: rd.getStatus(),
    multiTimeframe: mtf.getStatus(),
    partialProfits: ppm.getStatus(),
    // Phase 3
    hurstAnalysis: hurst.getStatus(),
    orderFlow: flow.getStatus(),
    ensemble: ensemble.getStatus(),
    // Swing Trading
    swingPoints: swingDetector.getStatus(),
    fibonacci: fib.getStatus()
  }
}

/**
 * Perform full analysis for a trade signal (Phase 2 & 3)
 * @param {string} pair - Currency pair
 * @param {string} direction - 'UP' or 'DOWN'
 * @param {number[]} priceHistory - Price history (newest first)
 * @param {number} baseConfidence - Starting confidence
 * @returns {Object} Complete analysis result
 */
export function analyzeSignal(pair, direction, priceHistory, baseConfidence) {
  // Phase 2: Regime detection
  const regime = rd.detectRegime(pair, priceHistory)

  // Phase 2: Multi-timeframe analysis
  const mtfResult = mtf.analyzeMultipleTimeframes(pair, priceHistory)

  // Phase 3: Hurst exponent analysis
  const hurstResult = hurst.analyzeMarketCharacter(pair, priceHistory)

  // Phase 3: Order flow analysis
  const flowResult = flow.analyzeOrderFlow(pair, priceHistory)

  // Calculate adjusted confidence
  let adjustedConfidence = baseConfidence

  // Apply regime adjustment (Phase 2)
  if (regime.enabled !== false) {
    adjustedConfidence = rd.adjustConfidence(adjustedConfidence, regime, direction)
  }

  // Apply MTF adjustment (Phase 2)
  if (mtfResult.enabled) {
    const mtfCheck = mtf.checkAlignment(pair, direction, priceHistory)
    adjustedConfidence += mtfCheck.confidenceAdjustment
  }

  // Apply Hurst adjustment (Phase 3)
  if (hurstResult.enabled && hurstResult.confidenceAdjustment) {
    adjustedConfidence += hurstResult.confidenceAdjustment
  }

  // Apply order flow adjustment (Phase 3)
  if (flowResult.enabled && flowResult.confidenceAdjustment) {
    adjustedConfidence += flowResult.confidenceAdjustment
  }

  // Clamp confidence
  adjustedConfidence = Math.max(10, Math.min(95, adjustedConfidence))

  // Determine if trade should proceed
  const shouldTrade = regime.shouldTrade?.allowed !== false &&
                     mtfResult.shouldTrade !== false &&
                     hurstResult.shouldTrade !== false

  return {
    pair,
    direction,
    originalConfidence: baseConfidence,
    adjustedConfidence,
    confidenceChange: adjustedConfidence - baseConfidence,
    // Phase 2 results
    regime: {
      type: regime.regime,
      adx: regime.adx,
      trendDirection: regime.trendDirection,
      strategy: regime.strategy?.strategy
    },
    multiTimeframe: {
      direction: mtfResult.overallDirection,
      alignmentScore: mtfResult.alignmentScore,
      aligned: mtfResult.overallDirection === direction || mtfResult.overallDirection === 'NEUTRAL'
    },
    // Phase 3 results
    hurst: {
      value: hurstResult.hurst,
      character: hurstResult.character,
      confidence: hurstResult.confidence
    },
    orderFlow: {
      signal: flowResult.signal,
      buyPressure: flowResult.pressure?.buyPressure,
      divergence: flowResult.divergence?.type
    },
    shouldTrade,
    blockReason: !shouldTrade
      ? (regime.shouldTrade?.reason || mtfResult.reason || hurstResult.blockReason)
      : null
  }
}

/**
 * Run ensemble prediction combining all analysis methods
 * @param {string} pair - Currency pair
 * @param {string} direction - Proposed direction ('UP' or 'DOWN')
 * @param {number[]} priceHistory - Price history (newest first)
 * @param {number} baseConfidence - Starting confidence
 * @returns {Promise<Object>} Ensemble prediction result
 */
export async function getEnsemblePrediction(pair, direction, priceHistory, baseConfidence) {
  return ensemble.predict(pair, priceHistory, direction, baseConfidence)
}

// Default export
export default {
  // Phase 2
  regimeDetector: rd,
  mtfAnalyzer: mtf,
  partialProfitManager: ppm,
  // Phase 3
  hurstAnalyzer: hurst,
  orderFlowAnalyzer: flow,
  ensemblePredictor: ensemble,
  // Swing Trading
  swingPointDetector: swingDetector,
  fibonacciAnalyzer: fib,
  // Functions
  getAnalysisServicesStatus,
  analyzeSignal,
  getEnsemblePrediction
}
