/**
 * Interactive Brokers Connection Monitor
 * Provides active health monitoring with heartbeat checks and connection quality metrics
 *
 * Phase D: Solid IB connection monitoring
 * - Heartbeat check every 30 seconds
 * - Detect disconnections proactively
 * - Track connection state and health metrics
 * - Integrate with existing auto-reconnect logic
 */

import { ibConnector, ConnectionState } from './IBConnector.js'
import * as db from '../../database.js'

// Health status levels
export const HealthStatus = {
  HEALTHY: 'HEALTHY',           // All good, recent heartbeat
  DEGRADED: 'DEGRADED',         // Connected but heartbeat delayed
  UNHEALTHY: 'UNHEALTHY',       // No recent heartbeat, likely disconnected
  DISCONNECTED: 'DISCONNECTED'  // Known disconnected state
}

// Monitor configuration
const MONITOR_CONFIG = {
  heartbeatIntervalMs: 30000,       // 30 seconds between heartbeat checks
  heartbeatTimeoutMs: 10000,        // 10 seconds to wait for heartbeat response
  degradedThresholdMs: 45000,       // 45 seconds without heartbeat = degraded
  unhealthyThresholdMs: 90000,      // 90 seconds without heartbeat = unhealthy
  maxConsecutiveFailures: 3         // Trigger reconnect after 3 consecutive failures
}

/**
 * IBConnectionMonitor - Active health monitoring for IB connections
 */
export class IBConnectionMonitor {
  constructor() {
    this.heartbeatTimer = null
    this.lastHeartbeatSent = null
    this.lastHeartbeatReceived = null
    this.consecutiveFailures = 0
    this.totalHeartbeats = 0
    this.successfulHeartbeats = 0
    this.monitoring = false
    this.healthStatus = HealthStatus.DISCONNECTED
    this.listeners = new Set()
    this.pendingHeartbeat = null
    this.startTime = null
  }

  /**
   * Start connection monitoring
   */
  start() {
    if (this.monitoring) {
      console.log('[IBConnectionMonitor] Already monitoring')
      return { success: true, alreadyMonitoring: true }
    }

    this.monitoring = true
    this.startTime = new Date()
    this.consecutiveFailures = 0

    // Subscribe to connector events
    this.setupConnectorListeners()

    // Start heartbeat interval
    this.startHeartbeatInterval()

    // Initial health check based on current state
    this.updateHealthStatus()

    db.logActivity('IB_MONITOR_STARTED', 'Connection monitoring started', {
      heartbeatInterval: MONITOR_CONFIG.heartbeatIntervalMs
    })

    console.log('[IBConnectionMonitor] Started monitoring with 30s heartbeat interval')

    return { success: true, status: this.getStatus() }
  }

  /**
   * Stop connection monitoring
   */
  stop() {
    if (!this.monitoring) {
      return { success: true, alreadyStopped: true }
    }

    this.monitoring = false
    this.clearHeartbeatInterval()

    db.logActivity('IB_MONITOR_STOPPED', 'Connection monitoring stopped')
    console.log('[IBConnectionMonitor] Stopped monitoring')

    return { success: true }
  }

  /**
   * Setup listeners for IBConnector events
   */
  setupConnectorListeners() {
    // Listen for connection state changes
    ibConnector.on('stateChange', ({ oldState, newState }) => {
      console.log(`[IBConnectionMonitor] State change: ${oldState} -> ${newState}`)
      this.updateHealthStatus()

      if (newState === ConnectionState.CONNECTED) {
        // Reset failures on successful connection
        this.consecutiveFailures = 0
        // Send immediate heartbeat
        this.sendHeartbeat()
      }
    })

    // Listen for server time (heartbeat response)
    ibConnector.on('serverTime', (serverTime) => {
      this.handleHeartbeatResponse(serverTime)
    })

    // Listen for errors that might indicate connection issues
    ibConnector.on('error', ({ code, error }) => {
      // Connection-related errors
      if ([502, 503, 504, 1100].includes(code)) {
        this.handleConnectionError(code, error)
      }
    })
  }

  /**
   * Start the heartbeat interval
   */
  startHeartbeatInterval() {
    this.clearHeartbeatInterval()

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, MONITOR_CONFIG.heartbeatIntervalMs)

    // Send initial heartbeat if connected
    if (ibConnector.isConnected()) {
      this.sendHeartbeat()
    }
  }

  /**
   * Clear the heartbeat interval
   */
  clearHeartbeatInterval() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (this.pendingHeartbeat) {
      clearTimeout(this.pendingHeartbeat)
      this.pendingHeartbeat = null
    }
  }

  /**
   * Send a heartbeat request
   */
  sendHeartbeat() {
    if (!ibConnector.isConnected()) {
      this.updateHealthStatus()
      return
    }

    this.totalHeartbeats++
    this.lastHeartbeatSent = new Date()

    // Set timeout for heartbeat response
    this.pendingHeartbeat = setTimeout(() => {
      this.handleHeartbeatTimeout()
    }, MONITOR_CONFIG.heartbeatTimeoutMs)

    // Request server time as heartbeat
    try {
      ibConnector.requestServerTime()
    } catch (error) {
      console.error('[IBConnectionMonitor] Error sending heartbeat:', error.message)
      this.handleHeartbeatFailure('Request failed')
    }
  }

  /**
   * Handle successful heartbeat response
   */
  handleHeartbeatResponse(serverTime) {
    if (this.pendingHeartbeat) {
      clearTimeout(this.pendingHeartbeat)
      this.pendingHeartbeat = null
    }

    this.lastHeartbeatReceived = new Date()
    this.successfulHeartbeats++
    this.consecutiveFailures = 0

    const latency = this.lastHeartbeatSent
      ? this.lastHeartbeatReceived - this.lastHeartbeatSent
      : 0

    // Update health status
    this.updateHealthStatus()

    // Notify listeners
    this.notifyListeners('heartbeat', {
      serverTime,
      latency,
      healthStatus: this.healthStatus
    })
  }

  /**
   * Handle heartbeat timeout
   */
  handleHeartbeatTimeout() {
    this.pendingHeartbeat = null
    this.handleHeartbeatFailure('Timeout')
  }

  /**
   * Handle heartbeat failure
   */
  handleHeartbeatFailure(reason) {
    this.consecutiveFailures++

    console.warn(`[IBConnectionMonitor] Heartbeat failed: ${reason} (${this.consecutiveFailures}/${MONITOR_CONFIG.maxConsecutiveFailures})`)

    db.logActivity('IB_HEARTBEAT_FAILED', `Heartbeat failed: ${reason}`, {
      consecutiveFailures: this.consecutiveFailures,
      lastSuccess: this.lastHeartbeatReceived?.toISOString()
    })

    this.updateHealthStatus()

    // Trigger reconnect if too many consecutive failures
    if (this.consecutiveFailures >= MONITOR_CONFIG.maxConsecutiveFailures) {
      this.triggerReconnect()
    }

    // Notify listeners
    this.notifyListeners('heartbeatFailed', {
      reason,
      consecutiveFailures: this.consecutiveFailures,
      healthStatus: this.healthStatus
    })
  }

  /**
   * Handle connection error
   */
  handleConnectionError(code, error) {
    console.warn(`[IBConnectionMonitor] Connection error ${code}: ${error}`)
    this.updateHealthStatus()
  }

  /**
   * Trigger a reconnection attempt
   */
  triggerReconnect() {
    console.warn('[IBConnectionMonitor] Triggering reconnection due to heartbeat failures')

    db.logActivity('IB_MONITOR_RECONNECT', 'Monitor triggering reconnection', {
      consecutiveFailures: this.consecutiveFailures
    })

    // The connector's disconnect handler will trigger reconnect
    // We just need to force a disconnect if not already handled
    if (ibConnector.state === ConnectionState.CONNECTED) {
      // Force state to ERROR to trigger reconnect
      ibConnector.setState(ConnectionState.ERROR)
      ibConnector.scheduleReconnect()
    }
  }

  /**
   * Update health status based on current state
   */
  updateHealthStatus() {
    const previousStatus = this.healthStatus

    // Check connection state first
    if (!ibConnector.isConnected()) {
      if (ibConnector.state === ConnectionState.RECONNECTING) {
        this.healthStatus = HealthStatus.UNHEALTHY
      } else {
        this.healthStatus = HealthStatus.DISCONNECTED
      }
    } else {
      // Connected - check heartbeat timing
      const now = Date.now()
      const lastHeartbeat = this.lastHeartbeatReceived?.getTime() || 0
      const timeSinceHeartbeat = now - lastHeartbeat

      if (lastHeartbeat === 0 || timeSinceHeartbeat < MONITOR_CONFIG.degradedThresholdMs) {
        this.healthStatus = HealthStatus.HEALTHY
      } else if (timeSinceHeartbeat < MONITOR_CONFIG.unhealthyThresholdMs) {
        this.healthStatus = HealthStatus.DEGRADED
      } else {
        this.healthStatus = HealthStatus.UNHEALTHY
      }
    }

    // Log status changes
    if (previousStatus !== this.healthStatus) {
      console.log(`[IBConnectionMonitor] Health status: ${previousStatus} -> ${this.healthStatus}`)

      db.logActivity('IB_HEALTH_CHANGED', `Health status: ${this.healthStatus}`, {
        previousStatus,
        newStatus: this.healthStatus
      })

      this.notifyListeners('healthChange', {
        previousStatus,
        newStatus: this.healthStatus
      })
    }
  }

  /**
   * Get comprehensive connection status
   */
  getStatus() {
    const connectorStatus = ibConnector.getStatus()
    const now = Date.now()

    // Calculate uptime
    const uptime = this.startTime
      ? Math.floor((now - this.startTime.getTime()) / 1000)
      : 0

    // Calculate success rate
    const successRate = this.totalHeartbeats > 0
      ? ((this.successfulHeartbeats / this.totalHeartbeats) * 100).toFixed(1)
      : 0

    // Time since last heartbeat
    const timeSinceLastHeartbeat = this.lastHeartbeatReceived
      ? Math.floor((now - this.lastHeartbeatReceived.getTime()) / 1000)
      : null

    return {
      // Connection state
      ...connectorStatus,

      // Health metrics
      health: {
        status: this.healthStatus,
        monitoring: this.monitoring,
        uptime,
        lastHeartbeatSent: this.lastHeartbeatSent?.toISOString(),
        lastHeartbeatReceived: this.lastHeartbeatReceived?.toISOString(),
        timeSinceLastHeartbeatSeconds: timeSinceLastHeartbeat,
        consecutiveFailures: this.consecutiveFailures,
        totalHeartbeats: this.totalHeartbeats,
        successfulHeartbeats: this.successfulHeartbeats,
        successRate: parseFloat(successRate)
      },

      // Configuration
      config: {
        heartbeatIntervalMs: MONITOR_CONFIG.heartbeatIntervalMs,
        heartbeatTimeoutMs: MONITOR_CONFIG.heartbeatTimeoutMs,
        degradedThresholdMs: MONITOR_CONFIG.degradedThresholdMs,
        unhealthyThresholdMs: MONITOR_CONFIG.unhealthyThresholdMs,
        maxConsecutiveFailures: MONITOR_CONFIG.maxConsecutiveFailures
      }
    }
  }

  /**
   * Get simple health check result
   */
  isHealthy() {
    return this.healthStatus === HealthStatus.HEALTHY
  }

  /**
   * Manual health check (force immediate heartbeat)
   */
  async checkHealth() {
    if (!ibConnector.isConnected()) {
      return {
        healthy: false,
        status: this.healthStatus,
        reason: 'Not connected to IB'
      }
    }

    return new Promise((resolve) => {
      const startTime = Date.now()

      // Set up one-time listener for server time
      const timeout = setTimeout(() => {
        resolve({
          healthy: false,
          status: HealthStatus.UNHEALTHY,
          reason: 'Health check timeout',
          latency: null
        })
      }, MONITOR_CONFIG.heartbeatTimeoutMs)

      const unsubscribe = ibConnector.on('serverTime', (serverTime) => {
        clearTimeout(timeout)
        unsubscribe()

        const latency = Date.now() - startTime
        resolve({
          healthy: true,
          status: HealthStatus.HEALTHY,
          latency,
          serverTime
        })
      })

      ibConnector.requestServerTime()
    })
  }

  /**
   * Add event listener
   */
  addListener(callback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  /**
   * Notify all listeners
   */
  notifyListeners(event, data) {
    for (const listener of this.listeners) {
      try {
        listener(event, data)
      } catch (error) {
        console.error(`[IBConnectionMonitor] Error in listener:`, error)
      }
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.totalHeartbeats = 0
    this.successfulHeartbeats = 0
    this.consecutiveFailures = 0
    this.lastHeartbeatSent = null
    this.lastHeartbeatReceived = null

    return { success: true, message: 'Statistics reset' }
  }
}

// Singleton instance
export const ibConnectionMonitor = new IBConnectionMonitor()
export default ibConnectionMonitor
