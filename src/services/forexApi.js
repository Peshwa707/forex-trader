// Free Forex API service using exchangerate.host
const BASE_URL = 'https://api.exchangerate.host'

// Major currency pairs for Forex trading
export const CURRENCY_PAIRS = [
  { pair: 'EUR/USD', base: 'EUR', quote: 'USD', name: 'Euro / US Dollar' },
  { pair: 'GBP/USD', base: 'GBP', quote: 'USD', name: 'British Pound / US Dollar' },
  { pair: 'USD/JPY', base: 'USD', quote: 'JPY', name: 'US Dollar / Japanese Yen' },
  { pair: 'USD/CHF', base: 'USD', quote: 'CHF', name: 'US Dollar / Swiss Franc' },
  { pair: 'AUD/USD', base: 'AUD', quote: 'USD', name: 'Australian Dollar / US Dollar' },
  { pair: 'USD/CAD', base: 'USD', quote: 'CAD', name: 'US Dollar / Canadian Dollar' },
  { pair: 'NZD/USD', base: 'NZD', quote: 'USD', name: 'New Zealand Dollar / US Dollar' },
  { pair: 'EUR/GBP', base: 'EUR', quote: 'GBP', name: 'Euro / British Pound' },
  { pair: 'EUR/JPY', base: 'EUR', quote: 'JPY', name: 'Euro / Japanese Yen' },
  { pair: 'GBP/JPY', base: 'GBP', quote: 'JPY', name: 'British Pound / Japanese Yen' },
  { pair: 'XAU/USD', base: 'XAU', quote: 'USD', name: 'Gold / US Dollar' },
  { pair: 'XAG/USD', base: 'XAG', quote: 'USD', name: 'Silver / US Dollar' },
]

// Fallback rates in case API fails (approximate values)
// IMPORTANT: These are static fallback values and may be stale
const FALLBACK_RATES = {
  EUR: { USD: 1.0850, GBP: 0.8550, JPY: 162.50, CHF: 0.9450, AUD: 1.6350, CAD: 1.4750 },
  GBP: { USD: 1.2700, JPY: 190.00 },
  USD: { JPY: 149.50, CHF: 0.8700, CAD: 1.3600 },
  AUD: { USD: 0.6650 },
  NZD: { USD: 0.6100 },
  XAU: { USD: 2650.00 },
  XAG: { USD: 31.50 },
}

// Track last successful API fetch to detect staleness
let lastSuccessfulFetch = null
let usingFallback = false
const STALENESS_WARNING_MS = 5 * 60 * 1000 // Warn if fallback used for > 5 minutes

export async function fetchLiveRates() {
  try {
    // Try primary API
    const response = await fetch(`${BASE_URL}/live?access_key=free`)

    if (!response.ok) {
      throw new Error('API request failed')
    }

    const data = await response.json()

    if (data.success && data.quotes) {
      lastSuccessfulFetch = Date.now()
      usingFallback = false
      return processApiRates(data.quotes)
    }

    // If primary fails, try alternative free API
    const frankfurterRates = await fetchFromFrankfurter()
    lastSuccessfulFetch = Date.now()
    usingFallback = false
    return frankfurterRates
  } catch (error) {
    console.warn('Using fallback rates:', error.message)

    // Check staleness of fallback usage
    if (lastSuccessfulFetch) {
      const staleDuration = Date.now() - lastSuccessfulFetch
      if (staleDuration > STALENESS_WARNING_MS) {
        console.error(`WARNING: Using stale fallback rates! Last successful fetch was ${Math.round(staleDuration / 1000 / 60)} minutes ago`)
      }
    } else {
      console.error('WARNING: Using hardcoded fallback rates - no live data has been fetched this session')
    }

    usingFallback = true
    return generateFallbackRates()
  }
}

// Check if currently using fallback rates
export function isUsingFallbackRates() {
  return usingFallback
}

// Get last successful fetch time
export function getLastSuccessfulFetch() {
  return lastSuccessfulFetch
}

async function fetchFromFrankfurter() {
  try {
    const bases = ['EUR', 'USD', 'GBP']
    const allRates = {}

    for (const base of bases) {
      const response = await fetch(`https://api.frankfurter.app/latest?from=${base}`)
      if (response.ok) {
        const data = await response.json()
        allRates[base] = data.rates
      }
    }

    return processMultiBaseRates(allRates)
  } catch (error) {
    console.warn('Frankfurter API failed:', error.message)
    return generateFallbackRates()
  }
}

function processApiRates(quotes) {
  return CURRENCY_PAIRS.map(({ pair, base, quote, name }) => {
    const key = `USD${quote}`
    const baseKey = `USD${base}`
    let rate = 0

    if (base === 'USD') {
      rate = quotes[key] || 0
    } else if (quotes[key] && quotes[baseKey]) {
      rate = quotes[key] / quotes[baseKey]
    }

    const change = (Math.random() - 0.5) * 0.02 // Simulated change

    return {
      pair,
      name,
      rate: rate || getFallbackRate(base, quote),
      change,
      changePercent: change * 100,
      high: rate * 1.005,
      low: rate * 0.995,
      timestamp: Date.now()
    }
  })
}

function processMultiBaseRates(allRates) {
  return CURRENCY_PAIRS.map(({ pair, base, quote, name }) => {
    let rate = 0

    if (allRates[base] && allRates[base][quote]) {
      rate = allRates[base][quote]
    } else if (allRates[quote] && allRates[quote][base]) {
      rate = 1 / allRates[quote][base]
    }

    const change = (Math.random() - 0.5) * 0.002

    return {
      pair,
      name,
      rate: rate || getFallbackRate(base, quote),
      change,
      changePercent: change * 100,
      high: rate * 1.005,
      low: rate * 0.995,
      timestamp: Date.now()
    }
  })
}

function getFallbackRate(base, quote) {
  if (FALLBACK_RATES[base] && FALLBACK_RATES[base][quote]) {
    return FALLBACK_RATES[base][quote]
  }
  if (FALLBACK_RATES[quote] && FALLBACK_RATES[quote][base]) {
    return 1 / FALLBACK_RATES[quote][base]
  }
  return 1
}

function generateFallbackRates() {
  return CURRENCY_PAIRS.map(({ pair, base, quote, name }) => {
    const rate = getFallbackRate(base, quote)
    const change = (Math.random() - 0.5) * 0.002

    return {
      pair,
      name,
      rate,
      change,
      changePercent: change * 100,
      high: rate * 1.005,
      low: rate * 0.995,
      timestamp: Date.now()
    }
  })
}

// Format rate based on pair type
export function formatRate(pair, rate) {
  if (pair.includes('JPY')) {
    return rate.toFixed(3)
  }
  if (pair.includes('XAU') || pair.includes('XAG')) {
    return rate.toFixed(2)
  }
  return rate.toFixed(5)
}

// Calculate pip value
export function calculatePips(pair, oldRate, newRate) {
  const pipMultiplier = pair.includes('JPY') ? 100 : 10000
  return ((newRate - oldRate) * pipMultiplier).toFixed(1)
}
