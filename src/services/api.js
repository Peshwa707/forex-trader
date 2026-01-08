/**
 * API Service for Frontend
 * Connects to the backend trading bot server
 */

const API_BASE = import.meta.env.VITE_API_URL || ''

async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE}/api${endpoint}`

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return await response.json()
  } catch (error) {
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
  getActivity: (limit = 50) => fetchAPI(`/activity?limit=${limit}`)
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

// Check if API is available (for hybrid mode)
export async function isApiAvailable() {
  try {
    await healthApi.check()
    return true
  } catch {
    return false
  }
}
