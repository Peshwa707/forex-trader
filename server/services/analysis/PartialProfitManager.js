/**
 * Partial Profit Manager
 * Phase 2 Risk Improvement: Scale out of positions at profit targets
 *
 * Implements:
 * - Multiple profit targets with percentage exits
 * - Break-even stop after first target
 * - Trailing remainder after partial close
 * - Risk-free trade management
 */

import * as db from '../../database.js'

// Partial close strategies
export const PartialCloseStrategy = {
  FIXED_TARGETS: 'FIXED_TARGETS',     // Close at fixed R multiples
  ATR_BASED: 'ATR_BASED',             // Close based on ATR targets
  PERCENTAGE: 'PERCENTAGE',            // Close at percentage gains
  FIBONACCI: 'FIBONACCI'               // Close at Fib extension levels
}

// Default profit targets (in R multiples)
export const DEFAULT_PROFIT_TARGETS = [
  { r: 1.0, closePercent: 33, moveSLToBreakeven: true },
  { r: 2.0, closePercent: 33, trailRemaining: true },
  { r: 3.0, closePercent: 34, finalTarget: true }
]

// Default configuration
export const DEFAULT_PARTIAL_CONFIG = {
  enabled: false,                      // Disabled by default for safety
  strategy: PartialCloseStrategy.FIXED_TARGETS,
  targets: DEFAULT_PROFIT_TARGETS,
  moveToBreakevenAfterFirstTarget: true,
  trailAfterSecondTarget: true,
  minPositionSizeForPartials: 0.02,   // Need at least 0.02 lots to split
  breakEvenBuffer: 2                   // Pips above/below entry for BE stop
}

/**
 * PartialProfitManager - Manages partial position closes at profit targets
 */
export class PartialProfitManager {
  constructor() {
    this.config = { ...DEFAULT_PARTIAL_CONFIG }
    this.tradeProgress = new Map() // Track partial close progress per trade
  }

  /**
   * Configure with custom settings
   */
  configure(config = {}) {
    this.config = { ...DEFAULT_PARTIAL_CONFIG, ...config }
    return this
  }

  /**
   * Get configuration from database
   */
  getConfig() {
    const settings = db.getAllSettings()
    return {
      enabled: settings.partialProfitsEnabled !== undefined
        ? settings.partialProfitsEnabled
        : this.config.enabled,
      strategy: settings.partialProfitStrategy || this.config.strategy,
      targets: settings.partialProfitTargets || this.config.targets,
      moveToBreakevenAfterFirstTarget: settings.moveToBreakevenAfterFirstTarget !== undefined
        ? settings.moveToBreakevenAfterFirstTarget
        : this.config.moveToBreakevenAfterFirstTarget,
      trailAfterSecondTarget: settings.trailAfterSecondTarget !== undefined
        ? settings.trailAfterSecondTarget
        : this.config.trailAfterSecondTarget,
      minPositionSizeForPartials: settings.minPositionSizeForPartials || this.config.minPositionSizeForPartials,
      breakEvenBuffer: settings.breakEvenBuffer || this.config.breakEvenBuffer
    }
  }

  /**
   * Initialize tracking for a new trade
   */
  initializeTrade(trade) {
    this.tradeProgress.set(trade.id, {
      originalSize: parseFloat(trade.size || trade.lots),
      remainingSize: parseFloat(trade.size || trade.lots),
      targetsClosed: [],
      currentTargetIndex: 0,
      movedToBreakeven: false,
      trailingActivated: false,
      partialCloses: []
    })
  }

  /**
   * Calculate R multiple (profit in terms of risk)
   * @param {Object} trade - Trade object
   * @param {number} currentPrice - Current market price
   * @returns {number} R multiple
   */
  calculateRMultiple(trade, currentPrice) {
    const entry = parseFloat(trade.entry_price)
    const sl = parseFloat(trade.stop_loss)
    const current = parseFloat(currentPrice)

    const riskPerUnit = Math.abs(entry - sl)
    if (riskPerUnit === 0) return 0

    const profitPerUnit = trade.direction === 'UP'
      ? current - entry
      : entry - current

    return profitPerUnit / riskPerUnit
  }

  /**
   * Calculate profit percentage
   */
  calculateProfitPercent(trade, currentPrice) {
    const entry = parseFloat(trade.entry_price)
    const current = parseFloat(currentPrice)

    const profitPerUnit = trade.direction === 'UP'
      ? current - entry
      : entry - current

    return (profitPerUnit / entry) * 100
  }

  /**
   * Check if any partial close targets are hit
   * @param {Object} trade - Trade object
   * @param {number} currentPrice - Current market price
   * @param {number} atr - Optional ATR for ATR-based targets
   * @returns {Object} Actions to take
   */
  checkPartialCloseTargets(trade, currentPrice, atr = null) {
    const config = this.getConfig()

    if (!config.enabled) {
      return { actions: [], reason: 'Partial profits disabled' }
    }

    // Check minimum position size
    const tradeSize = parseFloat(trade.size || trade.lots)
    if (tradeSize < config.minPositionSizeForPartials) {
      return {
        actions: [],
        reason: `Position size ${tradeSize} below minimum ${config.minPositionSizeForPartials} for partials`
      }
    }

    // Get or initialize trade progress
    let progress = this.tradeProgress.get(trade.id)
    if (!progress) {
      this.initializeTrade(trade)
      progress = this.tradeProgress.get(trade.id)
    }

    const rMultiple = this.calculateRMultiple(trade, currentPrice)
    const profitPercent = this.calculateProfitPercent(trade, currentPrice)

    const actions = []

    // Check each target
    for (let i = progress.currentTargetIndex; i < config.targets.length; i++) {
      const target = config.targets[i]

      // Check if target is hit based on strategy
      let targetHit = false
      let targetValue = 0

      switch (config.strategy) {
        case PartialCloseStrategy.FIXED_TARGETS:
          targetHit = rMultiple >= target.r
          targetValue = target.r
          break

        case PartialCloseStrategy.ATR_BASED:
          if (atr) {
            const atrTarget = target.r * atr
            const entry = parseFloat(trade.entry_price)
            const targetPrice = trade.direction === 'UP'
              ? entry + atrTarget
              : entry - atrTarget
            targetHit = trade.direction === 'UP'
              ? currentPrice >= targetPrice
              : currentPrice <= targetPrice
            targetValue = `${target.r} ATR`
          }
          break

        case PartialCloseStrategy.PERCENTAGE:
          targetHit = profitPercent >= target.r // r is used as percentage in this mode
          targetValue = `${target.r}%`
          break

        case PartialCloseStrategy.FIBONACCI: {
          // Use Fibonacci extensions: 1.0, 1.618, 2.618
          const fibLevels = [1.0, 1.618, 2.618]
          const fibTarget = fibLevels[i] || fibLevels[fibLevels.length - 1]
          targetHit = rMultiple >= fibTarget
          targetValue = `${fibTarget} Fib`
          break
        }
      }

      if (targetHit && !progress.targetsClosed.includes(i)) {
        const closeSize = (progress.originalSize * (target.closePercent / 100))

        actions.push({
          type: 'PARTIAL_CLOSE',
          targetIndex: i,
          targetValue,
          closePercent: target.closePercent,
          closeSize: Math.max(0.01, parseFloat(closeSize.toFixed(2))),
          rMultiple,
          profitPercent
        })

        // Update progress
        progress.targetsClosed.push(i)
        progress.currentTargetIndex = i + 1
        progress.remainingSize -= closeSize
        progress.partialCloses.push({
          targetIndex: i,
          closeSize,
          price: currentPrice,
          rMultiple,
          timestamp: new Date().toISOString()
        })

        // Check for break-even move
        if (target.moveSLToBreakeven && config.moveToBreakevenAfterFirstTarget && !progress.movedToBreakeven) {
          const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001
          const breakEvenStop = trade.direction === 'UP'
            ? parseFloat(trade.entry_price) + (config.breakEvenBuffer * pipValue)
            : parseFloat(trade.entry_price) - (config.breakEvenBuffer * pipValue)

          actions.push({
            type: 'MOVE_STOP_TO_BREAKEVEN',
            newStop: breakEvenStop,
            bufferPips: config.breakEvenBuffer,
            reason: 'First target hit - moving to break-even'
          })

          progress.movedToBreakeven = true
        }

        // Check for trailing activation
        if (target.trailRemaining && config.trailAfterSecondTarget && !progress.trailingActivated) {
          actions.push({
            type: 'ACTIVATE_TRAILING',
            reason: 'Second target hit - activating trailing stop on remainder'
          })

          progress.trailingActivated = true
        }

        // Only process one target at a time
        break
      }
    }

    // Update stored progress
    this.tradeProgress.set(trade.id, progress)

    return {
      actions,
      progress: {
        originalSize: progress.originalSize,
        remainingSize: progress.remainingSize,
        targetsClosed: progress.targetsClosed.length,
        totalTargets: config.targets.length,
        movedToBreakeven: progress.movedToBreakeven,
        trailingActivated: progress.trailingActivated
      },
      rMultiple,
      profitPercent,
      nextTarget: progress.currentTargetIndex < config.targets.length
        ? config.targets[progress.currentTargetIndex]
        : null
    }
  }

  /**
   * Calculate partial close details for a given R target
   */
  calculatePartialClose(trade, targetR, closePercent, currentPrice) {
    const entry = parseFloat(trade.entry_price)
    const sl = parseFloat(trade.stop_loss)
    const size = parseFloat(trade.size || trade.lots)

    const riskPerUnit = Math.abs(entry - sl)
    const targetPrice = trade.direction === 'UP'
      ? entry + (riskPerUnit * targetR)
      : entry - (riskPerUnit * targetR)

    const closeSize = size * (closePercent / 100)
    const currentR = this.calculateRMultiple(trade, currentPrice)

    return {
      targetR,
      targetPrice,
      closePercent,
      closeSize: Math.max(0.01, parseFloat(closeSize.toFixed(2))),
      remainingSize: parseFloat((size - closeSize).toFixed(2)),
      currentR,
      targetHit: currentR >= targetR
    }
  }

  /**
   * Get recommended break-even stop price
   */
  getBreakEvenStop(trade, bufferPips = null) {
    const config = this.getConfig()
    const buffer = bufferPips || config.breakEvenBuffer
    const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

    if (trade.direction === 'UP') {
      return parseFloat(trade.entry_price) + (buffer * pipValue)
    } else {
      return parseFloat(trade.entry_price) - (buffer * pipValue)
    }
  }

  /**
   * Clean up trade data when trade is closed
   */
  removeTrade(tradeId) {
    this.tradeProgress.delete(tradeId)
  }

  /**
   * Get progress for a specific trade
   */
  getTradeProgress(tradeId) {
    return this.tradeProgress.get(tradeId) || null
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    const config = this.getConfig()
    const activeTrades = {}

    for (const [tradeId, progress] of this.tradeProgress.entries()) {
      activeTrades[tradeId] = {
        remaining: `${((progress.remainingSize / progress.originalSize) * 100).toFixed(0)}%`,
        targetsClosed: progress.targetsClosed.length,
        breakeven: progress.movedToBreakeven,
        trailing: progress.trailingActivated
      }
    }

    return {
      enabled: config.enabled,
      strategy: config.strategy,
      targets: config.targets.map(t => ({
        r: t.r,
        closePercent: t.closePercent
      })),
      moveToBreakeven: config.moveToBreakevenAfterFirstTarget,
      trailAfterSecond: config.trailAfterSecondTarget,
      minPositionSize: config.minPositionSizeForPartials,
      activeTrades
    }
  }

  /**
   * Clear all tracking data
   */
  clearAll() {
    this.tradeProgress.clear()
  }
}

// Singleton instance
export const partialProfitManager = new PartialProfitManager()
export default partialProfitManager
