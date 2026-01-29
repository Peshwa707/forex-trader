/**
 * RiskDashboard Component
 * Combined risk status display with visual gauges
 * Part of Phase A: Trust Foundation
 */

import { Shield, AlertTriangle, Check, X } from 'lucide-react'
import RiskGauge from './RiskGauge'
import './RiskDashboard.css'

export default function RiskDashboard({ riskStatus, onKillSwitch }) {
  if (!riskStatus) {
    return (
      <div className="risk-dashboard loading">
        <Shield size={20} />
        <span>Loading risk status...</span>
      </div>
    )
  }

  const { dailyPnL, perTradeRisk, openTrades, killSwitch, riskLevel } = riskStatus

  const formatCurrency = (value) => {
    const sign = value >= 0 ? '' : '-'
    return `${sign}$${Math.abs(value).toFixed(0)}`
  }

  const formatCurrencyLimit = (value) => `$${value.toFixed(0)}`

  const getOverallStatus = () => {
    if (riskLevel === 'STOPPED' || riskLevel === 'CRITICAL') return 'critical'
    if (riskLevel === 'ELEVATED') return 'warning'
    return 'normal'
  }

  return (
    <div className={`risk-dashboard ${getOverallStatus()}`}>
      <div className="risk-header">
        <Shield size={18} className="risk-icon" />
        <span className="risk-title">RISK STATUS</span>
        <span className={`risk-level-badge ${riskLevel.toLowerCase()}`}>
          {riskLevel}
        </span>
      </div>

      <div className="risk-gauges">
        {/* Daily P/L Gauge */}
        <RiskGauge
          label="Daily P/L"
          current={dailyPnL.current}
          limit={dailyPnL.limit}
          usagePercent={dailyPnL.usagePercent}
          status={dailyPnL.status}
          formatCurrent={formatCurrency}
          formatLimit={formatCurrencyLimit}
        />

        {/* Per-Trade Risk Gauge */}
        <RiskGauge
          label="Per-Trade Risk"
          current={perTradeRisk.current}
          limit={perTradeRisk.limit}
          usagePercent={perTradeRisk.usagePercent}
          status={perTradeRisk.status}
          formatCurrent={formatCurrencyLimit}
          formatLimit={formatCurrencyLimit}
        />

        {/* Open Trades Gauge */}
        <RiskGauge
          label="Open Trades"
          current={openTrades.current}
          limit={openTrades.limit}
          usagePercent={openTrades.usagePercent}
          status={openTrades.status}
          formatCurrent={(v) => v}
          formatLimit={(v) => `${v} max`}
        />
      </div>

      {/* Kill Switch Status */}
      <div className={`kill-switch-status ${killSwitch.triggered ? 'triggered' : 'armed'}`}>
        <AlertTriangle size={14} />
        <span className="kill-switch-label">Kill Switch:</span>
        <span className="kill-switch-state">
          {killSwitch.triggered ? (
            <>
              <X size={12} /> TRIGGERED
            </>
          ) : (
            <>
              <Check size={12} /> ARMED
            </>
          )}
        </span>
        <span className="kill-switch-condition">
          ({killSwitch.triggerCondition})
        </span>
        {onKillSwitch && (
          <button
            className="kill-switch-btn"
            onClick={onKillSwitch}
            title="Trigger emergency stop"
          >
            KILL
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Compact inline risk summary for header bar
 */
export function RiskStatusBadge({ riskStatus }) {
  if (!riskStatus) return null

  const { riskLevel, dailyPnL, openTrades } = riskStatus

  const getBadgeColor = () => {
    switch (riskLevel) {
      case 'STOPPED':
      case 'CRITICAL':
        return '#f85149'
      case 'ELEVATED':
        return '#d29922'
      default:
        return '#3fb950'
    }
  }

  return (
    <div className="risk-status-badge" style={{ borderColor: getBadgeColor() }}>
      <Shield size={12} style={{ color: getBadgeColor() }} />
      <span className="badge-pnl" style={{ color: dailyPnL.current >= 0 ? '#3fb950' : '#f85149' }}>
        {dailyPnL.current >= 0 ? '+' : ''}${dailyPnL.current.toFixed(0)}
      </span>
      <span className="badge-sep">|</span>
      <span className="badge-trades">{openTrades.current}/{openTrades.limit}</span>
    </div>
  )
}
