/**
 * API Service for Frontend
 * Connects to the backend trading bot server
 */

const API_BASE = import.meta.env.VITE_API_URL || ''
const DEFAULT_TIMEOUT_MS = 30000 // 30 second timeout

async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE}/api${endpoint}`
  const timeoutMs = options.timeout || DEFAULT_TIMEOUT_MS

  // Create AbortController for timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options,
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      console.error(`API Timeout (${endpoint}): Request took longer than ${timeoutMs}ms`)
      throw new Error(`Request timeout after ${timeoutMs}ms`)
    }
    console.error(`API Error (${endpoint}):`, error.message)
    throw error
  }
}

// Bot control
export const botApi = {
  getStatus: () => fetchAPI('/bot/status'),
  start: () => fetchAPI('/bot/start', { method: 'POST' }),
  stop: () => fetchAPI('/bot/stop', { method: 'POST' }),
  runCycle: () => fetchAPI('/bot/run', { method: 'POST' })
}

// Prices
export const pricesApi = {
  getLive: () => fetchAPI('/prices'),
  getHistory: (pair, limit = 100) =>
    fetchAPI(`/prices/${pair.replace('/', '-')}/history?limit=${limit}`)
}

// Trades
export const tradesApi = {
  getActive: () => fetchAPI('/trades'),
  getHistory: (limit = 100) => fetchAPI(`/trades/history?limit=${limit}`),
  close: (id) => fetchAPI(`/trades/${id}/close`, { method: 'POST' }),
  closeAll: () => fetchAPI('/trades/close-all', { method: 'POST' })
}

// Settings
export const settingsApi = {
  get: () => fetchAPI('/settings'),
  update: (settings) => fetchAPI('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings)
  })
}

// Statistics
export const statsApi = {
  get: () => fetchAPI('/stats'),
  getPredictions: (limit = 100) => fetchAPI(`/predictions?limit=${limit}`),
  getActivity: (limit = 50) => fetchAPI(`/activity?limit=${limit}`),
  getExplanations: (limit = 20) => fetchAPI(`/explanations?limit=${limit}`)
}

// Account
export const accountApi = {
  reset: (balance = 10000) => fetchAPI('/account/reset', {
    method: 'POST',
    body: JSON.stringify({ balance })
  }),
  export: () => fetchAPI('/export')
}

// Health check
export const healthApi = {
  check: () => fetchAPI('/health')
}

// Interactive Brokers
export const ibApi = {
  getStatus: () => fetchAPI('/ib/status'),
  connect: () => fetchAPI('/ib/connect', { method: 'POST' }),
  disconnect: () => fetchAPI('/ib/disconnect', { method: 'POST' }),
  getAccount: () => fetchAPI('/ib/account'),
  getAccountStatus: () => fetchAPI('/ib/account/status'),
  subscribeAccount: () => fetchAPI('/ib/account/subscribe', { method: 'POST' }),
  getPositions: () => fetchAPI('/ib/positions')
}

// Mode control
export const modeApi = {
  get: () => fetchAPI('/mode'),
  set: (mode) => fetchAPI('/mode', {
    method: 'PUT',
    body: JSON.stringify({ mode })
  }),
  killswitch: (closeAll = false) => fetchAPI('/killswitch', {
    method: 'POST',
    body: JSON.stringify({ closeAllTrades: closeAll })
  })
}

// Risk management
export const riskApi = {
  getStatus: () => fetchAPI('/risk/status'),
  getDashboard: () => fetchAPI('/risk/dashboard'),
  reset: () => fetchAPI('/risk/reset', { method: 'POST' })
}

// Analytics (Phase A: Trust Foundation)
export const analyticsApi = {
  getSummary: () => fetchAPI('/analytics'),
  getPatterns: (minTrades = 10) => fetchAPI(`/analytics/patterns?minTrades=${minTrades}`),
  getByHour: () => fetchAPI('/analytics/by-hour'),
  getByDay: () => fetchAPI('/analytics/by-day'),
  getBySession: () => fetchAPI('/analytics/by-session'),
  getByRSI: () => fetchAPI('/analytics/by-rsi'),
  getByPair: () => fetchAPI('/analytics/by-pair'),
  getByTrend: () => fetchAPI('/analytics/by-trend'),
  getConfidenceAdjustment: (context) => fetchAPI('/analytics/confidence-adjustment', {
    method: 'POST',
    body: JSON.stringify(context)
  }),
  refreshPatterns: () => fetchAPI('/analytics/refresh-patterns', { method: 'POST' })
}

// Backtesting (Phase A: Trust Foundation)
export const backtestApi = {
  getPairs: () => fetchAPI('/backtest/pairs'),
  getDateRange: (pair) => fetchAPI(`/backtest/range/${pair.replace('/', '-')}`),
  prepareData: (pair, startDate, endDate) => fetchAPI('/backtest/prepare', {
    method: 'POST',
    body: JSON.stringify({ pair, startDate, endDate })
  }),
  run: (config) => fetchAPI('/backtest/run', {
    method: 'POST',
    body: JSON.stringify(config),
    timeout: 120000 // 2 minute timeout for long backtests
  })
}

// ML Service (Phase B: Real ML Implementation)
export const mlApi = {
  getStatus: () => fetchAPI('/ml/status'),
  getTrainingData: (limit = 100) => fetchAPI(`/ml/training-data?limit=${limit}`),
  train: () => fetchAPI('/ml/train', {
    method: 'POST',
    timeout: 300000 // 5 minute timeout for training
  }),
  toggle: (enabled) => fetchAPI('/ml/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled })
  }),
  getModels: () => fetchAPI('/ml/models'),
  activateModel: (id) => fetchAPI(`/ml/models/${id}/activate`, { method: 'POST' }),
  // Accelerated Data Collection
  accelerate: (enabled) => fetchAPI('/ml/accelerate', {
    method: 'POST',
    body: JSON.stringify({ enabled })
  }),
  // A/B Testing
  getABTestStatus: () => fetchAPI('/ml/ab-test/status'),
  startABTest: (testName) => fetchAPI('/ml/ab-test/start', {
    method: 'POST',
    body: JSON.stringify({ testName })
  }),
  stopABTest: () => fetchAPI('/ml/ab-test/stop', { method: 'POST' })
}

// Shariah Compliance (Islamic Finance)
export const shariahApi = {
  getStatus: () => fetchAPI('/shariah/status'),
  toggle: (enabled) => fetchAPI('/shariah/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled })
  }),
  getSwapDeadline: () => fetchAPI('/shariah/swap-deadline'),
  closeAll: () => fetchAPI('/shariah/close-all', { method: 'POST' }),
  getFees: (tradeId) => fetchAPI(`/shariah/fees/${tradeId}`),
  validate: (prediction) => fetchAPI('/shariah/validate', {
    method: 'POST',
    body: JSON.stringify({ prediction })
  })
}

// Swing Trading
export const swingApi = {
  // Status and control
  getStatus: () => fetchAPI('/swing/status'),
  toggle: (enabled) => fetchAPI('/swing/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled })
  }),
  configure: (config) => fetchAPI('/swing/configure', {
    method: 'POST',
    body: JSON.stringify(config)
  }),

  // Predictions and analysis
  predict: (pair) => fetchAPI('/swing/predict', {
    method: 'POST',
    body: JSON.stringify({ pair })
  }),
  getCandles: (pair, limit = 50) =>
    fetchAPI(`/swing/candles/${pair.replace('/', '-')}?limit=${limit}`),
  getSwingPoints: (pair) =>
    fetchAPI(`/swing/points/${pair.replace('/', '-')}`),
  getFibonacci: (pair) =>
    fetchAPI(`/swing/fibonacci/${pair.replace('/', '-')}`),

  // ML model
  getMLTrainingData: () => fetchAPI('/swing/ml/training-data'),
  trainML: () => fetchAPI('/swing/ml/train', {
    method: 'POST',
    timeout: 300000 // 5 minute timeout for training
  }),
  toggleML: (enabled) => fetchAPI('/swing/ml/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled })
  }),
  generateSyntheticData: (pair, lookforward = 7) => fetchAPI('/swing/ml/generate-synthetic', {
    method: 'POST',
    body: JSON.stringify({ pair, lookforward })
  })
}

// Phase 3: Advanced Analysis (Hurst, OrderFlow, Ensemble)
export const analysisApi = {
  // Combined status
  getAllStatus: () => fetchAPI('/analysis/all/status'),

  // Hurst Exponent
  getHurstStatus: () => fetchAPI('/analysis/hurst/status'),
  analyzeHurst: (pair, priceHistory) => fetchAPI('/analysis/hurst/analyze', {
    method: 'POST',
    body: JSON.stringify({ pair, priceHistory })
  }),
  configureHurst: (config) => fetchAPI('/analysis/hurst/configure', {
    method: 'POST',
    body: JSON.stringify(config)
  }),

  // Order Flow
  getOrderFlowStatus: () => fetchAPI('/analysis/orderflow/status'),
  analyzeOrderFlow: (pair, priceHistory) => fetchAPI('/analysis/orderflow/analyze', {
    method: 'POST',
    body: JSON.stringify({ pair, priceHistory })
  }),
  configureOrderFlow: (config) => fetchAPI('/analysis/orderflow/configure', {
    method: 'POST',
    body: JSON.stringify(config)
  }),

  // Ensemble Prediction
  getEnsembleStatus: () => fetchAPI('/analysis/ensemble/status'),
  runEnsemble: (pair, direction, priceHistory, baseConfidence) => fetchAPI('/analysis/ensemble/predict', {
    method: 'POST',
    body: JSON.stringify({ pair, direction, priceHistory, baseConfidence })
  }),
  getEnsembleWeights: () => fetchAPI('/analysis/ensemble/weights'),
  configureEnsemble: (config) => fetchAPI('/analysis/ensemble/configure', {
    method: 'POST',
    body: JSON.stringify(config)
  }),

  // Phase 3 toggles
  togglePhase3: (enabled) => fetchAPI('/analysis/phase3/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled })
  }),
  getPhase3Options: () => fetchAPI('/analysis/phase3/options'),

  // Full signal analysis
  analyzeSignal: (pair, direction, priceHistory, baseConfidence) => fetchAPI('/analysis/signal', {
    method: 'POST',
    body: JSON.stringify({ pair, direction, priceHistory, baseConfidence })
  })
}

// Check if API is available (for hybrid mode)
export async function isApiAvailable() {
  try {
    await healthApi.check()
    return true
  } catch {
    return false
  }
}
