/**
 * Live Trade Executor
 * Handles trade execution via Interactive Brokers (PAPER/LIVE modes)
 */

import * as db from '../../database.js'
import { ibConnector } from '../ib/IBConnector.js'
import { ibOrderService } from '../ib/IBOrderService.js'
import { ibAccountService } from '../ib/IBAccountService.js'
import { ibMarketData } from '../ib/IBMarketData.js'
import { IB_CONFIG, getPositionLimits } from '../../config/ib.config.js'

// Spread filter configuration
const SPREAD_CONFIG = {
  maxSpreadPips: {
    default: 3,
    'EUR/USD': 2,
    'GBP/USD': 2.5,
    'USD/JPY': 2,
    'USD/CHF': 3,
    'AUD/USD': 2.5,
    'USD/CAD': 3,
    'EUR/GBP': 3,
    'EUR/JPY': 3.5,
    'GBP/JPY': 4,
    'XAU/USD': 50,  // Gold has wider spreads
    'XAG/USD': 5    // Silver
  }
}

/**
 * LiveExecutor - Executes trades via IB
 */
export class LiveExecutor {
  constructor(mode = 'PAPER') {
    this.mode = mode // PAPER or LIVE
    this.name = mode
  }

  /**
   * Set execution mode
   */
  setMode(mode) {
    if (mode !== 'PAPER' && mode !== 'LIVE') {
      throw new Error('LiveExecutor mode must be PAPER or LIVE')
    }
    this.mode = mode
    this.name = mode
  }

  /**
   * Check if IB is ready for trading
   */
  isReady() {
    return ibConnector.isConnected()
  }

  /**
   * Get max spread for a pair
   * @param {string} pair - Currency pair
   * @returns {number} Max spread in pips
   */
  getMaxSpreadPips(pair) {
    return SPREAD_CONFIG.maxSpreadPips[pair] || SPREAD_CONFIG.maxSpreadPips.default
  }

  /**
   * Check if spread is acceptable for trading
   * @param {string} pair - Currency pair
   * @param {number} bid - Bid price
   * @param {number} ask - Ask price
   * @returns {{ acceptable: boolean, spreadPips: number, maxAllowed: number, reason?: string }}
   */
  checkSpread(pair, bid, ask) {
    if (!bid || !ask || bid <= 0 || ask <= 0) {
      return {
        acceptable: false,
        spreadPips: null,
        maxAllowed: this.getMaxSpreadPips(pair),
        reason: 'Invalid bid/ask prices'
      }
    }

    const pipValue = pair.includes('JPY') ? 0.01 : 0.0001
    const spreadPips = (ask - bid) / pipValue
    const maxAllowed = this.getMaxSpreadPips(pair)
    const acceptable = spreadPips <= maxAllowed

    if (!acceptable) {
      db.logActivity('SPREAD_TOO_WIDE', `Skipping ${pair} trade due to spread`, {
        pair,
        spreadPips: spreadPips.toFixed(1),
        maxAllowed,
        bid,
        ask
      })
    }

    return {
      acceptable,
      spreadPips,
      maxAllowed,
      reason: acceptable ? null : `Spread ${spreadPips.toFixed(1)} pips exceeds max ${maxAllowed} pips`
    }
  }

  /**
   * Get current bid/ask spread from market data
   * @param {string} pair - Currency pair
   * @returns {Promise<{ bid: number, ask: number } | null>}
   */
  async getCurrentSpread(pair) {
    try {
      // Use getPrice instead of getQuote (ibMarketData uses getPrice)
      const marketData = ibMarketData.getPrice(pair)
      if (marketData && marketData.bid && marketData.ask) {
        return { bid: marketData.bid, ask: marketData.ask }
      }
      return null
    } catch (error) {
      console.warn(`Failed to get spread for ${pair}:`, error.message)
      return null
    }
  }

  /**
   * Calculate limit price based on direction and current market
   * Phase C: Better Execution
   * For BUY: place limit below current bid (bid - offset)
   * For SELL: place limit above current ask (ask + offset)
   */
  calculateLimitPrice(direction, pair, bid, ask, offsetPips) {
    const pipValue = pair.includes('JPY') ? 0.01 : 0.0001
    const offset = offsetPips * pipValue

    if (direction === 'UP' || direction === 'BUY') {
      return bid - offset
    } else {
      return ask + offset
    }
  }

  /**
   * Calculate position size based on risk
   */
  calculatePositionSize(settings, stopLossPips, pair) {
    // Validate inputs
    if (!settings.accountBalance || settings.accountBalance <= 0) {
      console.warn('[LiveExecutor] Invalid account balance:', settings.accountBalance)
      return 0
    }
    if (!stopLossPips || stopLossPips <= 0) {
      console.warn('[LiveExecutor] Invalid stop loss pips:', stopLossPips)
      return 0
    }

    const limits = getPositionLimits(this.mode)
    const riskAmount = settings.accountBalance * (settings.riskPerTrade / 100)
    const pipValuePerLot = pair.includes('JPY') ? 1000 : 10
    let lots = riskAmount / (stopLossPips * pipValuePerLot)

    // Apply mode-specific limits
    lots = Math.min(Math.max(0.01, parseFloat(lots.toFixed(2))), limits.maxLots)

    return lots
  }

  /**
   * Execute a trade via IB
   * Phase C: Supports limit orders for better execution
   */
  async executeTrade(prediction, settings) {
    if (!this.isReady()) {
      return { success: false, reason: 'IB not connected', fallbackToSim: true }
    }

    // Check minimum confidence
    if (prediction.confidence < settings.minConfidence) {
      return { success: false, reason: 'Confidence below minimum' }
    }

    // Check spread before executing (spread filter)
    const spreadData = await this.getCurrentSpread(prediction.pair)
    if (spreadData) {
      const spreadCheck = this.checkSpread(prediction.pair, spreadData.bid, spreadData.ask)
      if (!spreadCheck.acceptable) {
        return {
          success: false,
          reason: spreadCheck.reason,
          spreadPips: spreadCheck.spreadPips,
          skippedDueToSpread: true
        }
      }
      console.log(`Spread check passed for ${prediction.pair}: ${spreadCheck.spreadPips.toFixed(1)} pips (max: ${spreadCheck.maxAllowed})`)
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

    if (orderType === 'LIMIT' && spreadData) {
      limitPrice = this.calculateLimitPrice(
        prediction.direction,
        prediction.pair,
        spreadData.bid,
        spreadData.ask,
        offsetPips
      )
    }

    // Create local trade record first
    const localTrade = {
      pair: prediction.pair,
      direction: prediction.direction,
      signal: prediction.signal,
      entryPrice: limitPrice || prediction.entryPrice,
      stopLoss: prediction.stopLoss,
      takeProfit: prediction.takeProfit,
      trailingStop: settings.useTrailingStop ? prediction.stopLoss : null,
      positionSize,
      confidence: prediction.confidence,
      reasoning: prediction.reasoning
    }

    const createdTrade = db.createTrade(localTrade)

    try {
      // Place order via IB with retry logic and slippage check
      ibOrderService.initialize()

      let orderResult

      // Phase C: Place either limit or market order based on settings
      if (orderType === 'LIMIT' && limitPrice !== null) {
        // Place limit order
        orderResult = await ibOrderService.placeLimitOrderWithRetry(
          prediction.pair,
          prediction.direction,
          positionSize,
          limitPrice,
          createdTrade.id
        )
      } else {
        // Place market order (default)
        orderResult = await ibOrderService.placeMarketOrderWithRetry(
          prediction.pair,
          prediction.direction,
          positionSize,
          createdTrade.id,
          entryPrice // Pass expected price for slippage check
        )
      }

      db.logActivity('TRADE_OPENED', `[${this.mode}] Opened ${prediction.signal} ${prediction.pair}`, {
        tradeId: createdTrade.id,
        ibOrderId: orderResult.orderId,
        confidence: prediction.confidence,
        mode: this.mode,
        avgFillPrice: orderResult.avgFillPrice,
        slippage: orderResult.slippageCheck ? orderResult.slippageCheck.slippagePips : null,
        orderType: orderType === 'LIMIT' && limitPrice !== null ? 'LIMIT' : 'MARKET',
        limitPrice: limitPrice
      })

      // Update trade with actual fill price if available
      if (orderResult.avgFillPrice) {
        db.updateTrade(createdTrade.id, {
          entryPrice: orderResult.avgFillPrice
        })
      }

      return {
        success: true,
        trade: createdTrade,
        ibOrder: orderResult,
        mode: this.mode,
        orderType: orderType === 'LIMIT' && limitPrice !== null ? 'LIMIT' : 'MARKET',
        limitPrice: limitPrice
      }

    } catch (error) {
      // Get error message safely
      const errorMsg = error?.message || error?.toString?.() || String(error) || 'Unknown error'
      console.error(`[${this.mode}] Trade execution error:`, error)

      // Log the error but keep the trade record (mark as failed)
      db.logActivity('TRADE_ERROR', `[${this.mode}] Failed to execute ${prediction.pair}: ${errorMsg}`, {
        tradeId: createdTrade.id,
        error: errorMsg,
        mode: this.mode
      })

      // Close the local trade record as it wasn't executed
      db.closeTrade(createdTrade.id, prediction.entryPrice, 'FAILED', 0, 0)

      return { success: false, reason: errorMsg, tradeId: createdTrade.id }
    }
  }

  /**
   * Update trade with current price from IB
   */
  updateTradePrice(trade, currentPrice) {
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
   * In live mode, we may want to let IB handle this via bracket orders
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
   * Close a trade via IB
   */
  async closeTrade(tradeId, exitPrice, reason = 'MANUAL') {
    const trade = db.getTradeById(tradeId)
    if (!trade || trade.status !== 'OPEN') return null

    if (!this.isReady()) {
      // Fall back to simulated close if IB disconnected
      return this.simulatedClose(trade, exitPrice, reason)
    }

    try {
      // Place closing order via IB
      const closeDirection = trade.direction === 'UP' ? 'DOWN' : 'UP'

      ibOrderService.initialize()
      const orderResult = await ibOrderService.placeMarketOrder(
        trade.pair,
        closeDirection,
        trade.position_size,
        trade.id
      )

      const actualExitPrice = orderResult.avgFillPrice || exitPrice
      return this.finalizeClose(trade, actualExitPrice, reason)

    } catch (error) {
      db.logActivity('TRADE_CLOSE_ERROR', `[${this.mode}] Failed to close ${trade.pair}: ${error.message}`, {
        tradeId,
        error: error.message
      })

      // Fall back to simulated close to keep records consistent
      return this.simulatedClose(trade, exitPrice, reason)
    }
  }

  /**
   * Finalize trade close (update records)
   */
  finalizeClose(trade, exitPrice, reason) {
    const exit = parseFloat(exitPrice)
    const entry = parseFloat(trade.entry_price)
    const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001

    let pnlPips
    if (trade.direction === 'UP') {
      pnlPips = (exit - entry) / pipValue
    } else {
      pnlPips = (entry - exit) / pipValue
    }

    const pipValuePerLot = trade.pair.includes('JPY') ? 1000 : 10
    const pnl = pnlPips * trade.position_size * pipValuePerLot

    const closedTrade = db.closeTrade(trade.id, exit, reason, pnlPips, pnl)

    // Update account balance
    const settings = db.getAllSettings()
    db.saveSetting('accountBalance', settings.accountBalance + pnl)

    db.logActivity('TRADE_CLOSED', `[${this.mode}] Closed ${trade.pair} - ${reason}`, {
      tradeId: trade.id,
      pnl: pnl.toFixed(2),
      pnlPips: pnlPips.toFixed(1),
      reason,
      mode: this.mode
    })

    return closedTrade
  }

  /**
   * Simulated close when IB unavailable
   */
  simulatedClose(trade, exitPrice, reason) {
    db.logActivity('TRADE_CLOSE_FALLBACK', `[${this.mode}] Using simulated close for ${trade.pair}`, {
      tradeId: trade.id,
      reason: 'IB unavailable'
    })
    return this.finalizeClose(trade, exitPrice, reason + '_SIM')
  }

  /**
   * Close all active trades
   */
  async closeAllTrades(currentPrices) {
    const activeTrades = db.getActiveTrades()
    const closed = []

    for (const trade of activeTrades) {
      const price = currentPrices[trade.pair]
      if (price) {
        try {
          const result = await this.closeTrade(trade.id, price, 'CLOSE_ALL')
          if (result) closed.push(result)
        } catch (error) {
          console.error(`Failed to close trade ${trade.id}:`, error.message)
        }
      }
    }

    return closed
  }

  /**
   * Update all active trades with current prices
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
        // First update the price
        this.updateTradePrice(trade, price)

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

// Singletons for PAPER and LIVE
export const paperExecutor = new LiveExecutor('PAPER')
export const liveExecutor = new LiveExecutor('LIVE')
export default LiveExecutor
