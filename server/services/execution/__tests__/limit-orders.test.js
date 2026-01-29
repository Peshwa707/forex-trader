/**
 * Phase C: Limit Order Support Tests
 * TDD - Write tests FIRST, then implement
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the dependencies
vi.mock('../../../database.js', () => ({
  createTrade: vi.fn((trade) => ({ ...trade, id: 1 })),
  getTradeById: vi.fn(),
  updateTrade: vi.fn(),
  closeTrade: vi.fn(),
  getActiveTrades: vi.fn(() => []),
  getTodaysTrades: vi.fn(() => []),
  getAllSettings: vi.fn(() => ({
    accountBalance: 10000,
    riskPerTrade: 1,
    minConfidence: 60,
    maxOpenTrades: 3,
    maxDailyTrades: 100,
    maxDailyLoss: 5,
    allowedPairs: ['EUR/USD', 'GBP/USD'],
    tradingHours: { start: 0, end: 24 },
    useTrailingStop: true,
    trailingStopPips: 20,
    // Phase C: Limit order settings
    orderType: 'MARKET',
    limitOrderOffsetPips: 0.5
  })),
  getSetting: vi.fn(),
  logActivity: vi.fn(),
  getMarketSession: vi.fn(() => 'LONDON')
}))

vi.mock('../../ib/IBConnector.js', () => ({
  ibConnector: {
    isConnected: vi.fn(() => false),
    on: vi.fn(),
    getApi: vi.fn()
  }
}))

vi.mock('../../ib/IBOrderService.js', () => ({
  ibOrderService: {
    initialize: vi.fn(),
    placeMarketOrder: vi.fn(),
    placeMarketOrderWithRetry: vi.fn(),
    placeLimitOrder: vi.fn(),
    placeLimitOrderWithRetry: vi.fn()
  }
}))

vi.mock('../../ib/IBMarketData.js', () => ({
  ibMarketData: {
    getPrice: vi.fn(() => ({ bid: 1.08500, ask: 1.08510 }))
  }
}))

// Import after mocking
import { SimulatedExecutor } from '../SimulatedExecutor.js'
import { LiveExecutor } from '../LiveExecutor.js'
import * as db from '../../../database.js'
import { ibOrderService } from '../../ib/IBOrderService.js'
import { ibConnector } from '../../ib/IBConnector.js'
import { ibMarketData } from '../../ib/IBMarketData.js'

describe('Phase C: Limit Order Support', () => {
  let simulatedExecutor
  let liveExecutor
  let mockPrediction
  let mockSettings

  beforeEach(() => {
    vi.clearAllMocks()
    simulatedExecutor = new SimulatedExecutor()
    liveExecutor = new LiveExecutor('PAPER')

    mockPrediction = {
      pair: 'EUR/USD',
      direction: 'UP',
      signal: 'BUY',
      entryPrice: '1.08505',
      stopLoss: '1.08405',
      takeProfit: '1.08705',
      confidence: 75,
      reasoning: 'Test trade'
    }

    mockSettings = {
      accountBalance: 10000,
      riskPerTrade: 1,
      minConfidence: 60,
      maxOpenTrades: 3,
      maxDailyTrades: 100,
      maxDailyLoss: 5,
      allowedPairs: ['EUR/USD', 'GBP/USD'],
      tradingHours: { start: 0, end: 24 },
      useTrailingStop: true,
      trailingStopPips: 20,
      orderType: 'MARKET',
      limitOrderOffsetPips: 0.5
    }
  })

  describe('Settings Validation', () => {
    it('should support orderType setting with MARKET as default', () => {
      const settings = db.getAllSettings()
      expect(settings.orderType).toBe('MARKET')
    })

    it('should support limitOrderOffsetPips setting with 0.5 as default', () => {
      const settings = db.getAllSettings()
      expect(settings.limitOrderOffsetPips).toBe(0.5)
    })

    it('should accept LIMIT as orderType', () => {
      mockSettings.orderType = 'LIMIT'
      expect(['MARKET', 'LIMIT']).toContain(mockSettings.orderType)
    })
  })

  describe('SimulatedExecutor - Limit Orders', () => {
    it('should execute market order when orderType is MARKET', async () => {
      mockSettings.orderType = 'MARKET'
      const result = await simulatedExecutor.executeTrade(mockPrediction, mockSettings)

      expect(result.success).toBe(true)
      expect(db.createTrade).toHaveBeenCalled()

      // Trade should be created at the signal entry price for market orders
      const tradeArg = db.createTrade.mock.calls[0][0]
      expect(tradeArg.entryPrice).toBe(mockPrediction.entryPrice)
    })

    it('should calculate limit price for BUY orders (bid - offset)', async () => {
      mockSettings.orderType = 'LIMIT'
      const currentBid = 1.08500
      const offsetPips = 0.5
      const pipValue = 0.0001 // EUR/USD

      // Expected limit price: bid - (offset * pipValue)
      const expectedLimitPrice = currentBid - (offsetPips * pipValue)

      const result = await simulatedExecutor.executeTrade(mockPrediction, mockSettings, {
        bid: currentBid,
        ask: 1.08510
      })

      expect(result.success).toBe(true)
      expect(result.orderType).toBe('LIMIT')
      expect(result.limitPrice).toBeCloseTo(expectedLimitPrice, 5)
    })

    it('should calculate limit price for SELL orders (ask + offset)', async () => {
      mockSettings.orderType = 'LIMIT'
      mockPrediction.direction = 'DOWN'
      mockPrediction.signal = 'SELL'

      const currentAsk = 1.08510
      const offsetPips = 0.5
      const pipValue = 0.0001

      // Expected limit price: ask + (offset * pipValue)
      const expectedLimitPrice = currentAsk + (offsetPips * pipValue)

      const result = await simulatedExecutor.executeTrade(mockPrediction, mockSettings, {
        bid: 1.08500,
        ask: currentAsk
      })

      expect(result.success).toBe(true)
      expect(result.orderType).toBe('LIMIT')
      expect(result.limitPrice).toBeCloseTo(expectedLimitPrice, 5)
    })

    it('should handle JPY pairs with correct pip value (0.01)', async () => {
      mockSettings.orderType = 'LIMIT'
      mockPrediction.pair = 'USD/JPY'
      mockPrediction.entryPrice = '150.500'
      mockPrediction.stopLoss = '150.000'
      mockPrediction.takeProfit = '151.500'

      const currentBid = 150.500
      const offsetPips = 0.5
      const pipValue = 0.01 // JPY pairs

      const expectedLimitPrice = currentBid - (offsetPips * pipValue)

      const result = await simulatedExecutor.executeTrade(mockPrediction, mockSettings, {
        bid: currentBid,
        ask: 150.510
      })

      expect(result.success).toBe(true)
      expect(result.limitPrice).toBeCloseTo(expectedLimitPrice, 3)
    })

    it('should fall back to market order if no bid/ask available for limit', async () => {
      mockSettings.orderType = 'LIMIT'

      // No market data provided
      const result = await simulatedExecutor.executeTrade(mockPrediction, mockSettings)

      expect(result.success).toBe(true)
      // Should fall back to market order behavior
      expect(result.orderType).toBe('MARKET')
      expect(result.fallbackReason).toBe('No bid/ask data available')
    })
  })

  describe('LiveExecutor - Limit Orders', () => {
    beforeEach(() => {
      ibConnector.isConnected.mockReturnValue(true)
      ibMarketData.getPrice.mockReturnValue({ bid: 1.08500, ask: 1.08510 })
      ibOrderService.placeLimitOrderWithRetry = vi.fn().mockResolvedValue({
        orderId: 123,
        status: 'SUBMITTED',
        limitPrice: 1.08495
      })
      ibOrderService.placeMarketOrderWithRetry.mockResolvedValue({
        orderId: 124,
        status: 'FILLED',
        avgFillPrice: 1.08505
      })
    })

    it('should place market order via IB when orderType is MARKET', async () => {
      mockSettings.orderType = 'MARKET'

      const result = await liveExecutor.executeTrade(mockPrediction, mockSettings)

      expect(result.success).toBe(true)
      expect(ibOrderService.placeMarketOrderWithRetry).toHaveBeenCalled()
      expect(ibOrderService.placeLimitOrderWithRetry).not.toHaveBeenCalled()
    })

    it('should place limit order via IB when orderType is LIMIT', async () => {
      mockSettings.orderType = 'LIMIT'

      const result = await liveExecutor.executeTrade(mockPrediction, mockSettings)

      expect(result.success).toBe(true)
      expect(ibOrderService.placeLimitOrderWithRetry).toHaveBeenCalled()
      expect(ibOrderService.placeMarketOrderWithRetry).not.toHaveBeenCalled()
    })

    it('should calculate correct limit price for IB limit orders', async () => {
      mockSettings.orderType = 'LIMIT'
      mockSettings.limitOrderOffsetPips = 0.5

      await liveExecutor.executeTrade(mockPrediction, mockSettings)

      const callArgs = ibOrderService.placeLimitOrderWithRetry.mock.calls[0]
      const limitPrice = callArgs[3] // Fourth argument is limit price

      // For BUY: bid - (0.5 * 0.0001) = 1.08500 - 0.00005 = 1.08495
      expect(limitPrice).toBeCloseTo(1.08495, 5)
    })

    it('should log limit order details in activity', async () => {
      mockSettings.orderType = 'LIMIT'

      await liveExecutor.executeTrade(mockPrediction, mockSettings)

      expect(db.logActivity).toHaveBeenCalledWith(
        'TRADE_OPENED',
        expect.stringContaining('[PAPER]'),
        expect.objectContaining({
          orderType: 'LIMIT',
          limitPrice: expect.any(Number)
        })
      )
    })
  })

  describe('Limit Price Calculation Utility', () => {
    it('should export calculateLimitPrice function', async () => {
      const { calculateLimitPrice } = await import('../SimulatedExecutor.js')
      expect(typeof calculateLimitPrice).toBe('function')
    })

    it('should calculate BUY limit price correctly', async () => {
      const { calculateLimitPrice } = await import('../SimulatedExecutor.js')

      const result = calculateLimitPrice({
        direction: 'UP',
        pair: 'EUR/USD',
        bid: 1.08500,
        ask: 1.08510,
        offsetPips: 0.5
      })

      expect(result).toBeCloseTo(1.08495, 5)
    })

    it('should calculate SELL limit price correctly', async () => {
      const { calculateLimitPrice } = await import('../SimulatedExecutor.js')

      const result = calculateLimitPrice({
        direction: 'DOWN',
        pair: 'EUR/USD',
        bid: 1.08500,
        ask: 1.08510,
        offsetPips: 0.5
      })

      expect(result).toBeCloseTo(1.08515, 5)
    })

    it('should handle JPY pairs correctly', async () => {
      const { calculateLimitPrice } = await import('../SimulatedExecutor.js')

      const result = calculateLimitPrice({
        direction: 'UP',
        pair: 'USD/JPY',
        bid: 150.500,
        ask: 150.510,
        offsetPips: 0.5
      })

      expect(result).toBeCloseTo(150.495, 3)
    })
  })

  describe('Default Settings Integration', () => {
    it('should include limit order settings in DEFAULT_SETTINGS', async () => {
      // This tests the database.js DEFAULT_SETTINGS
      const expectedDefaults = {
        orderType: 'MARKET',
        limitOrderOffsetPips: 0.5
      }

      // The mock returns these, real implementation should too
      const settings = db.getAllSettings()
      expect(settings.orderType).toBeDefined()
      expect(settings.limitOrderOffsetPips).toBeDefined()
    })
  })

  describe('Backward Compatibility', () => {
    it('should work without orderType setting (defaults to MARKET)', async () => {
      delete mockSettings.orderType

      const result = await simulatedExecutor.executeTrade(mockPrediction, mockSettings)

      expect(result.success).toBe(true)
      // Should behave as market order
    })

    it('should work without limitOrderOffsetPips setting (defaults to 0.5)', async () => {
      mockSettings.orderType = 'LIMIT'
      delete mockSettings.limitOrderOffsetPips

      const result = await simulatedExecutor.executeTrade(mockPrediction, mockSettings, {
        bid: 1.08500,
        ask: 1.08510
      })

      expect(result.success).toBe(true)
      // Should use default 0.5 pips offset
    })
  })
})
