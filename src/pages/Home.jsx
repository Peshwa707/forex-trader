import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Bell, ClipboardList, DollarSign, Activity } from 'lucide-react'
import { fetchLiveRates, formatRate, CURRENCY_PAIRS } from '../services/forexApi'
import './Home.css'

export default function Home() {
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ totalTrades: 0, winRate: 0, totalPnL: 0 })

  useEffect(() => {
    loadRates()
    loadStats()
    const interval = setInterval(loadRates, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  const loadRates = async () => {
    const data = await fetchLiveRates()
    setRates(data.slice(0, 4)) // Show top 4 pairs on home
    setLoading(false)
  }

  const loadStats = () => {
    const trades = JSON.parse(localStorage.getItem('forex_trades') || '[]')
    const wins = trades.filter(t => t.pnl > 0).length
    const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0)

    setStats({
      totalTrades: trades.length,
      winRate: trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : 0,
      totalPnL
    })
  }

  const alerts = JSON.parse(localStorage.getItem('forex_alerts') || '[]')
  const activeAlerts = alerts.filter(a => a.active).length

  return (
    <div className="page home-page">
      <header className="home-header">
        <h1>Forex Trader</h1>
        <p>Real-time rates & trading tools</p>
      </header>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">
            <ClipboardList size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats.totalTrades}</span>
            <span className="stat-label">Total Trades</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon win">
            <Activity size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats.winRate}%</span>
            <span className="stat-label">Win Rate</span>
          </div>
        </div>

        <div className="stat-card">
          <div className={`stat-icon ${stats.totalPnL >= 0 ? 'profit' : 'loss'}`}>
            <DollarSign size={20} />
          </div>
          <div className="stat-info">
            <span className={`stat-value ${stats.totalPnL >= 0 ? 'profit' : 'loss'}`}>
              {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toFixed(2)}
            </span>
            <span className="stat-label">Total P/L</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon alert">
            <Bell size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{activeAlerts}</span>
            <span className="stat-label">Active Alerts</span>
          </div>
        </div>
      </div>

      {/* Live Rates Preview */}
      <section className="section">
        <div className="section-header">
          <h2>Live Rates</h2>
          <Link to="/prices" className="view-all">View All</Link>
        </div>

        {loading ? (
          <div className="loading">Loading rates...</div>
        ) : (
          <div className="rates-preview">
            {rates.map(rate => (
              <div key={rate.pair} className="rate-card">
                <div className="rate-pair">
                  <span className="pair-name">{rate.pair}</span>
                  <span className={`rate-change ${rate.change >= 0 ? 'profit' : 'loss'}`}>
                    {rate.change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {rate.change >= 0 ? '+' : ''}{(rate.changePercent).toFixed(2)}%
                  </span>
                </div>
                <div className="rate-price">{formatRate(rate.pair, rate.rate)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick Actions */}
      <section className="section">
        <h2>Quick Actions</h2>
        <div className="quick-actions">
          <Link to="/signals" className="action-btn">
            <Bell size={20} />
            <span>Set Alert</span>
          </Link>
          <Link to="/journal" className="action-btn">
            <ClipboardList size={20} />
            <span>Log Trade</span>
          </Link>
        </div>
      </section>

      {/* Market Status */}
      <section className="market-status card">
        <h3>Market Sessions</h3>
        <div className="sessions">
          <MarketSession name="Sydney" open="22:00" close="07:00" />
          <MarketSession name="Tokyo" open="00:00" close="09:00" />
          <MarketSession name="London" open="08:00" close="17:00" />
          <MarketSession name="New York" open="13:00" close="22:00" />
        </div>
      </section>
    </div>
  )
}

function MarketSession({ name, open, close }) {
  const now = new Date()
  const hour = now.getUTCHours()

  const openHour = parseInt(open.split(':')[0])
  const closeHour = parseInt(close.split(':')[0])

  let isOpen = false
  if (openHour < closeHour) {
    isOpen = hour >= openHour && hour < closeHour
  } else {
    isOpen = hour >= openHour || hour < closeHour
  }

  return (
    <div className={`session ${isOpen ? 'open' : 'closed'}`}>
      <span className="session-name">{name}</span>
      <span className="session-status">{isOpen ? 'Open' : 'Closed'}</span>
      <span className="session-hours">{open} - {close} UTC</span>
    </div>
  )
}
