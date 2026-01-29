/**
 * Risk Management Service
 * Monitors P&L, enforces limits, and triggers safety controls
 *
 * Phase A: Trust Foundation - Enhanced with percentage-based limits
 */

import * as db from '../../database.js'
import { executionEngine } from '../execution/ExecutionEngine.js'
import { IB_CONFIG } from '../../config/ib.config.js'

// Risk status levels
export const RiskLevel = {
  NORMAL: 'NORMAL',
  ELEVATED: 'ELEVATED',
  CRITICAL: 'CRITICAL',
  STOPPED: 'STOPPED'
}

// Default risk settings for Phase A Trust Foundation
export const DEFAULT_RISK_SETTINGS = {
  maxDailyLossPercent: 2,      // 2% daily loss limit (conservative)
  maxRiskPerTradePercent: 1,   // 1% risk per trade
  maxConcurrentTrades: 6       // Max 6 open positions
}

/**
 * RiskManager - Real-time risk monitoring and controls
 */
export class RiskManager {
  constructor() {
    this.riskLevel = RiskLevel.NORMAL
    this.dailyPnL = 0
    this.dailyHighWaterMark = 0
    this.dailyLowWaterMark = 0
    this.currentDrawdown = 0
    this.killSwitchTriggered = false
    this.alerts = []
    this.listeners = new Map()
    this.checkInterval = null
    this.lastCheck = null
    this.lastResetDate = null
    this.dailyResetInterval = null
  }

  /**
   * Initialize risk monitoring
   */
  initialize() {
    // Load today's P&L
    this.refreshDailyStats()

    // Check if we need to reset daily stats (new day)
    this.lastResetDate = this.getTodayDateString()
    this.checkDailyReset()

    // Start periodic risk checks (every 10 seconds)
    if (!this.checkInterval) {
      this.checkInterval = setInterval(() => {
        this.performRiskCheck()
      }, 10000)
    }

    // Start daily reset checker (every minute)
    if (!this.dailyResetInterval) {
      this.dailyResetInterval = setInterval(() => {
        this.checkDailyReset()
      }, 60000)
    }

    console.log('RiskManager initialized with Trust Foundation limits')
    return this
  }

  /**
   * Get today's date string for reset tracking
   */
  getTodayDateString() {
    return new Date().toISOString().split('T')[0]
  }

  /**
   * Check and perform daily reset at midnight
   */
  checkDailyReset() {
    const today = this.getTodayDateString()
    if (this.lastResetDate && this.lastResetDate !== today) {
      console.log(`New day detected: ${this.lastResetDate} → ${today}. Resetting daily stats.`)
      this.resetDaily()
      this.lastResetDate = today
    }
  }

  /**
   * Stop risk monitoring
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    if (this.dailyResetInterval) {
      clearInterval(this.dailyResetInterval)
      this.dailyResetInterval = null
    }
  }

  /**
   * Refresh daily statistics from database
   */
  refreshDailyStats() {
    const todaysTrades = db.getTodaysTrades()
    const closedTrades = todaysTrades.filter(t => t.status === 'CLOSED')

    // Calculate daily P&L
    this.dailyPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0)

    // Add unrealized P&L from open trades
    const openTrades = todaysTrades.filter(t => t.status === 'OPEN')
    const unrealizedPnL = openTrades.reduce((sum, t) => sum + (t.pnl || 0), 0)

    const totalDailyPnL = this.dailyPnL + unrealizedPnL

    // Track high/low water marks
    if (totalDailyPnL > this.dailyHighWaterMark) {
      this.dailyHighWaterMark = totalDailyPnL
    }
    if (totalDailyPnL < this.dailyLowWaterMark) {
      this.dailyLowWaterMark = totalDailyPnL
    }

    // Calculate drawdown from high water mark
    if (this.dailyHighWaterMark > 0) {
      this.currentDrawdown = this.dailyHighWaterMark - totalDailyPnL
    }

    return {
      realizedPnL: this.dailyPnL,
      unrealizedPnL,
      totalDailyPnL,
      highWaterMark: this.dailyHighWaterMark,
      lowWaterMark: this.dailyLowWaterMark,
      currentDrawdown: this.currentDrawdown
    }
  }

  /**
   * Get risk settings with Trust Foundation defaults
   */
  getRiskSettings() {
    const settings = db.getAllSettings()
    const mode = db.getSetting('tradingMode') || 'SIMULATION'

    return {
      maxDailyLossPercent: settings.maxDailyLossPercent ?? DEFAULT_RISK_SETTINGS.maxDailyLossPercent,
      maxRiskPerTradePercent: settings.maxRiskPerTradePercent ?? DEFAULT_RISK_SETTINGS.maxRiskPerTradePercent,
      maxConcurrentTrades: settings.maxConcurrentTrades ?? DEFAULT_RISK_SETTINGS.maxConcurrentTrades,
      accountBalance: settings.accountBalance,
      mode
    }
  }

  /**
   * Perform risk check and update status
   */
  performRiskCheck() {
    this.lastCheck = new Date()
    const stats = this.refreshDailyStats()
    const riskSettings = this.getRiskSettings()
    const mode = riskSettings.mode

    // Calculate thresholds using Trust Foundation percentage-based limits
    const accountBalance = riskSettings.accountBalance
    const maxDailyLossPercent = mode === 'LIVE'
      ? IB_CONFIG.riskLimits.maxDailyLossPercent
      : riskSettings.maxDailyLossPercent
    const maxDrawdownPercent = IB_CONFIG.riskLimits.maxDrawdownPercent || 10

    const maxDailyLossAmount = accountBalance * (maxDailyLossPercent / 100)
    const maxDrawdownAmount = accountBalance * (maxDrawdownPercent / 100)

    // Determine risk level
    let newRiskLevel = RiskLevel.NORMAL
    const alerts = []

    // Check daily loss
    const dailyLoss = Math.abs(Math.min(0, stats.totalDailyPnL))
    const dailyLossPercent = (dailyLoss / accountBalance) * 100

    if (dailyLoss >= maxDailyLossAmount) {
      newRiskLevel = RiskLevel.CRITICAL
      alerts.push({
        type: 'DAILY_LOSS_LIMIT',
        severity: 'CRITICAL',
        message: `Daily loss limit reached: $${dailyLoss.toFixed(2)} (${dailyLossPercent.toFixed(1)}%)`,
        value: dailyLoss,
        limit: maxDailyLossAmount
      })
    } else if (dailyLoss >= maxDailyLossAmount * 0.8) {
      newRiskLevel = RiskLevel.ELEVATED
      alerts.push({
        type: 'DAILY_LOSS_WARNING',
        severity: 'WARNING',
        message: `Approaching daily loss limit: $${dailyLoss.toFixed(2)} (${dailyLossPercent.toFixed(1)}%)`,
        value: dailyLoss,
        limit: maxDailyLossAmount
      })
    }

    // Check drawdown
    const drawdownPercent = (this.currentDrawdown / accountBalance) * 100
    if (this.currentDrawdown >= maxDrawdownAmount) {
      if (newRiskLevel !== RiskLevel.CRITICAL) {
        newRiskLevel = RiskLevel.ELEVATED
      }
      alerts.push({
        type: 'DRAWDOWN_WARNING',
        severity: 'WARNING',
        message: `Drawdown alert: $${this.currentDrawdown.toFixed(2)} (${drawdownPercent.toFixed(1)}%)`,
        value: this.currentDrawdown,
        limit: maxDrawdownAmount
      })
    }

    // Check if kill switch should be triggered
    if (newRiskLevel === RiskLevel.CRITICAL && !this.killSwitchTriggered) {
      this.triggerKillSwitch('Daily loss limit exceeded')
      newRiskLevel = RiskLevel.STOPPED
    }

    // Update state
    if (newRiskLevel !== this.riskLevel) {
      this.emit('riskLevelChanged', { oldLevel: this.riskLevel, newLevel: newRiskLevel })
    }

    this.riskLevel = newRiskLevel
    this.alerts = alerts

    // Log alerts
    alerts.forEach(alert => {
      if (alert.severity === 'CRITICAL') {
        db.logActivity('RISK_CRITICAL', alert.message, alert)
      } else if (alert.severity === 'WARNING') {
        db.logActivity('RISK_WARNING', alert.message, alert)
      }
    })

    return {
      riskLevel: this.riskLevel,
      alerts: this.alerts,
      stats,
      limits: {
        maxDailyLoss: maxDailyLossAmount,
        maxDrawdown: maxDrawdownAmount
      }
    }
  }

  /**
   * Trigger kill switch
   */
  async triggerKillSwitch(reason) {
    if (this.killSwitchTriggered) {
      return { alreadyTriggered: true }
    }

    this.killSwitchTriggered = true
    this.riskLevel = RiskLevel.STOPPED

    db.logActivity('KILL_SWITCH_AUTO', `Auto kill switch triggered: ${reason}`, { reason })
    console.error(`🚨 KILL SWITCH TRIGGERED: ${reason}`)

    // Stop the bot
    db.saveSetting('enabled', false)

    // Switch to simulation mode
    try {
      executionEngine.setMode('SIMULATION')
    } catch {
      // May fail if already in simulation
    }

    this.emit('killSwitchTriggered', { reason, timestamp: new Date() })

    return {
      success: true,
      reason,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Reset kill switch (after manual review)
   */
  resetKillSwitch() {
    if (!this.killSwitchTriggered) {
      return { notTriggered: true }
    }

    this.killSwitchTriggered = false
    this.riskLevel = RiskLevel.NORMAL

    db.logActivity('KILL_SWITCH_RESET', 'Kill switch manually reset')
    console.log('Kill switch reset')

    this.emit('killSwitchReset', { timestamp: new Date() })

    return { success: true }
  }

  /**
   * Reset daily statistics (called at day boundary)
   */
  resetDaily() {
    this.dailyPnL = 0
    this.dailyHighWaterMark = 0
    this.dailyLowWaterMark = 0
    this.currentDrawdown = 0
    this.alerts = []

    // Reset kill switch if it was triggered
    if (this.killSwitchTriggered) {
      this.killSwitchTriggered = false
      this.riskLevel = RiskLevel.NORMAL
    }

    db.logActivity('RISK_DAILY_RESET', 'Daily risk statistics reset')
    return { success: true }
  }

  /**
   * Check if trading is allowed based on risk status
   */
  canTrade() {
    if (this.riskLevel === RiskLevel.STOPPED) {
      return { allowed: false, reason: 'Kill switch active' }
    }

    if (this.riskLevel === RiskLevel.CRITICAL) {
      return { allowed: false, reason: 'Critical risk level - daily loss limit reached' }
    }

    return { allowed: true }
  }

  /**
   * Get current risk status
   */
  getStatus() {
    return {
      riskLevel: this.riskLevel,
      killSwitchTriggered: this.killSwitchTriggered,
      dailyPnL: this.dailyPnL,
      currentDrawdown: this.currentDrawdown,
      dailyHighWaterMark: this.dailyHighWaterMark,
      alerts: this.alerts,
      lastCheck: this.lastCheck?.toISOString(),
      canTrade: this.canTrade()
    }
  }

  /**
   * Get detailed risk report
   */
  getReport() {
    const settings = db.getAllSettings()
    const mode = db.getSetting('tradingMode') || 'SIMULATION'
    const stats = this.refreshDailyStats()

    const accountBalance = settings.accountBalance
    const maxDailyLossPercent = mode === 'LIVE'
      ? IB_CONFIG.riskLimits.maxDailyLossPercent
      : settings.maxDailyLoss

    return {
      timestamp: new Date().toISOString(),
      mode,
      accountBalance,
      ...stats,
      dailyLossUsed: Math.abs(Math.min(0, stats.totalDailyPnL)),
      dailyLossLimit: accountBalance * (maxDailyLossPercent / 100),
      dailyLossRemaining: Math.max(0, (accountBalance * (maxDailyLossPercent / 100)) - Math.abs(Math.min(0, stats.totalDailyPnL))),
      riskLevel: this.riskLevel,
      killSwitchTriggered: this.killSwitchTriggered,
      alerts: this.alerts
    }
  }

  /**
   * Get dashboard-friendly risk status for UI
   * Shows visual progress toward limits
   */
  getDashboardStatus() {
    const riskSettings = this.getRiskSettings()
    const stats = this.refreshDailyStats()
    const activeTrades = db.getActiveTrades()

    const accountBalance = riskSettings.accountBalance
    const maxDailyLossPercent = riskSettings.maxDailyLossPercent
    const maxRiskPerTradePercent = riskSettings.maxRiskPerTradePercent
    const maxConcurrentTrades = riskSettings.maxConcurrentTrades

    // Calculate daily loss usage
    const dailyLoss = Math.abs(Math.min(0, stats.totalDailyPnL))
    const dailyLossLimit = accountBalance * (maxDailyLossPercent / 100)
    const dailyLossUsagePercent = dailyLossLimit > 0 ? (dailyLoss / dailyLossLimit) * 100 : 0

    // Calculate per-trade risk (max position value currently at risk)
    const maxTradeRisk = accountBalance * (maxRiskPerTradePercent / 100)
    const currentMaxTradeRisk = activeTrades.reduce((max, trade) => {
      const riskAmount = Math.abs((trade.entry_price - trade.stop_loss) * trade.position_size * 100000)
      return Math.max(max, riskAmount)
    }, 0)
    const tradeRiskUsagePercent = maxTradeRisk > 0 ? (currentMaxTradeRisk / maxTradeRisk) * 100 : 0

    // Calculate concurrent trades usage
    const openTradeCount = activeTrades.length
    const concurrentUsagePercent = maxConcurrentTrades > 0 ? (openTradeCount / maxConcurrentTrades) * 100 : 0

    return {
      timestamp: new Date().toISOString(),

      // Daily P/L limit
      dailyPnL: {
        current: stats.totalDailyPnL,
        limit: dailyLossLimit,
        usagePercent: Math.min(100, dailyLossUsagePercent),
        status: this.getGaugeStatus(dailyLossUsagePercent)
      },

      // Per-trade risk limit
      perTradeRisk: {
        current: currentMaxTradeRisk,
        limit: maxTradeRisk,
        usagePercent: Math.min(100, tradeRiskUsagePercent),
        status: this.getGaugeStatus(tradeRiskUsagePercent)
      },

      // Concurrent trades limit
      openTrades: {
        current: openTradeCount,
        limit: maxConcurrentTrades,
        usagePercent: Math.min(100, concurrentUsagePercent),
        status: this.getGaugeStatus(concurrentUsagePercent)
      },

      // Kill switch status
      killSwitch: {
        armed: !this.killSwitchTriggered,
        triggered: this.killSwitchTriggered,
        triggerCondition: `Auto-stops at -$${dailyLossLimit.toFixed(0)} daily loss`
      },

      // Overall status
      riskLevel: this.riskLevel,
      alerts: this.alerts,
      accountBalance,
      mode: riskSettings.mode
    }
  }

  /**
   * Get gauge status color based on usage percentage
   */
  getGaugeStatus(usagePercent) {
    if (usagePercent >= 80) return 'critical'  // Red
    if (usagePercent >= 50) return 'warning'   // Yellow
    return 'normal'                             // Green
  }

  /**
   * Check if a specific trade size is within risk limits
   */
  validateTradeRisk(positionSize, stopLossPips, pair) {
    const riskSettings = this.getRiskSettings()
    const accountBalance = riskSettings.accountBalance
    const maxRiskPerTradePercent = riskSettings.maxRiskPerTradePercent

    const pipValue = pair.includes('JPY') ? 0.01 : 0.0001
    const riskAmount = Math.abs(stopLossPips * pipValue * positionSize * 100000)
    const maxRisk = accountBalance * (maxRiskPerTradePercent / 100)

    return {
      allowed: riskAmount <= maxRisk,
      riskAmount,
      maxRisk,
      riskPercent: (riskAmount / accountBalance) * 100,
      reason: riskAmount > maxRisk
        ? `Trade risk $${riskAmount.toFixed(2)} exceeds ${maxRiskPerTradePercent}% limit ($${maxRisk.toFixed(2)})`
        : null
    }
  }

  /**
   * Check if we can open another trade based on concurrent limits
   */
  canOpenNewTrade() {
    const riskSettings = this.getRiskSettings()
    const activeTrades = db.getActiveTrades()

    if (activeTrades.length >= riskSettings.maxConcurrentTrades) {
      return {
        allowed: false,
        reason: `Max concurrent trades reached (${activeTrades.length}/${riskSettings.maxConcurrentTrades})`
      }
    }

    return { allowed: true }
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
export const riskManager = new RiskManager()
export default riskManager
