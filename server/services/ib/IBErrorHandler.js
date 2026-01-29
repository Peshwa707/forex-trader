/**
 * Interactive Brokers Error Handler
 * Classifies and handles IB API errors with appropriate recovery strategies
 */

import * as db from '../../database.js'

// Error severity levels
export const ErrorSeverity = {
  INFO: 'INFO',           // Informational, no action needed
  WARNING: 'WARNING',     // Non-critical, may need attention
  ERROR: 'ERROR',         // Critical, needs handling
  FATAL: 'FATAL'          // Connection lost or unrecoverable
}

// Error categories for recovery strategies
export const ErrorCategory = {
  CONNECTION: 'CONNECTION',     // Network/connection issues
  ORDER: 'ORDER',              // Order-related errors
  MARKET_DATA: 'MARKET_DATA',  // Market data issues
  ACCOUNT: 'ACCOUNT',          // Account/permission issues
  RATE_LIMIT: 'RATE_LIMIT',    // Too many requests
  SYSTEM: 'SYSTEM'             // General system errors
}

// IB error code classifications
// Based on TWS API error codes: https://interactivebrokers.github.io/tws-api/message_codes.html
const ERROR_CLASSIFICATIONS = {
  // Connection errors (1xxx, 5xx)
  502: { severity: ErrorSeverity.FATAL, category: ErrorCategory.CONNECTION, recoverable: true, message: 'Could not connect to TWS' },
  503: { severity: ErrorSeverity.FATAL, category: ErrorCategory.CONNECTION, recoverable: true, message: 'TWS socket connection failed' },
  504: { severity: ErrorSeverity.FATAL, category: ErrorCategory.CONNECTION, recoverable: true, message: 'Not connected' },
  1100: { severity: ErrorSeverity.FATAL, category: ErrorCategory.CONNECTION, recoverable: true, message: 'Connectivity lost' },
  1101: { severity: ErrorSeverity.INFO, category: ErrorCategory.CONNECTION, recoverable: false, message: 'Connectivity restored - data lost' },
  1102: { severity: ErrorSeverity.INFO, category: ErrorCategory.CONNECTION, recoverable: false, message: 'Connectivity restored - data maintained' },
  2104: { severity: ErrorSeverity.INFO, category: ErrorCategory.CONNECTION, recoverable: false, message: 'Market data farm connected' },
  2106: { severity: ErrorSeverity.INFO, category: ErrorCategory.CONNECTION, recoverable: false, message: 'HMDS data farm connected' },
  2158: { severity: ErrorSeverity.INFO, category: ErrorCategory.CONNECTION, recoverable: false, message: 'Sec-def data farm connected' },

  // Order errors (1xx, 2xx)
  103: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Duplicate order id' },
  104: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Cannot modify filled order' },
  105: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Order modified during pending' },
  106: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Cannot transmit order' },
  107: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Cannot transmit inactive order' },
  109: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Price out of range' },
  110: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Price does not conform to min tick' },
  111: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'TIF/order type combination invalid' },
  135: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Cannot find order' },
  136: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Order cannot be cancelled' },
  161: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Cancel attempted when order not in cancellable state' },
  201: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ORDER, recoverable: false, message: 'Order rejected' },
  202: { severity: ErrorSeverity.INFO, category: ErrorCategory.ORDER, recoverable: false, message: 'Order cancelled' },
  203: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ACCOUNT, recoverable: false, message: 'Security not allowed' },

  // Market data errors (3xx, 4xx)
  300: { severity: ErrorSeverity.ERROR, category: ErrorCategory.MARKET_DATA, recoverable: false, message: 'Cannot find EId' },
  309: { severity: ErrorSeverity.ERROR, category: ErrorCategory.MARKET_DATA, recoverable: true, message: 'Market data not subscribed' },
  317: { severity: ErrorSeverity.WARNING, category: ErrorCategory.MARKET_DATA, recoverable: true, message: 'Market depth data reset' },
  354: { severity: ErrorSeverity.ERROR, category: ErrorCategory.MARKET_DATA, recoverable: false, message: 'Not subscribed to requested market data' },
  366: { severity: ErrorSeverity.WARNING, category: ErrorCategory.MARKET_DATA, recoverable: false, message: 'No historical data for query' },

  // Account/permission errors
  102: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ACCOUNT, recoverable: false, message: 'Duplicate ticker id' },
  200: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ACCOUNT, recoverable: false, message: 'No security definition found' },
  321: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ACCOUNT, recoverable: false, message: 'Server validation error' },
  322: { severity: ErrorSeverity.ERROR, category: ErrorCategory.ACCOUNT, recoverable: false, message: 'Duplicate ticker id' },

  // Rate limiting
  100: { severity: ErrorSeverity.WARNING, category: ErrorCategory.RATE_LIMIT, recoverable: true, message: 'Max rate of messages exceeded' },
  162: { severity: ErrorSeverity.WARNING, category: ErrorCategory.RATE_LIMIT, recoverable: true, message: 'Historical data request pacing violation' },
  165: { severity: ErrorSeverity.WARNING, category: ErrorCategory.RATE_LIMIT, recoverable: true, message: 'Historical data request would cause pacing violation' }
}

// Default classification for unknown errors
const DEFAULT_CLASSIFICATION = {
  severity: ErrorSeverity.WARNING,
  category: ErrorCategory.SYSTEM,
  recoverable: false,
  message: 'Unknown error'
}

/**
 * IBErrorHandler - Handles and classifies IB errors
 */
export class IBErrorHandler {
  constructor() {
    this.errorCount = 0
    this.lastErrors = []
    this.maxStoredErrors = 100
    this.listeners = new Set()
  }

  /**
   * Classify an error by its code
   */
  classify(errorCode) {
    return ERROR_CLASSIFICATIONS[errorCode] || DEFAULT_CLASSIFICATION
  }

  /**
   * Handle an IB error
   */
  handleError(errorCode, errorMessage, reqId = null) {
    const classification = this.classify(errorCode)
    this.errorCount++

    const errorRecord = {
      code: errorCode,
      message: errorMessage,
      reqId,
      ...classification,
      timestamp: new Date().toISOString()
    }

    // Store error
    this.lastErrors.unshift(errorRecord)
    if (this.lastErrors.length > this.maxStoredErrors) {
      this.lastErrors.pop()
    }

    // Log to database for audit
    db.logActivity('IB_ERROR', `[${errorCode}] ${errorMessage}`, {
      ...errorRecord,
      systemMessage: classification.message
    })

    // Log to console
    const logLevel = this.getLogLevel(classification.severity)
    console[logLevel](`[IB ${classification.severity}] [${errorCode}] ${errorMessage}`)

    // Notify listeners
    this.notifyListeners(errorRecord)

    return {
      ...errorRecord,
      shouldReconnect: classification.severity === ErrorSeverity.FATAL && classification.recoverable,
      shouldRetry: classification.recoverable && classification.severity !== ErrorSeverity.FATAL
    }
  }

  /**
   * Get console log level for severity
   */
  getLogLevel(severity) {
    switch (severity) {
      case ErrorSeverity.INFO: return 'info'
      case ErrorSeverity.WARNING: return 'warn'
      case ErrorSeverity.ERROR: return 'error'
      case ErrorSeverity.FATAL: return 'error'
      default: return 'log'
    }
  }

  /**
   * Check if error is critical (should trigger kill switch)
   */
  isCritical(errorCode) {
    const classification = this.classify(errorCode)
    return classification.severity === ErrorSeverity.FATAL
  }

  /**
   * Check if error suggests reconnection
   */
  shouldReconnect(errorCode) {
    const classification = this.classify(errorCode)
    return classification.severity === ErrorSeverity.FATAL && classification.recoverable
  }

  /**
   * Add error listener
   */
  addListener(callback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  /**
   * Notify all listeners of error
   */
  notifyListeners(errorRecord) {
    for (const listener of this.listeners) {
      try {
        listener(errorRecord)
      } catch (e) {
        console.error('Error in error listener:', e)
      }
    }
  }

  /**
   * Get recent errors
   */
  getRecentErrors(count = 10) {
    return this.lastErrors.slice(0, count)
  }

  /**
   * Get error statistics
   */
  getStats() {
    const stats = {
      totalErrors: this.errorCount,
      byCategory: {},
      bySeverity: {}
    }

    for (const error of this.lastErrors) {
      stats.byCategory[error.category] = (stats.byCategory[error.category] || 0) + 1
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1
    }

    return stats
  }

  /**
   * Clear error history
   */
  clearHistory() {
    this.lastErrors = []
    this.errorCount = 0
  }
}

// Singleton instance
export const errorHandler = new IBErrorHandler()
export default errorHandler
