/**
 * Swing Trading Services Index
 * Exports all swing trading related services
 */

export {
  SwingStrategyEngine,
  swingStrategyEngine,
  SwingStrategy
} from './SwingStrategyEngine.js'

export {
  SwingExitManager,
  swingExitManager
} from './SwingExitManager.js'

// Re-export from analysis for convenience
export {
  swingPointDetector,
  fibonacciAnalyzer
} from '../analysis/index.js'

// Combined status function
import { swingStrategyEngine as strategy } from './SwingStrategyEngine.js'
import { swingExitManager as exits } from './SwingExitManager.js'
import { swingPointDetector, fibonacciAnalyzer } from '../analysis/index.js'

export function getSwingTradingStatus() {
  return {
    strategy: strategy.getStatus(),
    exits: exits.getStatus(),
    swingPoints: swingPointDetector.getStatus(),
    fibonacci: fibonacciAnalyzer.getStatus()
  }
}

export default {
  swingStrategyEngine: strategy,
  swingExitManager: exits,
  swingPointDetector,
  fibonacciAnalyzer,
  getSwingTradingStatus
}
