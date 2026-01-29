/**
 * Authentication Middleware
 * Protects API endpoints with JWT authentication and rate limiting
 */

import rateLimit from 'express-rate-limit'
import { verifyToken, isAuthEnabled } from './sessionManager.js'
import * as db from '../../database.js'

/**
 * JWT Authentication Middleware
 * Validates Bearer token in Authorization header
 */
export function authenticateJWT(req, res, next) {
  // Skip auth if disabled
  if (!isAuthEnabled()) {
    return next()
  }

  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'NO_TOKEN'
    })
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: 'Invalid authorization format. Use: Bearer <token>',
      code: 'INVALID_FORMAT'
    })
  }

  const token = parts[1]
  const verification = verifyToken(token)

  if (!verification.valid) {
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
      details: verification.error
    })
  }

  // Token is valid, allow request
  req.auth = verification.decoded
  next()
}

/**
 * Optional authentication - doesn't block if no token, but validates if present
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization

  if (authHeader) {
    const parts = authHeader.split(' ')
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const verification = verifyToken(parts[1])
      if (verification.valid) {
        req.auth = verification.decoded
      }
    }
  }

  next()
}

/**
 * Require authentication for trading operations
 * More strict than general auth - always requires valid token for trading
 */
export function requireTradingAuth(req, res, next) {
  // Trading operations always require auth when enabled
  if (!isAuthEnabled()) {
    return next()
  }

  const tradingMode = db.getSetting('tradingMode')

  // Always require auth for LIVE mode
  if (tradingMode === 'LIVE') {
    return authenticateJWT(req, res, next)
  }

  // For PAPER mode, require auth if enabled
  if (tradingMode === 'PAPER' && isAuthEnabled()) {
    return authenticateJWT(req, res, next)
  }

  // SIMULATION mode - optionally authenticated
  return optionalAuth(req, res, next)
}

/**
 * General rate limiter - 100 requests per 15 minutes
 */
export const generalRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // High limit for development
  message: {
    error: 'Too many requests',
    code: 'RATE_LIMITED',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    db.logActivity('RATE_LIMITED', `IP ${req.ip} rate limited (general)`, {
      ip: req.ip,
      path: req.path
    })
    res.status(429).json(options.message)
  }
})

/**
 * Trading rate limiter - 10 requests per minute for trading operations
 */
export const tradingRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: {
    error: 'Too many trading requests',
    code: 'TRADING_RATE_LIMITED',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    db.logActivity('RATE_LIMITED', `IP ${req.ip} rate limited (trading)`, {
      ip: req.ip,
      path: req.path
    })
    res.status(429).json(options.message)
  }
})

/**
 * Strict rate limiter for auth endpoints - 5 requests per 5 minutes
 */
export const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: {
    error: 'Too many authentication attempts',
    code: 'AUTH_RATE_LIMITED',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    db.logActivity('RATE_LIMITED', `IP ${req.ip} rate limited (auth)`, {
      ip: req.ip,
      path: req.path
    })
    res.status(429).json(options.message)
  }
})

/**
 * Kill switch rate limiter - 3 requests per minute
 */
export const killSwitchRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: {
    error: 'Kill switch rate limited',
    code: 'KILLSWITCH_RATE_LIMITED'
  }
})

/**
 * IP whitelist middleware
 * Only allows requests from whitelisted IPs
 */
export function ipWhitelist(allowedIps = ['127.0.0.1', '::1', 'localhost']) {
  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress

    // Normalize IPv6 localhost
    const normalizedIp = clientIp === '::ffff:127.0.0.1' ? '127.0.0.1' : clientIp

    if (allowedIps.includes(normalizedIp) || allowedIps.includes('*')) {
      return next()
    }

    db.logActivity('IP_BLOCKED', `Blocked request from ${clientIp}`, { ip: clientIp, path: req.path })

    return res.status(403).json({
      error: 'Access denied',
      code: 'IP_NOT_ALLOWED'
    })
  }
}

/**
 * Log all trading operations
 */
export function tradingAuditLog(req, res, next) {
  const startTime = Date.now()

  // Capture response
  const originalSend = res.send
  res.send = function (body) {
    const duration = Date.now() - startTime

    db.logActivity('TRADING_AUDIT', `${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      ip: req.ip,
      duration,
      statusCode: res.statusCode,
      authenticated: !!req.auth
    })

    return originalSend.call(this, body)
  }

  next()
}

/**
 * Combine multiple middleware
 */
export function combinedTradingMiddleware() {
  return [
    tradingRateLimiter,
    requireTradingAuth,
    tradingAuditLog
  ]
}

export default {
  authenticateJWT,
  optionalAuth,
  requireTradingAuth,
  generalRateLimiter,
  tradingRateLimiter,
  authRateLimiter,
  killSwitchRateLimiter,
  ipWhitelist,
  tradingAuditLog,
  combinedTradingMiddleware
}
