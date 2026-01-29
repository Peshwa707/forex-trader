/**
 * Unified Execution Engine
 * Routes trades to appropriate executor based on trading mode
 * Handles graceful degradation from LIVE/PAPER to SIMULATION
 */

import * as db from '../../database.js'
import { ibConnector } from '../ib/IBConnector.js'
import { simulatedExecutor } from './SimulatedExecutor.js'
import { paperExecutor, liveExecutor } from './LiveExecutor.js'
import { IB_CONFIG } from '../../config/ib.config.js'
import { shariahComplianceService } from '../shariah/index.js'

// Risk manager will be set dynamically to avoid circular imports
let riskManagerRef = null

/**
 * Set the risk manager reference
 */
export function setRiskManager(rm) {
  riskManagerRef = rm
}

// Execution modes
export const ExecutionMode = {
  SIMULATION: 'SIMULATION',
  PAPER: 'PAPER',
  LIVE: 'LIVE'
}

/**
 * ExecutionEngine - Unified trade execution across all modes
 */
export class ExecutionEngine {
  constructor() {
    this.currentMode = ExecutionMode.SIMULATION
    this.fallbackMode = ExecutionMode.SIMULATION
    this.fallbackActive = false
    this.listeners = new Map()
  }

  /**
   * Initialize the execution engine
   */
  initialize() {
    // Load saved mode from settings
    const savedMode = db.getSetting('tradingMode')
    if (savedMode && Object.values(ExecutionMode).includes(savedMode)) {
      this.currentMode = savedMode
    }

    // Setup IB connection listener for auto-fallback
    ibConnector.on('disconnected', () => {
      if (this.currentMode !== ExecutionMode.SIMULATION) {
        this.activateFallback('IB connection lost')
      }
    })

    ibConnector.on('connected', () => {
      if (this.fallbackActive && this.currentMode !== ExecutionMode.SIMULATION) {
        this.deactivateFallback()
      }
    })

    console.log(`ExecutionEngine initialized in ${this.currentMode} mode`)
    return this
  }

  /**
   * Get the current executor based on mode and IB status
   */
  getExecutor() {
    // Always use simulation if explicitly in that mode
    if (this.currentMode === ExecutionMode.SIMULATION) {
      return simulatedExecutor
    }

    // Check if IB is connected for PAPER/LIVE modes
    if (!ibConnector.isConnected()) {
      if (!this.fallbackActive) {
        this.activateFallback('IB not connected')
      }
      return simulatedExecutor
    }

    // Use appropriate live executor
    if (this.currentMode === ExecutionMode.PAPER) {
      return paperExecutor
    } else if (this.currentMode === ExecutionMode.LIVE) {
      return liveExecutor
    }

    return simulatedExecutor
  }

  /**
   * Activate fallback to simulation mode
   */
  activateFallback(reason) {
    if (this.fallbackActive) return

    this.fallbackActive = true
    db.logActivity('FALLBACK_ACTIVATED', `Falling back to SIMULATION: ${reason}`, {
      originalMode: this.currentMode,
      reason
    })

    console.warn(`⚠️ Fallback activated: ${reason}. Using SIMULATION mode.`)
    this.emit('fallbackActivated', { originalMode: this.currentMode, reason })
  }

  /**
   * Deactivate fallback (return to original mode)
   */
  deactivateFallback() {
    if (!this.fallbackActive) return

    this.fallbackActive = false
    db.logActivity('FALLBACK_DEACTIVATED', `Returning to ${this.currentMode} mode`)

    console.log(`✅ Fallback deactivated. Returning to ${this.currentMode} mode.`)
    this.emit('fallbackDeactivated', { mode: this.currentMode })
  }

  /**
   * Set execution mode
   */
  setMode(mode) {
    if (!Object.values(ExecutionMode).includes(mode)) {
      throw new Error(`Invalid execution mode: ${mode}`)
    }

    // Validate mode requirements
    if (mode === ExecutionMode.LIVE && !IB_CONFIG.mode.allowLive) {
      throw new Error('Live trading is not enabled')
    }

    if ((mode === ExecutionMode.PAPER || mode === ExecutionMode.LIVE) && !ibConnector.isConnected()) {
      throw new Error('IB connection required for PAPER/LIVE mode')
    }

    const oldMode = this.currentMode
    this.currentMode = mode
    this.fallbackActive = false

    // Save to settings
    db.saveSetting('tradingMode', mode)

    db.logActivity('MODE_CHANGED', `Execution mode changed: ${oldMode} -> ${mode}`)
    console.log(`Execution mode changed: ${oldMode} -> ${mode}`)

    this.emit('modeChanged', { oldMode, newMode: mode })

    return { success: true, mode }
  }

  /**
   * Get current mode and status
   */
  getStatus() {
    const executor = this.getExecutor()
    return {
      mode: this.currentMode,
      activeExecutor: executor.name,
      fallbackActive: this.fallbackActive,
      ibConnected: ibConnector.isConnected(),
      ibStatus: ibConnector.getStatus(),
      liveEnabled: IB_CONFIG.mode.allowLive
    }
  }

  /**
   * Check if we can open a new trade
   */
  canOpenTrade(settings, pair) {
    const activeTrades = db.getActiveTrades()
    const todaysTrades = db.getTodaysTrades()

    // Check max open trades
    if (activeTrades.length >= settings.maxOpenTrades) {
      return { allowed: false, reason: 'Max open trades reached' }
    }

    // Check if already have a trade on this pair
    if (activeTrades.some(t => t.pair === pair)) {
      return { allowed: false, reason: 'Already have trade on this pair' }
    }

    // Check if pair is allowed
    const allowedPairs = Array.isArray(settings.allowedPairs)
      ? settings.allowedPairs
      : JSON.parse(settings.allowedPairs || '[]')

    if (!allowedPairs.includes(pair)) {
      return { allowed: false, reason: 'Pair not in allowed list' }
    }

    // Check daily trade limit
    if (todaysTrades.length >= settings.maxDailyTrades) {
      return { allowed: false, reason: 'Daily trade limit reached' }
    }

    // Check daily loss limit
    const todaysLoss = todaysTrades
      .filter(t => t.status === 'CLOSED' && t.pnl < 0)
      .reduce((sum, t) => sum + Math.abs(t.pnl), 0)

    const maxLossAmount = settings.accountBalance * (settings.maxDailyLoss / 100)
    if (todaysLoss >= maxLossAmount) {
      return { allowed: false, reason: 'Daily loss limit reached' }
    }

    // Check trading hours
    const tradingHours = typeof settings.tradingHours === 'string'
      ? JSON.parse(settings.tradingHours)
      : settings.tradingHours

    if (tradingHours && tradingHours.start !== undefined) {
      const hour = new Date().getUTCHours()
      if (hour < tradingHours.start || hour >= tradingHours.end) {
        return { allowed: false, reason: 'Outside trading hours' }
      }
    }

    return { allowed: true }
  }

  /**
   * Execute a trade through the appropriate executor
   */
  async executeTrade(prediction, settings) {
    // Check risk status first
    if (riskManagerRef) {
      const riskCheck = riskManagerRef.canTrade()
      if (!riskCheck.allowed) {
        return { success: false, reason: `Risk blocked: ${riskCheck.reason}` }
      }
    }

    // Shariah compliance validation (before standard checks)
    if (settings.shariahCompliant) {
      const compliance = shariahComplianceService.validateTrade(prediction, settings)
      if (!compliance.valid) {
        db.logActivity('SHARIAH_TRADE_BLOCKED', `Trade blocked: ${compliance.reason}`, {
          pair: prediction.pair,
          violations: compliance.violations
        })
        return { success: false, reason: `Shariah: ${compliance.reason}`, shariahCompliance: compliance }
      }
    }

    const canOpen = this.canOpenTrade(settings, prediction.pair)
    if (!canOpen.allowed) {
      return { success: false, reason: canOpen.reason }
    }

    const executor = this.getExecutor()

    try {
      const result = await executor.executeTrade(prediction, settings)

      // If live executor indicates fallback, try simulation
      if (result.fallbackToSim) {
        this.activateFallback(result.reason)
        return await simulatedExecutor.executeTrade(prediction, settings)
      }

      return result
    } catch (error) {
      console.error(`Execution error: ${error.message}`)
      db.logActivity('EXECUTION_ERROR', error.message, { pair: prediction.pair })

      // Try fallback on error
      if (this.currentMode !== ExecutionMode.SIMULATION) {
        this.activateFallback(error.message)
        return await simulatedExecutor.executeTrade(prediction, settings)
      }

      return { success: false, reason: error.message }
    }
  }

  /**
   * Close a trade by ID
   */
  async closeTrade(tradeId, exitPrice, reason = 'MANUAL') {
    const executor = this.getExecutor()
    return await executor.closeTrade(tradeId, exitPrice, reason)
  }

  /**
   * Close all active trades
   */
  async closeAllTrades(currentPrices) {
    const executor = this.getExecutor()
    return await executor.closeAllTrades(currentPrices)
  }

  /**
   * Update all active trades with current prices
   */
  async updateAllTrades(currentPrices) {
    const executor = this.getExecutor()
    return await executor.updateAllTrades(currentPrices)
  }

  /**
   * Reset account (simulation only)
   */
  resetAccount(balance = 10000) {
    if (this.currentMode !== ExecutionMode.SIMULATION && !this.fallbackActive) {
      throw new Error('Account reset only available in SIMULATION mode')
    }

    // Close all trades first
    const activeTrades = db.getActiveTrades()
    activeTrades.forEach(trade => {
      db.closeTrade(trade.id, trade.current_price || trade.entry_price, 'RESET', 0, 0)
    })

    db.saveSetting('accountBalance', balance)
    db.logActivity('ACCOUNT_RESET', `Account reset to $${balance}`)

    return db.getAllSettings()
  }

  // Event emitter methods
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add(callback)
    return () => this.off(event, callback)
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.delete(callback)
    }
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in ${event} listener:`, error)
        }
      }
    }
  }
}

// Singleton instance
export const executionEngine = new ExecutionEngine()
export default executionEngine
