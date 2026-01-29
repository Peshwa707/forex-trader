/**
 * WinRateChart Component
 * Part of Phase A: Trust Foundation - Trade History & Learning Database
 *
 * Simple bar charts showing win rates by different dimensions
 */

import { BarChart2 } from 'lucide-react'
import './WinRateChart.css'

function WinRateBar({ label, winRate, trades, avgPnl, highlight = false }) {
  const getBarColor = (rate) => {
    if (rate >= 60) return '#3fb950' // green
    if (rate >= 50) return '#d29922' // yellow
    return '#f85149' // red
  }

  return (
    <div className={`win-rate-bar ${highlight ? 'highlight' : ''}`}>
      <div className="bar-label">{label}</div>
      <div className="bar-container">
        <div
          className="bar-fill"
          style={{
            width: `${Math.min(winRate, 100)}%`,
            backgroundColor: getBarColor(winRate)
          }}
        />
        <span className="bar-value">{winRate}%</span>
      </div>
      <div className="bar-meta">
        <span className="trades-count">{trades} trades</span>
        <span className={`avg-pnl ${avgPnl >= 0 ? 'positive' : 'negative'}`}>
          {avgPnl >= 0 ? '+' : ''}${avgPnl?.toFixed(2) || '0.00'}
        </span>
      </div>
    </div>
  )
}

export function WinRateChart({ data, title, labelKey = 'label', emptyMessage = 'No data available' }) {
  if (!data || data.length === 0) {
    return (
      <div className="win-rate-chart">
        <h4 className="chart-title">{title}</h4>
        <div className="chart-empty">
          <BarChart2 size={24} />
          <span>{emptyMessage}</span>
        </div>
      </div>
    )
  }

  // Find best and worst for highlighting
  const maxWinRate = Math.max(...data.map(d => d.winRate || 0))
  const minWinRate = Math.min(...data.map(d => d.winRate || 100))

  return (
    <div className="win-rate-chart">
      <h4 className="chart-title">{title}</h4>
      <div className="chart-bars">
        {data.map((item, index) => (
          <WinRateBar
            key={index}
            label={item[labelKey] || item.label || item.hour || item.dayName || item.session || item.zone || item.pair || item.trend || `Item ${index}`}
            winRate={item.winRate || 0}
            trades={item.trades || 0}
            avgPnl={item.avgPnl || 0}
            highlight={item.winRate === maxWinRate || item.winRate === minWinRate}
          />
        ))}
      </div>
    </div>
  )
}

export function WinRateByHour({ data }) {
  const formattedData = data?.map(item => ({
    ...item,
    label: item.hour < 12 ? `${item.hour}am` : item.hour === 12 ? '12pm' : `${item.hour - 12}pm`
  })) || []

  return <WinRateChart data={formattedData} title="Win Rate by Hour (UTC)" />
}

export function WinRateByDay({ data }) {
  return <WinRateChart data={data} title="Win Rate by Day of Week" labelKey="dayName" />
}

export function WinRateBySession({ data }) {
  return <WinRateChart data={data} title="Win Rate by Market Session" labelKey="session" />
}

export function WinRateByRSI({ data }) {
  return <WinRateChart data={data} title="Win Rate by RSI Zone" labelKey="zone" />
}

export function WinRateByPair({ data }) {
  return <WinRateChart data={data} title="Win Rate by Currency Pair" labelKey="pair" />
}

export function WinRateByTrend({ data }) {
  return <WinRateChart data={data} title="Win Rate by Trend Direction" labelKey="trend" />
}

export default WinRateChart
