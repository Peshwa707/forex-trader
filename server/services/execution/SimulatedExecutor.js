/**
 * Simulated Trade Executor
 * Handles trade execution in SIMULATION mode (no real broker)
 *
 * Phase B: ML data collection integration
 * Phase C: Limit order support for better execution
 */

import * as db from '../../database.js'

/**
 * Calculate limit price based on direction and current market
 * For BUY: place limit below current bid (bid - offset)
 * For SELL: place limit above current ask (ask + offset)
 *
 * @param {Object} params - Parameters for calculation
 * @param {string} params.direction - 'UP' (BUY) or 'DOWN' (SELL)
 * @param {string} params.pair - Currency pair (e.g., 'EUR/USD')
 * @param {number} params.bid - Current bid price
 * @param {number} params.ask - Current ask price
 * @param {number} params.offsetPips - Offset in pips (default 0.5)
 * @returns {number} Calculated limit price
 */
export function calculateLimitPrice({ direction, pair, bid, ask, offsetPips = 0.5 }) {
  const pipValue = pair.includes('JPY') ? 0.01 : 0.0001
  const offset = offsetPips * pipValue

  if (direction === 'UP' || direction === 'BUY') {
    // For BUY: place limit below bid to get better fill
    return bid - offset
  } else {
    // For SELL: place limit above ask to get better fill
    return ask + offset
  }
}

// Phase B: Lazy load ML service to avoid circular dependencies
let mlServiceInstance = null
async function getMLService() {
  if (!mlServiceInstance) {
    try {
      const { mlService } = await import('../ml/index.js')
      mlServiceInstance = mlService
    } catch (error) {
      // ML service not available
      return null
    }
  }
  return mlServiceInstance
}

/**
 * SimulatedExecutor - Executes trades in simulation mode
 * Phase B: Now includes ML data collection for training
 */
export class SimulatedExecutor {
  constructor() {
    this.name = 'SIMULATION'
  }

  /**
   * Calculate position size based on risk
   */
  calculatePositionSize(settings, stopLossPips, pair) {
    // Validate inputs
    if (!settings.accountBalance || settings.accountBalance <= 0) {
      console.warn('[SimulatedExecutor] Invalid account balance:', settings.accountBalance)
      return 0
    }
    if (!stopLossPips || stopLossPips <= 0) {
      console.warn('[SimulatedExecutor] Invalid stop loss pips:', stopLossPips)
      return 0
    }

    const riskAmount = settings.accountBalance * (settings.riskPerTrade / 100)
    const pipValuePerLot = pair.includes('JPY') ? 1000 : 10
    const lots = riskAmount / (stopLossPips * pipValuePerLot)
    return Math.min(Math.max(0.01, parseFloat(lots.toFixed(2))), 1)
  }

  /**
   * Execute a trade in simulation mode
   * Phase B: Now captures ML training data
   * Phase C: Supports limit orders for better execution
   *
   * @param {Object} prediction - Trade prediction with entry/stop/take profit
   * @param {Object} settings - Trading settings
   * @param {Object} marketData - Optional market data with bid/ask for limit orders
   */
  async executeTrade(prediction, settings, marketData = null) {
    // Check minimum confidence
    if (prediction.confidence < settings.minConfidence) {
      return { success: false, reason: 'Confidence below minimum' }
    }

    const pipValue = prediction.pair.includes('JPY') ? 0.01 : 0.0001
    const entryPrice = parseFloat(prediction.entryPrice)
    const stopLoss = parseFloat(prediction.stopLoss)

    // Validate price data before proceeding
    if (!entryPrice || isNaN(entryPrice) || entryPrice <= 0) {
      return { success: false, reason: `Invalid entry price: ${prediction.entryPrice}` }
    }
    if (!stopLoss || isNaN(stopLoss) || stopLoss <= 0) {
      return { success: false, reason: `Invalid stop loss: ${prediction.stopLoss}` }
    }

    const stopLossPips = Math.abs(entryPrice - stopLoss) / pipValue

    // Validate stop loss distance (min 1 pip, max 500 pips)
    if (stopLossPips < 1) {
      return { success: false, reason: `Stop loss too tight: ${stopLossPips.toFixed(1)} pips (min: 1)` }
    }
    if (stopLossPips > 500) {
      return { success: false, reason: `Stop loss too wide: ${stopLossPips.toFixed(1)} pips (max: 500)` }
    }

    const positionSize = this.calculatePositionSize(settings, stopLossPips, prediction.pair)

    // Validate position size
    if (!positionSize || positionSize <= 0) {
      return { success: false, reason: 'Cannot calculate valid position size (check account balance)' }
    }

    // Phase C: Determine order type and calculate limit price if needed
    const orderType = settings.orderType || 'MARKET'
    const offsetPips = settings.limitOrderOffsetPips ?? 0.5
    let limitPrice = null
    let actualOrderType = orderType
    let fallbackReason = null

    if (orderType === 'LIMIT') {
      if (marketData && marketData.bid && marketData.ask) {
        limitPrice = calculateLimitPrice({
          direction: prediction.direction,
          pair: prediction.pair,
          bid: marketData.bid,
          ask: marketData.ask,
          offsetPips
        })
      } else {
        // Fall back to market order if no bid/ask available
        actualOrderType = 'MARKET'
        fallbackReason = 'No bid/ask data available'
      }
    }

    // Phase A: Include trade context for pattern analysis
    const now = new Date()
    const trade = {
      pair: prediction.pair,
      direction: prediction.direction,
      signal: prediction.signal,
      entryPrice: limitPrice || prediction.entryPrice, // Use limit price if available
      stopLoss: prediction.stopLoss,
      takeProfit: prediction.takeProfit,
      trailingStop: settings.useTrailingStop ? prediction.stopLoss : null,
      positionSize,
      confidence: prediction.confidence,
      reasoning: prediction.reasoning,
      context: {
        rsi: prediction.indicators?.rsi ? parseFloat(prediction.indicators.rsi) : null,
        macd: prediction.indicators?.macd ? parseFloat(prediction.indicators.macd) : null,
        trend: prediction.indicators?.trend ?? null,
        atr: prediction._analysis?.indicators?.atr ?? null,
        spread: marketData ? (marketData.ask - marketData.bid) : null,
        hourOfDay: now.getUTCHours(),
        dayOfWeek: now.getUTCDay(),
        marketSession: db.getMarketSession(now),
        volatilityLevel: prediction._mlFeatures?.recentVolatility
          ? (prediction._mlFeatures.recentVolatility > 0.002 ? 'HIGH' : 'NORMAL')
          : null
      }
    }

    const createdTrade = db.createTrade(trade)

    // Phase B: Capture ML training data
    try {
      const ml = await getMLService()
      if (ml && prediction._analysis) {
        ml.captureTradeEntry(
          { ...trade, id: createdTrade.id },
          prediction._analysis,
          prediction.mlPrediction
        )
      }
    } catch (error) {
      console.warn('[SimulatedExecutor] ML data capture failed:', error.message)
    }

    db.logActivity('TRADE_OPENED', `[SIM] Opened ${prediction.signal} ${prediction.pair}`, {
      tradeId: createdTrade.id,
      confidence: prediction.confidence,
      mode: 'SIMULATION',
      mlOptimized: prediction.mlPrediction?.useML ?? false,
      orderType: actualOrderType,
      limitPrice: limitPrice
    })

    // Phase C: Return order type information
    const result = {
      success: true,
      trade: createdTrade,
      mode: 'SIMULATION',
      orderType: actualOrderType
    }

    if (limitPrice !== null) {
      result.limitPrice = limitPrice
    }

    if (fallbackReason) {
      result.fallbackReason = fallbackReason
    }

    return result
  }

  /**
   * Update trade with current price
   * Phase B: Now tracks max favorable/adverse excursion for ML training
   */
  async updateTradePrice(trade, currentPrice) {
    const current = parseFloat(currentPrice)
    const entry = parseFloat(trade.entry_price)
    const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

    // Calculate P/L
    let pnlPips
    if (trade.direction === 'UP') {
      pnlPips = (current - entry) / pipValue
    } else {
      pnlPips = (entry - current) / pipValue
    }

    // Phase B: Update ML excursion tracking
    try {
      const ml = await getMLService()
      if (ml) {
        ml.updateExcursion(trade.id, pnlPips)
      }
    } catch (error) {
      // Silent fail - excursion tracking is optional
    }

    // Estimate P/L in dollars
    const pipValuePerLot = trade.pair.includes('JPY') ? 1000 : 10
    const pnl = pnlPips * trade.position_size * pipValuePerLot

    // Update trailing stop if enabled
    const settings = db.getAllSettings()
    let trailingStop = trade.trailing_stop

    if (settings.useTrailingStop && pnlPips > settings.trailingStopPips) {
      if (trade.direction === 'UP') {
        const newStop = current - (settings.trailingStopPips * pipValue)
        trailingStop = Math.max(parseFloat(trade.stop_loss), newStop)
      } else {
        const newStop = current + (settings.trailingStopPips * pipValue)
        trailingStop = Math.min(parseFloat(trade.stop_loss), newStop)
      }
    }

    db.updateTrade(trade.id, {
      currentPrice: current,
      pnlPips: parseFloat(pnlPips.toFixed(1)),
      pnl: parseFloat(pnl.toFixed(2)),
      trailingStop
    })

    return { pnlPips, pnl, trailingStop }
  }

  /**
   * Check if trade should be closed (hit TP/SL)
   * Phase B: Now async for ML integration
   */
  async checkTradeExit(trade, currentPrice) {
    const current = parseFloat(currentPrice)
    const stopLoss = parseFloat(trade.trailing_stop || trade.stop_loss)
    const takeProfit = parseFloat(trade.take_profit)

    let shouldClose = false
    let closeReason = null

    if (trade.direction === 'UP') {
      if (current <= stopLoss) {
        shouldClose = true
        closeReason = 'STOP_LOSS'
      } else if (current >= takeProfit) {
        shouldClose = true
        closeReason = 'TAKE_PROFIT'
      }
    } else {
      if (current >= stopLoss) {
        shouldClose = true
        closeReason = 'STOP_LOSS'
      } else if (current <= takeProfit) {
        shouldClose = true
        closeReason = 'TAKE_PROFIT'
      }
    }

    if (shouldClose) {
      return await this.closeTrade(trade.id, currentPrice, closeReason)
    }

    return null
  }

  /**
   * Close a trade
   * Phase B: Now captures ML training outcome data
   */
  async closeTrade(tradeId, exitPrice, reason = 'MANUAL') {
    const trade = db.getTradeById(tradeId)
    if (!trade || trade.status !== 'OPEN') return null

    const exit = parseFloat(exitPrice)
    const entry = parseFloat(trade.entry_price)
    const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

    // Final P/L calculation
    let pnlPips
    if (trade.direction === 'UP') {
      pnlPips = (exit - entry) / pipValue
    } else {
      pnlPips = (entry - exit) / pipValue
    }

    const pipValuePerLot = trade.pair.includes('JPY') ? 1000 : 10
    const pnl = pnlPips * trade.position_size * pipValuePerLot

    // Phase B: Capture ML training outcome
    try {
      const ml = await getMLService()
      if (ml) {
        const tpPips = Math.abs(parseFloat(trade.take_profit) - entry) / pipValue
        ml.captureTradeOutcome(tradeId, {
          pnlPips,
          closeReason: reason,
          tpPips
        })
      }
    } catch (error) {
      console.warn('[SimulatedExecutor] ML outcome capture failed:', error.message)
    }

    const closedTrade = db.closeTrade(tradeId, exit, reason, pnlPips, pnl)

    // Update account balance
    const settings = db.getAllSettings()
    db.saveSetting('accountBalance', settings.accountBalance + pnl)

    db.logActivity('TRADE_CLOSED', `[SIM] Closed ${trade.pair} - ${reason}`, {
      tradeId,
      pnl: pnl.toFixed(2),
      pnlPips: pnlPips.toFixed(1),
      reason,
      mode: 'SIMULATION'
    })

    return closedTrade
  }

  /**
   * Close all active trades
   * Phase B: Now async for ML integration
   */
  async closeAllTrades(currentPrices) {
    const activeTrades = db.getActiveTrades()
    const closed = []

    for (const trade of activeTrades) {
      const price = currentPrices[trade.pair]
      if (price) {
        const result = await this.closeTrade(trade.id, price, 'CLOSE_ALL')
        if (result) closed.push(result)
      }
    }

    return closed
  }

  /**
   * Update all active trades with current prices
   * Phase B: Now async for ML integration
   */
  async updateAllTrades(currentPrices) {
    const activeTrades = db.getActiveTrades()
    const results = {
      updated: [],
      closed: []
    }

    for (const trade of activeTrades) {
      const price = currentPrices[trade.pair]
      if (price) {
        // First update the price (async for ML excursion tracking)
        await this.updateTradePrice(trade, price)

        // Then check for exit
        const exitResult = await this.checkTradeExit(trade, price)
        if (exitResult) {
          results.closed.push(exitResult)
        } else {
          results.updated.push(trade)
        }
      }
    }

    return results
  }
}

// Singleton
export const simulatedExecutor = new SimulatedExecutor()
export default simulatedExecutor
