/**
 * Swing Exit Manager
 * Handles exit management for swing trades:
 * - Wider stop losses using Daily ATR
 * - Partial profit taking at multiple targets
 * - Swing-based trailing stops
 */

import { getAllSettings, updateTrade } from '../../database.js'
import { swingPointDetector } from '../analysis/SwingPointDetector.js'

/**
 * @typedef {Object} ExitDecision
 * @property {boolean} shouldExit - Whether to exit the trade
 * @property {string} reason - Exit reason code
 * @property {string} description - Human-readable description
 * @property {number} [newStopLoss] - New stop loss if trailing
 * @property {number} [closePercent] - Percentage to close for partial exit
 */

class SwingExitManager {
  constructor() {
    // Track partial close state per trade
    this.partialCloseState = new Map()
  }

  /**
   * Calculate initial stop loss for a swing trade
   * Uses the wider of: ATR-based or swing point based
   * @param {string} direction - 'UP' or 'DOWN'
   * @param {number} entryPrice - Entry price
   * @param {number} atr - Daily ATR value
   * @param {Object} swingPoints - Nearest swing high/low info
   * @returns {Object} Stop loss calculation
   */
  calculateSwingStopLoss(direction, entryPrice, atr, swingPoints) {
    const settings = getAllSettings()
    const atrMultiplier = settings.swingATRMultiplierSL || 2.0

    // ATR-based stop
    const atrStop = direction === 'UP'
      ? entryPrice - (atr * atrMultiplier)
      : entryPrice + (atr * atrMultiplier)

    // Swing point-based stop (below last swing low for longs, above for shorts)
    let swingStop = null
    if (direction === 'UP' && swingPoints?.nearestSwingLow) {
      // Place stop below the last swing low with a small buffer
      swingStop = swingPoints.nearestSwingLow.price - (atr * 0.25)
    } else if (direction === 'DOWN' && swingPoints?.nearestSwingHigh) {
      // Place stop above the last swing high with a small buffer
      swingStop = swingPoints.nearestSwingHigh.price + (atr * 0.25)
    }

    // Use the wider (more protective) stop
    let finalStop
    let method
    if (direction === 'UP') {
      if (swingStop && swingStop < atrStop) {
        finalStop = swingStop
        method = 'SWING_POINT'
      } else {
        finalStop = atrStop
        method = 'ATR'
      }
    } else {
      if (swingStop && swingStop > atrStop) {
        finalStop = swingStop
        method = 'SWING_POINT'
      } else {
        finalStop = atrStop
        method = 'ATR'
      }
    }

    const riskPips = Math.abs(entryPrice - finalStop)

    return {
      stopLoss: finalStop,
      method,
      atrStop,
      swingStop,
      riskPips,
      atrMultiplier,
      explanation: method === 'SWING_POINT'
        ? `Stop placed below swing ${direction === 'UP' ? 'low' : 'high'} for structure-based protection`
        : `Stop placed ${atrMultiplier}x ATR from entry`
    }
  }

  /**
   * Calculate take profit targets for a swing trade
   * Returns multiple TP levels for partial exits
   * @param {string} direction - 'UP' or 'DOWN'
   * @param {number} entryPrice - Entry price
   * @param {number} stopLoss - Stop loss price
   * @param {number} atr - Daily ATR
   * @returns {Object} Take profit targets
   */
  calculateSwingTakeProfits(direction, entryPrice, stopLoss, atr) {
    const settings = getAllSettings()
    const riskAmount = Math.abs(entryPrice - stopLoss)

    // Partial TP percentages
    const tp1Percent = settings.swingPartialTP1Percent || 33
    const tp2Percent = settings.swingPartialTP2Percent || 33
    const tp3Percent = settings.swingPartialTP3Percent || 34

    // Calculate TP levels
    let tp1, tp2, tp3
    if (direction === 'UP') {
      tp1 = entryPrice + riskAmount       // 1:1 R:R
      tp2 = entryPrice + (riskAmount * 2) // 2:1 R:R
      tp3 = entryPrice + (riskAmount * 3) // 3:1 R:R (or trail)
    } else {
      tp1 = entryPrice - riskAmount
      tp2 = entryPrice - (riskAmount * 2)
      tp3 = entryPrice - (riskAmount * 3)
    }

    return {
      targets: [
        { level: tp1, percent: tp1Percent, rr: 1, name: 'TP1', action: 'CLOSE_PARTIAL_MOVE_BE' },
        { level: tp2, percent: tp2Percent, rr: 2, name: 'TP2', action: 'CLOSE_PARTIAL_TRAIL' },
        { level: tp3, percent: tp3Percent, rr: 3, name: 'TP3', action: 'CLOSE_REMAINING' }
      ],
      tp1,
      tp2,
      tp3,
      riskAmount,
      explanation: `Partial exits: ${tp1Percent}% at 1R, ${tp2Percent}% at 2R, ${tp3Percent}% trailing to 3R+`
    }
  }

  /**
   * Check if any partial profit targets have been hit
   * @param {Object} trade - The trade object
   * @param {number} currentPrice - Current price
   * @returns {ExitDecision[]} Array of exit actions to take
   */
  checkPartialProfitTargets(trade, currentPrice) {
    const tradeId = trade.id
    const direction = trade.direction

    // Initialize state if not exists
    if (!this.partialCloseState.has(tradeId)) {
      const tpInfo = this.calculateSwingTakeProfits(
        direction,
        trade.entry_price,
        trade.stop_loss,
        trade.atr_at_entry || Math.abs(trade.take_profit - trade.entry_price) / 3
      )
      this.partialCloseState.set(tradeId, {
        targets: tpInfo.targets,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        movedToBreakeven: false,
        trailingActive: false
      })
    }

    const state = this.partialCloseState.get(tradeId)
    const actions = []

    // Check each target
    for (const target of state.targets) {
      const targetHit = direction === 'UP'
        ? currentPrice >= target.level
        : currentPrice <= target.level

      if (targetHit) {
        if (target.name === 'TP1' && !state.tp1Hit) {
          state.tp1Hit = true
          actions.push({
            type: 'PARTIAL_CLOSE',
            targetName: 'TP1',
            closePercent: target.percent,
            reason: 'SWING_TP1_HIT',
            description: `First profit target hit at ${target.rr}:1 R:R - closing ${target.percent}%`,
            moveToBE: true
          })
        } else if (target.name === 'TP2' && !state.tp2Hit && state.tp1Hit) {
          state.tp2Hit = true
          actions.push({
            type: 'PARTIAL_CLOSE',
            targetName: 'TP2',
            closePercent: target.percent,
            reason: 'SWING_TP2_HIT',
            description: `Second profit target hit at ${target.rr}:1 R:R - closing ${target.percent}%`,
            activateTrailing: true
          })
        } else if (target.name === 'TP3' && !state.tp3Hit && state.tp2Hit) {
          state.tp3Hit = true
          actions.push({
            type: 'CLOSE_REMAINING',
            targetName: 'TP3',
            closePercent: target.percent,
            reason: 'SWING_TP3_HIT',
            description: `Final profit target hit at ${target.rr}:1 R:R - closing remaining position`
          })
        }
      }
    }

    // Update state
    this.partialCloseState.set(tradeId, state)

    return actions
  }

  /**
   * Calculate new trailing stop based on swing points
   * Trails below swing lows (for longs) or above swing highs (for shorts)
   * @param {Object} trade - The trade object
   * @param {number} currentPrice - Current price
   * @param {Array} dailyCandles - Daily candle data
   * @returns {Object|null} New trailing stop info or null if no update
   */
  calculateSwingTrailingStop(trade, currentPrice, dailyCandles) {
    const settings = getAllSettings()

    if (!settings.swingTrailBelowSwingPoint) {
      return null
    }

    const tradeId = trade.id
    const state = this.partialCloseState.get(tradeId)

    // Only trail after TP1 is hit
    if (!state || !state.tp1Hit) {
      return null
    }

    const direction = trade.direction
    const currentStop = trade.trailing_stop || trade.stop_loss

    // Get recent swing points
    const lookback = settings.swingSwingPointLookback || 5

    if (direction === 'UP') {
      // Trail below swing lows
      const swingLows = swingPointDetector.detectSwingLows(dailyCandles, lookback)

      if (swingLows.length > 0) {
        // Get the most recent confirmed swing low
        const recentSwingLow = swingLows[swingLows.length - 1]

        // Only move stop up, never down
        if (recentSwingLow.price > currentStop) {
          // Add a small buffer below the swing low
          const atr = trade.atr_at_entry || (dailyCandles[dailyCandles.length - 1].high - dailyCandles[dailyCandles.length - 1].low)
          const newStop = recentSwingLow.price - (atr * 0.1)

          if (newStop > currentStop && newStop < currentPrice) {
            return {
              newStop,
              reason: 'SWING_TRAIL',
              description: `Trailing stop moved below swing low at ${recentSwingLow.date}`,
              swingPoint: recentSwingLow
            }
          }
        }
      }
    } else {
      // Trail above swing highs for shorts
      const swingHighs = swingPointDetector.detectSwingHighs(dailyCandles, lookback)

      if (swingHighs.length > 0) {
        const recentSwingHigh = swingHighs[swingHighs.length - 1]

        // Only move stop down for shorts
        if (recentSwingHigh.price < currentStop) {
          const atr = trade.atr_at_entry || (dailyCandles[dailyCandles.length - 1].high - dailyCandles[dailyCandles.length - 1].low)
          const newStop = recentSwingHigh.price + (atr * 0.1)

          if (newStop < currentStop && newStop > currentPrice) {
            return {
              newStop,
              reason: 'SWING_TRAIL',
              description: `Trailing stop moved above swing high at ${recentSwingHigh.date}`,
              swingPoint: recentSwingHigh
            }
          }
        }
      }
    }

    return null
  }

  /**
   * Move stop loss to breakeven (entry price + small buffer)
   * @param {Object} trade - The trade object
   * @returns {Object} Breakeven stop info
   */
  calculateBreakevenStop(trade) {
    const settings = getAllSettings()
    const bufferPips = settings.breakEvenBuffer || 2
    const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001
    const buffer = bufferPips * pipValue

    const newStop = trade.direction === 'UP'
      ? trade.entry_price + buffer
      : trade.entry_price - buffer

    return {
      newStop,
      reason: 'MOVE_TO_BREAKEVEN',
      description: `Stop moved to breakeven at ${newStop.toFixed(5)} (+${bufferPips} pips buffer)`
    }
  }

  /**
   * Check all exit conditions for a swing trade
   * @param {Object} trade - The trade object
   * @param {number} currentPrice - Current price
   * @param {Array} dailyCandles - Daily candle data
   * @returns {Object} Complete exit analysis
   */
  analyzeSwingExit(trade, currentPrice, dailyCandles) {
    const results = {
      actions: [],
      trailingUpdate: null,
      shouldClose: false,
      closeReason: null
    }

    // Check if trade is a swing trade
    if (!trade.is_swing_trade) {
      return results
    }

    // Check partial profit targets
    const partialActions = this.checkPartialProfitTargets(trade, currentPrice)
    results.actions.push(...partialActions)

    // Process breakeven moves
    for (const action of partialActions) {
      if (action.moveToBE) {
        const beStop = this.calculateBreakevenStop(trade)
        results.actions.push({
          type: 'MOVE_STOP',
          ...beStop
        })
      }
    }

    // Check trailing stop update
    const trailingUpdate = this.calculateSwingTrailingStop(trade, currentPrice, dailyCandles)
    if (trailingUpdate) {
      results.trailingUpdate = trailingUpdate
      results.actions.push({
        type: 'MOVE_STOP',
        ...trailingUpdate
      })
    }

    // Check if remaining position should close
    for (const action of partialActions) {
      if (action.type === 'CLOSE_REMAINING') {
        results.shouldClose = true
        results.closeReason = action.reason
      }
    }

    // Check max hold time
    const settings = getAllSettings()
    const maxHoldDays = settings.swingMaxHoldDays || 7

    if (trade.opened_at) {
      const openDate = new Date(trade.opened_at)
      const now = new Date()
      const holdDays = Math.floor((now - openDate) / (1000 * 60 * 60 * 24))

      if (holdDays >= maxHoldDays) {
        results.shouldClose = true
        results.closeReason = 'SWING_MAX_HOLD_TIME'
        results.actions.push({
          type: 'TIME_EXIT',
          reason: 'SWING_MAX_HOLD_TIME',
          description: `Maximum hold time of ${maxHoldDays} days reached`
        })
      }
    }

    return results
  }

  /**
   * Clean up state when trade closes
   * @param {number} tradeId - Trade ID
   */
  removeTrade(tradeId) {
    this.partialCloseState.delete(tradeId)
  }

  /**
   * Get current state for a trade
   * @param {number} tradeId - Trade ID
   * @returns {Object|null} Trade state or null
   */
  getTradeState(tradeId) {
    return this.partialCloseState.get(tradeId) || null
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const settings = getAllSettings()
    return {
      enabled: settings.swingTradingEnabled,
      trackedTrades: this.partialCloseState.size,
      maxHoldDays: settings.swingMaxHoldDays || 7,
      minHoldDays: settings.swingMinHoldDays || 3,
      partialTP1: settings.swingPartialTP1Percent || 33,
      partialTP2: settings.swingPartialTP2Percent || 33,
      partialTP3: settings.swingPartialTP3Percent || 34,
      trailBelowSwing: settings.swingTrailBelowSwingPoint !== false
    }
  }
}

// Singleton instance
export const swingExitManager = new SwingExitManager()

// Named export for class
export { SwingExitManager }

export default SwingExitManager
