/**
 * Shariah Compliance Service
 * Enforces Islamic finance principles in forex trading
 *
 * Principles Addressed:
 * - Riba (Interest): Auto-close before swap time to avoid overnight interest
 * - Maysir (Gambling): Require indicator confluence to reduce speculation
 * - Gharar (Uncertainty): Track all fees for transparency
 * - Leverage: Cap at 1:5 to reduce excessive debt/risk
 *
 * بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
 */

import * as db from '../../database.js'

// Swap time is 5pm EST (22:00 UTC in winter, 21:00 UTC in summer)
const SWAP_HOUR_EST = 17  // 5pm EST

export class ShariahComplianceService {
  constructor() {
    this.initialized = false
  }

  initialize() {
    this.initialized = true
    console.log('[Shariah] Compliance service initialized - بِسْمِ اللَّهِ')
  }

  /**
   * Check if current time is past the swap cutoff
   * Returns timing information for swap deadline
   */
  checkSwapDeadline() {
    const settings = db.getAllSettings()
    if (!settings.shariahCompliant) {
      return { enabled: false }
    }

    const now = new Date()
    const cutoffHour = settings.shariahSwapCutoffHour || 16
    const cutoffMinute = settings.shariahSwapCutoffMinute || 0

    // Convert current time to EST
    const estOffset = this.getESTOffset()
    const nowEST = new Date(now.getTime() + estOffset)
    const currentHourEST = nowEST.getUTCHours()
    const currentMinuteEST = nowEST.getUTCMinutes()

    // Calculate minutes until cutoff
    const currentMinutesFromMidnight = currentHourEST * 60 + currentMinuteEST
    const cutoffMinutesFromMidnight = cutoffHour * 60 + cutoffMinute
    const swapMinutesFromMidnight = SWAP_HOUR_EST * 60

    let minutesUntilCutoff = cutoffMinutesFromMidnight - currentMinutesFromMidnight
    let minutesUntilSwap = swapMinutesFromMidnight - currentMinutesFromMidnight

    // Handle next day
    if (minutesUntilCutoff < 0) minutesUntilCutoff += 24 * 60
    if (minutesUntilSwap < 0) minutesUntilSwap += 24 * 60

    const pastCutoff = currentMinutesFromMidnight >= cutoffMinutesFromMidnight &&
                       currentMinutesFromMidnight < swapMinutesFromMidnight + 60

    const withinTwoHours = minutesUntilCutoff <= 120 && minutesUntilCutoff > 0
    const withinOneHour = minutesUntilCutoff <= 60 && minutesUntilCutoff > 0

    return {
      enabled: true,
      currentTimeEST: `${currentHourEST.toString().padStart(2, '0')}:${currentMinuteEST.toString().padStart(2, '0')}`,
      cutoffTimeEST: `${cutoffHour.toString().padStart(2, '0')}:${cutoffMinute.toString().padStart(2, '0')}`,
      swapTimeEST: `${SWAP_HOUR_EST}:00`,
      minutesUntilCutoff,
      minutesUntilSwap,
      pastCutoff,
      withinTwoHours,
      withinOneHour,
      tradingAllowed: !pastCutoff && minutesUntilCutoff > 0
    }
  }

  /**
   * Get EST offset from UTC in milliseconds
   * Accounts for daylight saving time
   */
  getESTOffset() {
    const now = new Date()
    // EST is UTC-5, EDT is UTC-4
    // DST starts second Sunday of March, ends first Sunday of November
    const jan = new Date(now.getFullYear(), 0, 1)
    const jul = new Date(now.getFullYear(), 6, 1)
    const isDST = now.getTimezoneOffset() < Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset())
    return isDST ? -4 * 60 * 60 * 1000 : -5 * 60 * 60 * 1000
  }

  /**
   * Validate a trade for Shariah compliance before execution
   */
  validateTrade(prediction, settings) {
    if (!settings.shariahCompliant) {
      return { valid: true, compliant: true }
    }

    const violations = []

    // 1. Check swap deadline
    const swapDeadline = this.checkSwapDeadline()
    if (swapDeadline.pastCutoff) {
      violations.push({
        rule: 'RIBA_PREVENTION',
        reason: 'Past swap cutoff time - trades would incur overnight interest',
        severity: 'BLOCKING'
      })
    } else if (swapDeadline.withinTwoHours) {
      violations.push({
        rule: 'RIBA_WARNING',
        reason: `Only ${swapDeadline.minutesUntilCutoff} minutes until swap cutoff`,
        severity: 'WARNING'
      })
    }

    // 2. Check confidence threshold (anti-Maysir)
    const minConfidence = settings.shariahMinConfidence || 70
    if (prediction.confidence < minConfidence) {
      violations.push({
        rule: 'MAYSIR_PREVENTION',
        reason: `Confidence ${prediction.confidence}% below ${minConfidence}% minimum`,
        severity: 'BLOCKING'
      })
    }

    // 3. Check indicator confluence (anti-Maysir)
    const confluence = this.checkIndicatorConfluence(prediction)
    const minConfluence = settings.shariahMinIndicatorConfluence || 3
    if (confluence.count < minConfluence) {
      violations.push({
        rule: 'MAYSIR_PREVENTION',
        reason: `Only ${confluence.count} indicators agree, need ${minConfluence}+`,
        severity: 'BLOCKING'
      })
    }

    const blockingViolations = violations.filter(v => v.severity === 'BLOCKING')
    const valid = blockingViolations.length === 0

    return {
      valid,
      compliant: violations.length === 0,
      violations,
      blockingViolations,
      reason: blockingViolations.length > 0
        ? blockingViolations.map(v => v.reason).join('; ')
        : null,
      confluence: confluence.count,
      swapDeadline
    }
  }

  /**
   * Check indicator confluence for a prediction
   */
  checkIndicatorConfluence(prediction) {
    const direction = prediction.direction || prediction.signal
    const targetSignal = direction === 'UP' ? 'BUY' : 'SELL'

    // Get signals from prediction's analysis
    const signals = prediction._analysis?.signals || []
    const agreeingSignals = signals.filter(s => s.signal === targetSignal)

    return {
      count: agreeingSignals.length,
      total: signals.length,
      agreeing: agreeingSignals.map(s => s.indicator),
      ratio: signals.length > 0 ? agreeingSignals.length / signals.length : 0
    }
  }

  /**
   * Calculate current leverage for a position
   */
  calculateLeverage(positionSize, accountBalance) {
    const standardLotValue = 100000  // Standard forex lot = $100,000
    const positionValue = positionSize * standardLotValue
    return positionValue / accountBalance
  }

  /**
   * Check if position size exceeds Shariah leverage limit
   */
  checkLeverageLimit(positionSize, settings) {
    if (!settings.shariahCompliant) {
      return { valid: true }
    }

    const accountBalance = settings.accountBalance || 10000
    const maxLeverage = settings.shariahMaxLeverage || 5
    const currentLeverage = this.calculateLeverage(positionSize, accountBalance)

    if (currentLeverage > maxLeverage) {
      const maxLots = (accountBalance * maxLeverage) / 100000
      return {
        valid: false,
        currentLeverage: currentLeverage.toFixed(1),
        maxLeverage,
        reason: `Position exceeds 1:${maxLeverage} leverage limit`,
        maxAllowedLots: maxLots.toFixed(2),
        requestedLots: positionSize
      }
    }

    return {
      valid: true,
      currentLeverage: currentLeverage.toFixed(1),
      maxLeverage
    }
  }

  /**
   * Auto-close all positions for swap prevention
   */
  async autoCloseForSwap(activeTrades, priceMap, executionEngine) {
    const closedTrades = []

    for (const trade of activeTrades) {
      const currentPrice = priceMap[trade.pair]
      if (currentPrice) {
        try {
          const result = await executionEngine.closeTrade(
            trade.id,
            currentPrice,
            'SHARIAH_SWAP_PREVENTION'
          )
          if (result.success) {
            closedTrades.push({
              ...trade,
              closeReason: 'SHARIAH_SWAP_PREVENTION',
              closePrice: currentPrice
            })
            db.logActivity('SHARIAH_AUTO_CLOSE',
              `Auto-closed ${trade.pair} before swap time to comply with Shariah rules`,
              { tradeId: trade.id, reason: 'riba_prevention' }
            )
          }
        } catch (error) {
          console.error(`[Shariah] Failed to auto-close trade ${trade.id}:`, error.message)
        }
      }
    }

    if (closedTrades.length > 0) {
      console.log(`[Shariah] Auto-closed ${closedTrades.length} positions before swap time - الحمد لله`)
    }

    return closedTrades
  }

  /**
   * Track fees for a trade (Gharar transparency)
   */
  trackFees(trade, commission = 0, spreadCost = 0) {
    const fees = {
      tradeId: trade.id,
      pair: trade.pair,
      commission,
      spreadCost,
      totalFees: commission + spreadCost,
      feePercentage: trade.position_size > 0
        ? ((commission + spreadCost) / (trade.position_size * 100000)) * 100
        : 0,
      timestamp: new Date().toISOString()
    }

    db.logActivity('SHARIAH_FEE_TRACKING', `Fees tracked for ${trade.pair}`, fees)
    return fees
  }

  /**
   * Get overall compliance status for dashboard
   */
  getComplianceStatus() {
    const settings = db.getAllSettings()

    if (!settings.shariahCompliant) {
      return {
        enabled: false,
        message: 'Shariah compliance mode is disabled'
      }
    }

    const swapDeadline = this.checkSwapDeadline()
    const activeTrades = db.getActiveTrades()

    // Calculate total leverage across all positions
    let totalPositionValue = 0
    activeTrades.forEach(trade => {
      totalPositionValue += (trade.position_size || 0) * 100000
    })
    const totalLeverage = settings.accountBalance > 0
      ? totalPositionValue / settings.accountBalance
      : 0

    return {
      enabled: true,
      mode: 'SHARIAH_COMPLIANT',
      settings: {
        maxLeverage: settings.shariahMaxLeverage,
        minConfidence: settings.shariahMinConfidence,
        minIndicatorConfluence: settings.shariahMinIndicatorConfluence,
        intradayOnly: settings.shariahIntradayOnly
      },
      swapDeadline,
      currentLeverage: totalLeverage.toFixed(2),
      maxLeverage: settings.shariahMaxLeverage,
      leverageOK: totalLeverage <= settings.shariahMaxLeverage,
      activeTrades: activeTrades.length,
      tradingAllowed: swapDeadline.tradingAllowed,
      message: swapDeadline.pastCutoff
        ? 'Trading paused - past swap cutoff time'
        : swapDeadline.withinOneHour
        ? `Warning: ${swapDeadline.minutesUntilCutoff} min until swap cutoff`
        : 'All systems halal - الحمد لله'
    }
  }
}

// Singleton instance
export const shariahComplianceService = new ShariahComplianceService()
