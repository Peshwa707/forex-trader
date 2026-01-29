/**
 * Risk Management Services - Index
 * Phase 1 Risk Improvements
 *
 * Exports:
 * - RiskManager: Core risk monitoring and kill switch
 * - TrailingStopManager: ATR-based dynamic trailing stops
 * - PositionSizer: Volatility-adjusted position sizing
 * - TimeExitManager: Time-based exit conditions
 */

// Core risk manager
export { RiskManager, riskManager, RiskLevel, DEFAULT_RISK_SETTINGS } from './RiskManager.js'

// Phase 1: ATR Trailing Stops
export {
  TrailingStopManager,
  trailingStopManager,
  TrailingStopAlgorithm,
  DEFAULT_TRAILING_CONFIG
} from './TrailingStopManager.js'

// Phase 1: Volatility Position Sizing
export {
  PositionSizer,
  positionSizer,
  SizingMethod,
  DEFAULT_SIZING_CONFIG
} from './PositionSizer.js'

// Phase 1: Time-Based Exits
export {
  TimeExitManager,
  timeExitManager,
  TimeExitType,
  MarketSession,
  DEFAULT_TIME_EXIT_CONFIG
} from './TimeExitManager.js'

// Import instances for combined status function
import { riskManager as rm } from './RiskManager.js'
import { trailingStopManager as tsm } from './TrailingStopManager.js'
import { positionSizer as ps } from './PositionSizer.js'
import { timeExitManager as tem } from './TimeExitManager.js'

/**
 * Get combined status of all risk services for dashboard
 */
export function getRiskServicesStatus() {
  return {
    riskManager: rm.getStatus(),
    trailingStop: tsm.getStatus(),
    positionSizing: ps.getStatus(),
    timeExits: tem.getStatus()
  }
}

// Default export
export default {
  riskManager: rm,
  trailingStopManager: tsm,
  positionSizer: ps,
  timeExitManager: tem,
  getRiskServicesStatus
}
