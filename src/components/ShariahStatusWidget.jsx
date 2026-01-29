/**
 * Shariah Status Widget
 * Displays Islamic finance compliance status in the trading bot UI
 *
 * Shows:
 * - Toggle for Shariah mode
 * - Swap deadline countdown
 * - Current leverage gauge
 * - Compliance status indicator
 */

import { useState, useEffect, useRef } from 'react'
import { Moon, Clock, Scale, Shield, AlertTriangle, Check, X } from 'lucide-react'
import { shariahApi } from '../services/api'
import './ShariahStatusWidget.css'

export default function ShariahStatusWidget({ onStatusChange }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const intervalRef = useRef(null)

  const loadStatus = async () => {
    try {
      const data = await shariahApi.getStatus()
      setStatus(data)
      if (onStatusChange) onStatusChange(data)
    } catch (error) {
      console.error('Failed to load Shariah status:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    // Refresh every 30 seconds for swap deadline updates
    intervalRef.current = setInterval(loadStatus, 30000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const handleToggle = async () => {
    if (toggling) return
    setToggling(true)
    try {
      const newEnabled = !status?.enabled
      await shariahApi.toggle(newEnabled)
      await loadStatus()
    } catch (error) {
      alert(`Failed to toggle Shariah mode: ${error.message}`)
    } finally {
      setToggling(false)
    }
  }

  const handleCloseAll = async () => {
    if (!confirm('Close all positions for Shariah compliance (swap prevention)?')) {
      return
    }
    try {
      const result = await shariahApi.closeAll()
      alert(result.message)
      await loadStatus()
    } catch (error) {
      alert(`Failed to close positions: ${error.message}`)
    }
  }

  if (loading) {
    return (
      <div className="shariah-widget shariah-loading">
        <Moon size={16} className="shariah-icon spinning" />
        <span>Loading Shariah status...</span>
      </div>
    )
  }

  // Not enabled - show minimal toggle
  if (!status?.enabled) {
    return (
      <div className="shariah-widget shariah-disabled">
        <div className="shariah-main">
          <Moon size={16} className="shariah-icon" />
          <span className="shariah-label">Shariah Mode</span>
          <span className="shariah-status-text">Disabled</span>
        </div>
        <button
          className="shariah-toggle-btn"
          onClick={handleToggle}
          disabled={toggling}
        >
          {toggling ? 'Enabling...' : 'Enable'}
        </button>
      </div>
    )
  }

  // Enabled - show full widget
  const { swapDeadline, currentLeverage, maxLeverage, leverageOK, tradingAllowed, activeTrades, message } = status

  const leveragePercent = Math.min((parseFloat(currentLeverage) / maxLeverage) * 100, 100)
  const leverageColor = leveragePercent > 80 ? 'danger' : leveragePercent > 60 ? 'warning' : 'safe'

  const formatTime = (minutes) => {
    if (minutes <= 0) return 'Now'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <div className={`shariah-widget shariah-enabled ${!tradingAllowed ? 'shariah-paused' : ''}`}>
      {/* Header */}
      <div className="shariah-header">
        <div className="shariah-title">
          <Moon size={16} className="shariah-icon" />
          <span>Shariah Mode</span>
          <span className="shariah-badge">Active</span>
        </div>
        <button
          className="shariah-toggle-btn danger"
          onClick={handleToggle}
          disabled={toggling}
        >
          {toggling ? '...' : 'Disable'}
        </button>
      </div>

      {/* Status Row */}
      <div className="shariah-status-row">
        {/* Trading Status */}
        <div className={`shariah-status-item ${tradingAllowed ? 'ok' : 'blocked'}`}>
          {tradingAllowed ? <Check size={14} /> : <X size={14} />}
          <span>{tradingAllowed ? 'Trading Allowed' : 'Trading Paused'}</span>
        </div>

        {/* Swap Deadline */}
        {swapDeadline && (
          <div className={`shariah-status-item ${swapDeadline.withinOneHour ? 'warning' : swapDeadline.pastCutoff ? 'blocked' : 'ok'}`}>
            <Clock size={14} />
            <span>
              {swapDeadline.pastCutoff
                ? 'Past cutoff'
                : `Cutoff: ${formatTime(swapDeadline.minutesUntilCutoff)}`}
            </span>
          </div>
        )}
      </div>

      {/* Leverage Gauge */}
      <div className="shariah-leverage">
        <div className="shariah-leverage-header">
          <Scale size={14} />
          <span>Leverage: 1:{parseFloat(currentLeverage).toFixed(1)} / 1:{maxLeverage}</span>
          {!leverageOK && <AlertTriangle size={14} className="leverage-warning" />}
        </div>
        <div className="shariah-leverage-bar">
          <div
            className={`shariah-leverage-fill ${leverageColor}`}
            style={{ width: `${leveragePercent}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="shariah-footer">
        <span className="shariah-message">{message}</span>
        {activeTrades > 0 && !tradingAllowed && (
          <button className="shariah-close-btn" onClick={handleCloseAll}>
            Close {activeTrades} Position{activeTrades > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Swap Time Info (tooltip-style) */}
      {swapDeadline && (
        <div className="shariah-time-info">
          <span>EST Time: {swapDeadline.currentTimeEST}</span>
          <span>Cutoff: {swapDeadline.cutoffTimeEST}</span>
          <span>Swap: {swapDeadline.swapTimeEST}</span>
        </div>
      )}
    </div>
  )
}
