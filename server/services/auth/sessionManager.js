/**
 * Session Manager
 * Handles user sessions and authentication state
 */

import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import * as db from '../../database.js'

// JWT configuration - REQUIRE JWT_SECRET in production
const JWT_SECRET = process.env.JWT_SECRET
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h'
const REFRESH_EXPIRY = process.env.REFRESH_EXPIRY || '7d'

// Warn if JWT_SECRET is not set (use development fallback only in non-production)
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('CRITICAL: JWT_SECRET environment variable is required in production!')
    console.error('Set JWT_SECRET to a secure random string before starting the server.')
    process.exit(1)
  } else {
    console.warn('⚠️ JWT_SECRET not set - using insecure development fallback')
  }
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-insecure-secret-do-not-use-in-production'

// Session storage with TTL cleanup
const activeSessions = new Map()
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// Cleanup expired sessions every hour
setInterval(() => {
  const now = Date.now()
  for (const [sessionId, session] of activeSessions) {
    const createdAtMs = session.createdAt ? new Date(session.createdAt).getTime() : 0
    const sessionAge = createdAtMs ? now - createdAtMs : SESSION_TTL_MS + 1  // Treat missing date as expired
    if (sessionAge > SESSION_TTL_MS || isNaN(sessionAge)) {
      activeSessions.delete(sessionId)
    }
  }
}, 60 * 60 * 1000)

/**
 * Hash a password
 */
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

/**
 * Verify a password against its hash
 */
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

/**
 * Initialize default credentials if not set
 */
export async function initializeAuth() {
  const existingPassword = db.getIBConfig('auth_password_hash')
  if (!existingPassword) {
    // Set default password (should be changed immediately in production)
    const defaultPassword = process.env.DEFAULT_PASSWORD || 'changeme123'
    const hash = await hashPassword(defaultPassword)
    db.setIBConfig('auth_password_hash', hash)
    db.setIBConfig('auth_enabled', false) // Disabled by default
    console.log('Authentication initialized with default credentials')
    console.log('⚠️ Change the default password immediately in production!')
  }
}

/**
 * Check if authentication is enabled
 */
export function isAuthEnabled() {
  return db.getIBConfig('auth_enabled') === true
}

/**
 * Enable authentication
 */
export function enableAuth() {
  db.setIBConfig('auth_enabled', true)
  db.logActivity('AUTH_ENABLED', 'Authentication enabled')
  return { enabled: true }
}

/**
 * Disable authentication
 */
export function disableAuth() {
  db.setIBConfig('auth_enabled', false)
  db.logActivity('AUTH_DISABLED', 'Authentication disabled')
  return { enabled: false }
}

/**
 * Set new password
 */
export async function setPassword(newPassword) {
  if (newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  const hash = await hashPassword(newPassword)
  db.setIBConfig('auth_password_hash', hash)
  db.logActivity('PASSWORD_CHANGED', 'Authentication password changed')

  // Invalidate all existing sessions
  invalidateAllSessions()

  return { success: true }
}

/**
 * Authenticate user and create session
 */
export async function login(password) {
  const storedHash = db.getIBConfig('auth_password_hash')

  if (!storedHash) {
    throw new Error('Authentication not configured')
  }

  const isValid = await verifyPassword(password, storedHash)

  if (!isValid) {
    db.logActivity('LOGIN_FAILED', 'Invalid password attempt')
    throw new Error('Invalid password')
  }

  // Create JWT token
  const token = jwt.sign(
    {
      type: 'access',
      iat: Math.floor(Date.now() / 1000)
    },
    EFFECTIVE_JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  )

  // Create refresh token
  const refreshToken = jwt.sign(
    {
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000)
    },
    EFFECTIVE_JWT_SECRET,
    { expiresIn: REFRESH_EXPIRY }
  )

  // Store session
  const sessionId = generateSessionId()
  activeSessions.set(sessionId, {
    token,
    refreshToken,
    createdAt: new Date(),
    lastActivity: new Date()
  })

  db.logActivity('LOGIN_SUCCESS', 'User logged in')

  return {
    token,
    refreshToken,
    expiresIn: JWT_EXPIRY,
    sessionId
  }
}

/**
 * Verify a JWT token
 */
export function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET)
    return { valid: true, decoded }
  } catch (error) {
    return { valid: false, error: error.message }
  }
}

/**
 * Refresh an access token using refresh token
 */
export function refreshAccessToken(refreshToken) {
  const verification = verifyToken(refreshToken)

  if (!verification.valid) {
    throw new Error('Invalid refresh token')
  }

  if (verification.decoded.type !== 'refresh') {
    throw new Error('Invalid token type')
  }

  // Create new access token
  const token = jwt.sign(
    {
      type: 'access',
      iat: Math.floor(Date.now() / 1000)
    },
    EFFECTIVE_JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  )

  return { token, expiresIn: JWT_EXPIRY }
}

/**
 * Logout / invalidate session
 */
export function logout(sessionId) {
  if (sessionId && activeSessions.has(sessionId)) {
    activeSessions.delete(sessionId)
  }
  db.logActivity('LOGOUT', 'User logged out')
  return { success: true }
}

/**
 * Invalidate all sessions (force re-login)
 */
export function invalidateAllSessions() {
  activeSessions.clear()
  db.logActivity('SESSIONS_INVALIDATED', 'All sessions invalidated')
  return { success: true }
}

/**
 * Get active session count
 */
export function getSessionCount() {
  return activeSessions.size
}

/**
 * Generate a random session ID
 */
function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
}

/**
 * Get authentication status
 */
export function getAuthStatus() {
  return {
    enabled: isAuthEnabled(),
    activeSessions: getSessionCount()
  }
}

export default {
  hashPassword,
  verifyPassword,
  initializeAuth,
  isAuthEnabled,
  enableAuth,
  disableAuth,
  setPassword,
  login,
  verifyToken,
  refreshAccessToken,
  logout,
  invalidateAllSessions,
  getSessionCount,
  getAuthStatus
}
