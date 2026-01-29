/**
 * Interactive Brokers Contract Resolver
 * Resolves forex pairs to IB contract specifications
 */

import { Forex } from './ib-loader.js'
import { IB_CONFIG } from '../../config/ib.config.js'

/**
 * Create an IB forex contract for a currency pair
 * @param {string} pair - The forex pair (e.g., 'EUR/USD')
 * @returns {object} IB Contract object
 */
export function createForexContract(pair) {
  const pairConfig = IB_CONFIG.forex.pairs[pair]

  if (!pairConfig) {
    throw new Error(`Unsupported forex pair: ${pair}`)
  }

  // Use the Forex helper from @stoqey/ib
  return new Forex(pairConfig.symbol, pairConfig.currency)
}

/**
 * Get all supported forex contracts
 * @returns {Object} Map of pair -> Contract
 */
export function getAllForexContracts() {
  const contracts = {}

  for (const pair of Object.keys(IB_CONFIG.forex.pairs)) {
    contracts[pair] = createForexContract(pair)
  }

  return contracts
}

/**
 * Convert IB contract back to pair string
 * @param {Contract} contract - IB Contract object
 * @returns {string} The forex pair string
 */
export function contractToPair(contract) {
  const symbol = contract.symbol
  const currency = contract.currency

  // Find matching pair
  for (const [pair, config] of Object.entries(IB_CONFIG.forex.pairs)) {
    if (config.symbol === symbol && config.currency === currency) {
      return pair
    }
  }

  // Construct pair if not found in config
  return `${symbol}/${currency}`
}

/**
 * Check if a pair is supported
 * @param {string} pair - The forex pair
 * @returns {boolean}
 */
export function isPairSupported(pair) {
  return pair in IB_CONFIG.forex.pairs
}

/**
 * Get supported pairs
 * @returns {string[]}
 */
export function getSupportedPairs() {
  return Object.keys(IB_CONFIG.forex.pairs)
}

/**
 * Get pip value for a pair
 * @param {string} pair - The forex pair
 * @returns {number} Pip value (0.0001 for most, 0.01 for JPY)
 */
export function getPipValue(pair) {
  return pair.includes('JPY') ? 0.01 : 0.0001
}

/**
 * Get pip value per lot for a pair
 * @param {string} pair - The forex pair
 * @returns {number} Dollar value per pip per lot
 */
export function getPipValuePerLot(pair) {
  // Standard lot = 100,000 units
  // For most pairs: 1 pip = $10 per standard lot
  // For JPY pairs: 1 pip ≈ $6.67-$10 depending on USD/JPY rate
  return pair.includes('JPY') ? 1000 : 10
}

/**
 * Calculate position size in IB units
 * IB uses base currency units for forex
 * @param {number} lots - Standard lots
 * @returns {number} Position size in base currency units (rounded to whole number, min 20000)
 */
export function lotsToUnits(lots) {
  // 1 standard lot = 100,000 base currency units
  // IB requires whole number units, minimum 20,000 for most forex pairs
  const units = Math.round(lots * 100000)
  // Ensure minimum of 20,000 units (0.2 lots) as IB's minimum for forex
  return Math.max(units, 20000)
}

/**
 * Convert IB units to lots
 * @param {number} units - Base currency units
 * @returns {number} Standard lots
 */
export function unitsToLots(units) {
  return units / 100000
}

/**
 * Format price for display based on pair
 * @param {string} pair - The forex pair
 * @param {number} price - The price
 * @returns {string} Formatted price
 */
export function formatPrice(pair, price) {
  const decimals = pair.includes('JPY') ? 3 : 5
  return price.toFixed(decimals)
}

export default {
  createForexContract,
  getAllForexContracts,
  contractToPair,
  isPairSupported,
  getSupportedPairs,
  getPipValue,
  getPipValuePerLot,
  lotsToUnits,
  unitsToLots,
  formatPrice
}
