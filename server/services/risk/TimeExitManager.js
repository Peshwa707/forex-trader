/**
 * Time-Based Exit Manager
 * Phase 1 Risk Improvement: Close positions based on time conditions
 *
 * Implements:
 * - Weekend exit (close before Friday market close)
 * - Session-based exits (close at end of preferred session)
 * - Maximum hold time exits
 * - News event protection (optional)
 */

import * as db from '../../database.js'

// Time exit types
export const TimeExitType = {
  WEEKEND: 'WEEKEND',           // Close before weekend
  SESSION_END: 'SESSION_END',   // Close at session end
  MAX_HOLD: 'MAX_HOLD',         // Max holding time exceeded
  NEWS_EVENT: 'NEWS_EVENT',     // Before high-impact news
  SHARIAH_SWAP: 'SHARIAH_SWAP'  // Before swap time (handled separately)
}

// Market sessions (UTC hours)
export const MarketSession = {
  SYDNEY: { name: 'Sydney', open: 21, close: 6 },
  TOKYO: { name: 'Tokyo', open: 0, close: 9 },
  LONDON: { name: 'London', open: 7, close: 16 },
  NEW_YORK: { name: 'New York', open: 12, close: 21 }
}

// Default configuration
export const DEFAULT_TIME_EXIT_CONFIG = {
  weekendExitEnabled: true,
  weekendExitDay: 5,              // Friday (0=Sunday)
  weekendExitHourUTC: 20,         // 8pm UTC (4pm EST before close)
  sessionExitEnabled: false,
  preferredSession: 'NEW_YORK',
  maxHoldHours: 72,               // Max 3 days hold
  maxHoldEnabled: false,
  newsExitEnabled: false,
  newsExitMinutesBefore: 30,
  enabled: true
}

/**
 * TimeExitManager - Handles time-based trade exits
 */
export class TimeExitManager {
  constructor() {
    this.config = { ...DEFAULT_TIME_EXIT_CONFIG }
    this.upcomingNews = []
  }

  /**
   * Configure with custom settings
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_TIME_EXIT_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      weekendExitEnabled: settings.weekendExitEnabled !== undefined
        ? settings.weekendExitEnabled
        : this.config.weekendExitEnabled,
      weekendExitDay: settings.weekendExitDay || this.config.weekendExitDay,
      weekendExitHourUTC: settings.weekendExitHourUTC || this.config.weekendExitHourUTC,
      sessionExitEnabled: settings.sessionExitEnabled || this.config.sessionExitEnabled,
      preferredSession: settings.preferredSession || this.config.preferredSession,
      maxHoldHours: settings.maxHoldHours || this.config.maxHoldHours,
      maxHoldEnabled: settings.maxHoldEnabled || this.config.maxHoldEnabled,
      newsExitEnabled: settings.newsExitEnabled || this.config.newsExitEnabled,
      newsExitMinutesBefore: settings.newsExitMinutesBefore || this.config.newsExitMinutesBefore,
      enabled: settings.timeExitsEnabled !== undefined ? settings.timeExitsEnabled : this.config.enabled
    }
  }

  /**
   * Check if any time-based exit conditions are met
   * @returns {Object} { shouldExit, type, reason, urgency }
   */
  checkTimeExits() {
    const config = this.getConfig()

    if (!config.enabled) {
      return { shouldExit: false, reason: 'Time exits disabled' }
    }

    const now = new Date()
    const results = []

    // Check weekend exit
    if (config.weekendExitEnabled) {
      const weekendCheck = this.checkWeekendExit(now, config)
      if (weekendCheck.shouldExit) {
        results.push(weekendCheck)
      }
    }

    // Check session exit
    if (config.sessionExitEnabled) {
      const sessionCheck = this.checkSessionExit(now, config)
      if (sessionCheck.shouldExit) {
        results.push(sessionCheck)
      }
    }

    // Return highest urgency exit condition
    if (results.length > 0) {
      results.sort((a, b) => b.urgency - a.urgency)
      return results[0]
    }

    return { shouldExit: false }
  }

  /**
   * Check weekend exit condition
   */
  checkWeekendExit(now, config) {
    const day = now.getUTCDay()
    const hour = now.getUTCHours()

    // Friday check
    if (day === config.weekendExitDay) {
      const hoursUntilCutoff = config.weekendExitHourUTC - hour

      if (hour >= config.weekendExitHourUTC) {
        return {
          shouldExit: true,
          type: TimeExitType.WEEKEND,
          reason: 'Weekend exit: Market closing soon, closing all positions',
          urgency: 100,
          hoursUntilCutoff: 0
        }
      }

      if (hoursUntilCutoff <= 2) {
        return {
          shouldExit: false,
          type: TimeExitType.WEEKEND,
          reason: `Weekend warning: ${hoursUntilCutoff} hours until exit cutoff`,
          urgency: 50,
          hoursUntilCutoff,
          warning: true
        }
      }
    }

    // Saturday/Sunday (market closed anyway)
    if (day === 6 || day === 0) {
      return {
        shouldExit: true,
        type: TimeExitType.WEEKEND,
        reason: 'Weekend: Market closed',
        urgency: 100
      }
    }

    return { shouldExit: false }
  }

  /**
   * Check session end exit condition
   */
  checkSessionExit(now, config) {
    const session = MarketSession[config.preferredSession]
    if (!session) {
      return { shouldExit: false }
    }

    const hour = now.getUTCHours()

    // Check if within 30 minutes of session close
    if (hour === session.close || (hour === session.close - 1 && now.getUTCMinutes() >= 30)) {
      return {
        shouldExit: true,
        type: TimeExitType.SESSION_END,
        reason: `${session.name} session ending - closing positions`,
        urgency: 60
      }
    }

    return { shouldExit: false }
  }

  /**
   * Check if a specific trade should be closed due to max hold time
   * @param {Object} trade - Trade object
   * @returns {Object} { shouldExit, type, reason }
   */
  checkMaxHoldTime(trade) {
    const config = this.getConfig()

    if (!config.maxHoldEnabled || !trade.opened_at) {
      return { shouldExit: false }
    }

    const openedAt = new Date(trade.opened_at)
    const now = new Date()
    const hoursHeld = (now - openedAt) / (1000 * 60 * 60)

    if (hoursHeld >= config.maxHoldHours) {
      return {
        shouldExit: true,
        type: TimeExitType.MAX_HOLD,
        reason: `Max hold time exceeded: ${hoursHeld.toFixed(1)} hours (limit: ${config.maxHoldHours})`,
        hoursHeld
      }
    }

    return {
      shouldExit: false,
      hoursHeld,
      hoursRemaining: config.maxHoldHours - hoursHeld
    }
  }

  /**
   * Check all trades for time-based exits
   * @param {Array} trades - Active trades
   * @returns {Array} Trades that should be closed with reasons
   */
  checkAllTradesForExit(trades) {
    const config = this.getConfig()
    const tradesToClose = []

    // First check global conditions (weekend, session)
    const globalCheck = this.checkTimeExits()

    if (globalCheck.shouldExit) {
      // All trades should close
      return trades.map(trade => ({
        trade,
        ...globalCheck
      }))
    }

    // Check individual trade conditions (max hold time)
    if (config.maxHoldEnabled) {
      for (const trade of trades) {
        const holdCheck = this.checkMaxHoldTime(trade)
        if (holdCheck.shouldExit) {
          tradesToClose.push({
            trade,
            ...holdCheck
          })
        }
      }
    }

    return tradesToClose
  }

  /**
   * Check if new trades should be blocked due to time
   * @returns {Object} { blocked, reason }
   */
  shouldBlockNewTrades() {
    const config = this.getConfig()

    if (!config.enabled) {
      return { blocked: false }
    }

    const now = new Date()
    const day = now.getUTCDay()
    const hour = now.getUTCHours()

    // Block on weekends
    if (day === 0 || day === 6) {
      return {
        blocked: true,
        reason: 'Weekend: Market closed'
      }
    }

    // Block within 2 hours of weekend cutoff
    if (config.weekendExitEnabled && day === config.weekendExitDay) {
      if (hour >= config.weekendExitHourUTC - 2) {
        return {
          blocked: true,
          reason: `No new trades: Within 2 hours of weekend exit cutoff`
        }
      }
    }

    return { blocked: false }
  }

  /**
   * Get time status for dashboard
   */
  getStatus() {
    const config = this.getConfig()
    const now = new Date()
    const day = now.getUTCDay()
    const hour = now.getUTCHours()

    // Calculate time until weekend
    let hoursUntilWeekend = 0
    if (day < config.weekendExitDay) {
      hoursUntilWeekend = (config.weekendExitDay - day) * 24 + (config.weekendExitHourUTC - hour)
    } else if (day === config.weekendExitDay) {
      hoursUntilWeekend = Math.max(0, config.weekendExitHourUTC - hour)
    }

    // Get current session
    const currentSession = this.getCurrentSession(now)

    return {
      enabled: config.enabled,
      weekendExitEnabled: config.weekendExitEnabled,
      hoursUntilWeekendExit: hoursUntilWeekend,
      currentSession,
      sessionExitEnabled: config.sessionExitEnabled,
      maxHoldEnabled: config.maxHoldEnabled,
      maxHoldHours: config.maxHoldHours,
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day],
      currentTimeUTC: now.toISOString(),
      tradingBlocked: this.shouldBlockNewTrades()
    }
  }

  /**
   * Determine current market session
   */
  getCurrentSession(now) {
    const hour = now.getUTCHours()

    for (const [, session] of Object.entries(MarketSession)) {
      if (session.open < session.close) {
        // Normal hours (e.g., London 7-16)
        if (hour >= session.open && hour < session.close) {
          return session.name
        }
      } else {
        // Wraps midnight (e.g., Sydney 21-6)
        if (hour >= session.open || hour < session.close) {
          return session.name
        }
      }
    }

    return 'Off-hours'
  }
}

// Singleton instance
export const timeExitManager = new TimeExitManager()
export default timeExitManager
