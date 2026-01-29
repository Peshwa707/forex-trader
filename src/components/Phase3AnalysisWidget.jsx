/**
 * Phase 3 Analysis Widget
 * Displays Hurst exponent, order flow, and ensemble prediction status
 */

import { useState, useEffect } from 'react'
import { Activity, TrendingUp, TrendingDown, Minus, Users, BarChart3, Zap, Settings } from 'lucide-react'
import { analysisApi } from '../services/api'
import './Phase3AnalysisWidget.css'

// Market character display mapping
const CHARACTER_DISPLAY = {
  STRONG_TREND: { label: 'Strong Trend', color: '#22c55e', icon: TrendingUp },
  TRENDING: { label: 'Trending', color: '#84cc16', icon: TrendingUp },
  RANDOM: { label: 'Random Walk', color: '#f59e0b', icon: Minus },
  MEAN_REVERTING: { label: 'Mean Reverting', color: '#f97316', icon: TrendingDown },
  STRONG_MEAN_REVERT: { label: 'Strong Revert', color: '#ef4444', icon: TrendingDown }
}

// Flow signal display
const FLOW_DISPLAY = {
  STRONG_BUY: { label: 'Strong Buy', color: '#22c55e' },
  BUY: { label: 'Buy', color: '#84cc16' },
  NEUTRAL: { label: 'Neutral', color: '#6b7280' },
  SELL: { label: 'Sell', color: '#f97316' },
  STRONG_SELL: { label: 'Strong Sell', color: '#ef4444' }
}

export default function Phase3AnalysisWidget() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)

  const loadStatus = async () => {
    try {
      setLoading(true)
      const data = await analysisApi.getAllStatus()
      setStatus(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    const interval = setInterval(loadStatus, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [])

  const togglePhase3 = async (enabled) => {
    try {
      await analysisApi.togglePhase3(enabled)
      loadStatus()
    } catch (err) {
      console.error('Failed to toggle Phase 3:', err)
    }
  }

  if (loading && !status) {
    return (
      <div className="phase3-widget loading">
        <Activity className="spin" size={20} />
        <span>Loading Phase 3 Analysis...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="phase3-widget error">
        <span>Error: {error}</span>
      </div>
    )
  }

  const hurst = status?.hurstAnalysis || {}
  const orderFlow = status?.orderFlow || {}
  const ensemble = status?.ensemble || {}

  // Check if any Phase 3 feature is enabled
  const anyEnabled = hurst.enabled || orderFlow.enabled || ensemble.enabled

  return (
    <div className={`phase3-widget ${anyEnabled ? 'enabled' : 'disabled'}`}>
      <div className="widget-header" onClick={() => setExpanded(!expanded)}>
        <div className="header-left">
          <BarChart3 size={18} />
          <span className="widget-title">Phase 3 Analysis</span>
          <span className={`status-badge ${anyEnabled ? 'on' : 'off'}`}>
            {anyEnabled ? 'Active' : 'Disabled'}
          </span>
        </div>
        <div className="header-right">
          <button
            className={`toggle-btn ${anyEnabled ? 'enabled' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              togglePhase3(!anyEnabled)
            }}
          >
            {anyEnabled ? 'Disable' : 'Enable'}
          </button>
          <Settings size={16} className={expanded ? 'rotated' : ''} />
        </div>
      </div>

      {expanded && (
        <div className="widget-content">
          {/* Hurst Analysis Section */}
          <div className="analysis-section">
            <div className="section-header">
              <TrendingUp size={14} />
              <span>Hurst Exponent</span>
              <span className={`mini-badge ${hurst.enabled ? 'on' : 'off'}`}>
                {hurst.enabled ? 'ON' : 'OFF'}
              </span>
            </div>
            {hurst.enabled && (
              <div className="section-content">
                <div className="stat-row">
                  <span className="stat-label">Lookback</span>
                  <span className="stat-value">{hurst.lookback} periods</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Min Data</span>
                  <span className="stat-value">{hurst.minDataPoints} points</span>
                </div>
                {hurst.cachedValues && Object.keys(hurst.cachedValues).length > 0 && (
                  <div className="cached-values">
                    <span className="cache-label">Recent Values:</span>
                    {Object.entries(hurst.cachedValues).map(([pair, data]) => {
                      const charInfo = CHARACTER_DISPLAY[data.character] || CHARACTER_DISPLAY.RANDOM
                      const CharIcon = charInfo.icon
                      return (
                        <div key={pair} className="cache-item">
                          <span className="pair">{pair}</span>
                          <span className="hurst-value">H={data.hurst}</span>
                          <span className="character" style={{ color: charInfo.color }}>
                            <CharIcon size={12} />
                            {charInfo.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Order Flow Section */}
          <div className="analysis-section">
            <div className="section-header">
              <Activity size={14} />
              <span>Order Flow</span>
              <span className={`mini-badge ${orderFlow.enabled ? 'on' : 'off'}`}>
                {orderFlow.enabled ? 'ON' : 'OFF'}
              </span>
            </div>
            {orderFlow.enabled && (
              <div className="section-content">
                <div className="stat-row">
                  <span className="stat-label">Lookback</span>
                  <span className="stat-value">{orderFlow.lookback} periods</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Pressure Threshold</span>
                  <span className="stat-value">{orderFlow.pressureThreshold}%</span>
                </div>
                {orderFlow.cachedValues && Object.keys(orderFlow.cachedValues).length > 0 && (
                  <div className="cached-values">
                    <span className="cache-label">Recent Signals:</span>
                    {Object.entries(orderFlow.cachedValues).map(([pair, data]) => {
                      const flowInfo = FLOW_DISPLAY[data.signal] || FLOW_DISPLAY.NEUTRAL
                      return (
                        <div key={pair} className="cache-item">
                          <span className="pair">{pair}</span>
                          <span className="flow-signal" style={{ color: flowInfo.color }}>
                            {flowInfo.label}
                          </span>
                          <span className="pressure">
                            Buy: {data.buyPressure}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Ensemble Section */}
          <div className="analysis-section">
            <div className="section-header">
              <Users size={14} />
              <span>Ensemble Prediction</span>
              <span className={`mini-badge ${ensemble.enabled ? 'on' : 'off'}`}>
                {ensemble.enabled ? 'ON' : 'OFF'}
              </span>
            </div>
            {ensemble.enabled && (
              <div className="section-content">
                <div className="stat-row">
                  <span className="stat-label">Method</span>
                  <span className="stat-value">{ensemble.method?.replace(/_/g, ' ')}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Min Agreement</span>
                  <span className="stat-value">{(ensemble.minAgreement * 100).toFixed(0)}%</span>
                </div>
                {ensemble.weights && (
                  <div className="weights-grid">
                    <span className="weight-label">Weights:</span>
                    {Object.entries(ensemble.weights).map(([method, weight]) => (
                      <div key={method} className="weight-item">
                        <span className="method-name">{method}</span>
                        <div className="weight-bar">
                          <div
                            className="weight-fill"
                            style={{ width: `${weight * 100}%` }}
                          />
                        </div>
                        <span className="weight-value">{(weight * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {ensemble.methodPerformance && Object.keys(ensemble.methodPerformance).length > 0 && (
                  <div className="performance-grid">
                    <span className="perf-label">Performance:</span>
                    {Object.entries(ensemble.methodPerformance).map(([method, perf]) => (
                      <div key={method} className="perf-item">
                        <span className="method-name">{method}</span>
                        <span className="accuracy">{perf.accuracy}</span>
                        <span className="trades">({perf.trades} trades)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick summary when collapsed */}
      {!expanded && anyEnabled && (
        <div className="quick-summary">
          {hurst.enabled && <span className="summary-item"><TrendingUp size={12} /> Hurst</span>}
          {orderFlow.enabled && <span className="summary-item"><Activity size={12} /> Flow</span>}
          {ensemble.enabled && <span className="summary-item"><Users size={12} /> Ensemble</span>}
        </div>
      )}
    </div>
  )
}
