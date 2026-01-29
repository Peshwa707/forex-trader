/**
 * RiskGauge Component
 * Visual gauge showing progress toward risk limits
 * Part of Phase A: Trust Foundation
 */

import { AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react'
import './RiskGauge.css'

export default function RiskGauge({
  label,
  current,
  limit,
  usagePercent,
  status,
  formatCurrent = (v) => v,
  formatLimit = (v) => v,
  showValues = true
}) {
  const getStatusIcon = () => {
    switch (status) {
      case 'critical':
        return <AlertTriangle size={14} className="status-icon critical" />
      case 'warning':
        return <AlertCircle size={14} className="status-icon warning" />
      default:
        return <CheckCircle size={14} className="status-icon normal" />
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'critical':
        return '#f85149'
      case 'warning':
        return '#d29922'
      default:
        return '#3fb950'
    }
  }

  return (
    <div className={`risk-gauge ${status}`}>
      <div className="gauge-header">
        {getStatusIcon()}
        <span className="gauge-label">{label}</span>
      </div>

      <div className="gauge-bar-container">
        <div
          className="gauge-bar-fill"
          style={{
            width: `${Math.min(100, usagePercent)}%`,
            backgroundColor: getStatusColor()
          }}
        />
        {/* Warning threshold markers */}
        <div className="gauge-marker warning-marker" style={{ left: '50%' }} />
        <div className="gauge-marker critical-marker" style={{ left: '80%' }} />
      </div>

      {showValues && (
        <div className="gauge-values">
          <span className="gauge-current">{formatCurrent(current)}</span>
          <span className="gauge-separator">of</span>
          <span className="gauge-limit">{formatLimit(limit)} limit</span>
          <span className="gauge-percent">[{usagePercent.toFixed(0)}%]</span>
        </div>
      )}
    </div>
  )
}

/**
 * Compact inline gauge for tight spaces
 */
export function RiskGaugeCompact({ label, usagePercent, status }) {
  const getStatusColor = () => {
    switch (status) {
      case 'critical':
        return '#f85149'
      case 'warning':
        return '#d29922'
      default:
        return '#3fb950'
    }
  }

  return (
    <div className={`risk-gauge-compact ${status}`}>
      <span className="compact-label">{label}</span>
      <div className="compact-bar">
        <div
          className="compact-fill"
          style={{
            width: `${Math.min(100, usagePercent)}%`,
            backgroundColor: getStatusColor()
          }}
        />
      </div>
      <span className="compact-percent">{usagePercent.toFixed(0)}%</span>
    </div>
  )
}
