/**
 * Forex API Service for Server
 * Fetches live exchange rates from multiple sources
 * Priority: IB (when connected) > External APIs > Cached > Simulated
 */

import { ibMarketData } from './ib/IBMarketData.js'
import { ibConnector } from './ib/IBConnector.js'

const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'EUR/GBP']
const API_URL = 'https://api.exchangerate.host/latest'

// Cache for rates
let ratesCache = {}
let lastFetch = 0
const CACHE_DURATION = 30000 // 30 seconds

// Price source tracking
let lastSource = 'SIMULATED'

/**
 * Get the current price source
 */
export function getPriceSource() {
  return lastSource
}

/**
 * Fetch rates from IB if connected
 */
function fetchIBRates() {
  if (!ibConnector.isConnected()) {
    return null
  }

  const rates = ibMarketData.getRatesForBot()

  // Only return if we have all pairs with recent data
  if (rates.length >= PAIRS.length && ibMarketData.hasAllRecentData(PAIRS, 60000)) {
    lastSource = 'IB'
    return rates
  }

  return null
}

export async function fetchLiveRates() {
  // Try IB first if connected
  const ibRates = fetchIBRates()
  if (ibRates && ibRates.length > 0) {
    console.log('Using IB market data')
    return ibRates
  }
  const now = Date.now()

  // Return cached if fresh
  if (now - lastFetch < CACHE_DURATION && Object.keys(ratesCache).length > 0) {
    return formatRates(ratesCache)
  }

  try {
    // Try primary API
    const response = await fetch(`${API_URL}?base=USD`)

    if (response.ok) {
      const data = await response.json()
      if (data.rates) {
        ratesCache = data.rates
        lastFetch = now
        lastSource = 'API_PRIMARY'
        return formatRates(data.rates)
      }
    }

    // Fallback to backup API
    const backupResponse = await fetch('https://open.er-api.com/v6/latest/USD')
    if (backupResponse.ok) {
      const backupData = await backupResponse.json()
      if (backupData.rates) {
        ratesCache = backupData.rates
        lastFetch = now
        lastSource = 'API_BACKUP'
        return formatRates(backupData.rates)
      }
    }

    // If all APIs fail, return cached or simulated data
    if (Object.keys(ratesCache).length > 0) {
      console.log('Using cached rates')
      lastSource = 'CACHED'
      return formatRates(ratesCache)
    }

    console.log('Using simulated rates')
    lastSource = 'SIMULATED'
    return getSimulatedRates()
  } catch (error) {
    console.error('Error fetching rates:', error.message)

    if (Object.keys(ratesCache).length > 0) {
      lastSource = 'CACHED'
      return formatRates(ratesCache)
    }

    lastSource = 'SIMULATED'
    return getSimulatedRates()
  }
}

function formatRates(rates) {
  return PAIRS.map(pair => {
    const [base, quote] = pair.split('/')
    let rate

    if (base === 'USD') {
      rate = rates[quote] || 1
    } else if (quote === 'USD') {
      rate = 1 / (rates[base] || 1)
    } else {
      const baseToUsd = 1 / (rates[base] || 1)
      const usdToQuote = rates[quote] || 1
      rate = baseToUsd * usdToQuote
    }

    // Add small random variation for realism
    const variation = (Math.random() - 0.5) * 0.0002
    rate = rate * (1 + variation)

    return {
      pair,
      rate: parseFloat(rate.toFixed(pair.includes('JPY') ? 3 : 5)),
      change: (Math.random() - 0.5) * 0.5,
      timestamp: Date.now()
    }
  })
}

function getSimulatedRates() {
  const baseRates = {
    'EUR/USD': 1.0850,
    'GBP/USD': 1.2650,
    'USD/JPY': 149.50,
    'AUD/USD': 0.6550,
    'USD/CAD': 1.3550,
    'EUR/GBP': 0.8580
  }

  return PAIRS.map(pair => {
    const baseRate = baseRates[pair]
    const variation = (Math.random() - 0.5) * 0.002
    const rate = baseRate * (1 + variation)

    return {
      pair,
      rate: parseFloat(rate.toFixed(pair.includes('JPY') ? 3 : 5)),
      change: (Math.random() - 0.5) * 0.5,
      timestamp: Date.now()
    }
  })
}

export function getRateForPair(rates, pair) {
  const rateObj = rates.find(r => r.pair === pair)
  return rateObj ? rateObj.rate : null
}

export function getPriceMap(rates) {
  const map = {}
  rates.forEach(r => {
    map[r.pair] = r.rate
  })
  return map
}
