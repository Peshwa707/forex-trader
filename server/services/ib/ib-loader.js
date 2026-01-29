/**
 * IB Library Loader
 * Attempts to load @stoqey/ib, provides stubs if unavailable (e.g., Railway deployment)
 */

let ibLib = null
let loadError = null

try {
  ibLib = await import('@stoqey/ib')
} catch (err) {
  loadError = err
  console.warn('[IB Loader] @stoqey/ib not available - IB features disabled')
  console.warn('[IB Loader] This is expected on Railway/cloud deployments')
}

export const isIBAvailable = () => ibLib !== null

export const getLoadError = () => loadError

// Export real or stub implementations
export const IBApi = ibLib?.IBApi ?? class IBApiStub {
  constructor() {
    console.warn('[IB Stub] IBApi instantiated but @stoqey/ib not available')
  }
  connect() { return Promise.reject(new Error('IB library not available')) }
  disconnect() {}
  on() {}
  off() {}
}

export const EventName = ibLib?.EventName ?? {
  connected: 'connected',
  disconnected: 'disconnected',
  error: 'error',
  nextValidId: 'nextValidId',
  orderStatus: 'orderStatus',
  openOrder: 'openOrder',
  execDetails: 'execDetails',
  updateAccountValue: 'updateAccountValue',
  updatePortfolio: 'updatePortfolio',
  accountSummary: 'accountSummary',
  position: 'position',
  tickPrice: 'tickPrice',
  tickSize: 'tickSize',
  tickGeneric: 'tickGeneric',
}

export const OrderAction = ibLib?.OrderAction ?? {
  BUY: 'BUY',
  SELL: 'SELL',
}

export const OrderType = ibLib?.OrderType ?? {
  MKT: 'MKT',
  LMT: 'LMT',
  STP: 'STP',
  STP_LMT: 'STP_LMT',
}

export const TimeInForce = ibLib?.TimeInForce ?? {
  DAY: 'DAY',
  GTC: 'GTC',
  IOC: 'IOC',
  GTD: 'GTD',
}

export const Forex = ibLib?.Forex ?? class ForexStub {
  constructor(symbol, currency = 'USD') {
    this.symbol = symbol
    this.currency = currency
    this.secType = 'CASH'
    this.exchange = 'IDEALPRO'
  }
}

export const IBApiTickType = ibLib?.IBApiTickType ?? {
  BID: 1,
  ASK: 2,
  LAST: 4,
  HIGH: 6,
  LOW: 7,
  CLOSE: 9,
  OPEN: 14,
}
