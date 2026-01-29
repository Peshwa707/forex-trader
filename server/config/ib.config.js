/**
 * Interactive Brokers Configuration
 * Connection settings and defaults for IB Gateway/TWS
 */

export const IB_CONFIG = {
  // Connection settings
  connection: {
    host: process.env.IB_HOST || '127.0.0.1',
    // Port 7496 for TWS live, 7497 for TWS paper, 4001 for Gateway live, 4002 for Gateway paper
    port: parseInt(process.env.IB_PORT) || 7497,
    clientId: parseInt(process.env.IB_CLIENT_ID) || 1
  },

  // Reconnection settings (Phase D: Solid IB connection monitoring)
  reconnect: {
    enabled: true,
    initialDelayMs: 5000,      // 5 seconds initial delay
    maxDelayMs: 60000,         // 1 minute max (caps backoff at 60s)
    backoffMultiplier: 2,      // Exponential backoff: 5s, 10s, 20s, 40s, 60s
    maxAttempts: 5             // Max 5 reconnection attempts before giving up
  },

  // Trading mode
  mode: {
    // SIMULATION - No IB connection, simulated trades (default)
    // PAPER - IB paper trading account
    // LIVE - Real money trading (requires explicit enable)
    current: process.env.TRADING_MODE || 'SIMULATION',
    allowLive: process.env.ALLOW_LIVE_TRADING === 'true'
  },

  // Forex contract specifications
  forex: {
    exchange: 'IDEALPRO',
    secType: 'CASH',
    currency: 'USD',
    // Supported pairs mapped to IB format
    pairs: {
      'EUR/USD': { symbol: 'EUR', currency: 'USD' },
      'GBP/USD': { symbol: 'GBP', currency: 'USD' },
      'USD/JPY': { symbol: 'USD', currency: 'JPY' },
      'AUD/USD': { symbol: 'AUD', currency: 'USD' },
      'USD/CAD': { symbol: 'USD', currency: 'CAD' },
      'EUR/GBP': { symbol: 'EUR', currency: 'GBP' }
    }
  },

  // Position limits by mode
  positionLimits: {
    SIMULATION: { maxLots: 1.0, maxPositions: 5 },
    PAPER: { maxLots: 1.0, maxPositions: 5 },
    LIVE: { maxLots: 0.1, maxPositions: 3 }  // Conservative for live
  },

  // Risk settings for live trading
  riskLimits: {
    maxDailyLossPercent: 5,    // Kill switch at 5% daily loss
    maxDrawdownPercent: 10,    // Alert at 10% drawdown
    requireConfirmation: true  // Require confirmation for live trades
  },

  // Market data settings
  marketData: {
    genericTickList: '',       // Empty for forex
    snapshot: false,           // Stream continuously
    regulatorySnapshot: false
  }
}

// Validate trading mode
export function validateMode(mode) {
  const validModes = ['SIMULATION', 'PAPER', 'LIVE']
  if (!validModes.includes(mode)) {
    throw new Error(`Invalid trading mode: ${mode}. Must be one of: ${validModes.join(', ')}`)
  }
  if (mode === 'LIVE' && !IB_CONFIG.mode.allowLive) {
    throw new Error('Live trading is not enabled. Set ALLOW_LIVE_TRADING=true to enable.')
  }
  return true
}

// Get position limits for current mode
export function getPositionLimits(mode) {
  return IB_CONFIG.positionLimits[mode] || IB_CONFIG.positionLimits.SIMULATION
}

export default IB_CONFIG
