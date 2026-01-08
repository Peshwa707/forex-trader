import { useState, useEffect } from 'react'
import { Bell, Plus, Trash2, TrendingUp, TrendingDown, Settings, X } from 'lucide-react'
import { CURRENCY_PAIRS, fetchLiveRates, formatRate } from '../services/forexApi'
import './Signals.css'

export default function Signals() {
  const [alerts, setAlerts] = useState(() => {
    return JSON.parse(localStorage.getItem('forex_alerts') || '[]')
  })
  const [showForm, setShowForm] = useState(false)
  const [rates, setRates] = useState([])
  const [activeTab, setActiveTab] = useState('alerts')

  // Form state
  const [selectedPair, setSelectedPair] = useState('EUR/USD')
  const [alertType, setAlertType] = useState('price_above')
  const [targetPrice, setTargetPrice] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    loadRates()
    const interval = setInterval(() => {
      loadRates()
      checkAlerts()
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    localStorage.setItem('forex_alerts', JSON.stringify(alerts))
  }, [alerts])

  const loadRates = async () => {
    const data = await fetchLiveRates()
    setRates(data)
  }

  const checkAlerts = () => {
    const currentRates = rates
    setAlerts(prev => prev.map(alert => {
      if (!alert.active || alert.triggered) return alert

      const rate = currentRates.find(r => r.pair === alert.pair)
      if (!rate) return alert

      let triggered = false
      if (alert.type === 'price_above' && rate.rate >= alert.targetPrice) {
        triggered = true
      } else if (alert.type === 'price_below' && rate.rate <= alert.targetPrice) {
        triggered = true
      }

      if (triggered) {
        // Show browser notification if supported
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`Forex Alert: ${alert.pair}`, {
            body: `Price ${alert.type === 'price_above' ? 'above' : 'below'} ${alert.targetPrice}`,
            icon: '/vite.svg'
          })
        }
        return { ...alert, triggered: true, triggeredAt: new Date().toISOString() }
      }

      return alert
    }))
  }

  const handleCreateAlert = (e) => {
    e.preventDefault()
    if (!targetPrice) return

    const newAlert = {
      id: Date.now(),
      pair: selectedPair,
      type: alertType,
      targetPrice: parseFloat(targetPrice),
      note,
      active: true,
      triggered: false,
      createdAt: new Date().toISOString()
    }

    setAlerts([newAlert, ...alerts])
    setShowForm(false)
    setTargetPrice('')
    setNote('')
  }

  const toggleAlert = (id) => {
    setAlerts(alerts.map(a => a.id === id ? { ...a, active: !a.active } : a))
  }

  const deleteAlert = (id) => {
    setAlerts(alerts.filter(a => a.id !== id))
  }

  const resetAlert = (id) => {
    setAlerts(alerts.map(a => a.id === id ? { ...a, triggered: false, triggeredAt: null } : a))
  }

  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      Notification.requestPermission()
    }
  }

  const currentRate = rates.find(r => r.pair === selectedPair)

  // Sample signals (you can replace with real signal provider)
  const sampleSignals = [
    { pair: 'EUR/USD', type: 'BUY', entry: 1.0850, tp: 1.0920, sl: 1.0800, confidence: 85 },
    { pair: 'GBP/USD', type: 'SELL', entry: 1.2680, tp: 1.2580, sl: 1.2750, confidence: 72 },
    { pair: 'USD/JPY', type: 'BUY', entry: 149.50, tp: 150.80, sl: 148.80, confidence: 78 },
  ]

  return (
    <div className="page signals-page">
      <header className="page-header">
        <h1>Signals & Alerts</h1>
      </header>

      <div className="tabs">
        <button className={`tab ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => setActiveTab('alerts')}>
          My Alerts
        </button>
        <button className={`tab ${activeTab === 'signals' ? 'active' : ''}`} onClick={() => setActiveTab('signals')}>
          Signals
        </button>
      </div>

      {activeTab === 'alerts' && (
        <>
          <button className="btn btn-primary add-alert-btn" onClick={() => setShowForm(true)}>
            <Plus size={18} />
            Create Alert
          </button>

          {/* Alert Form Modal */}
          {showForm && (
            <div className="modal-overlay" onClick={() => setShowForm(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Create Price Alert</h2>
                  <button className="close-btn" onClick={() => setShowForm(false)}>
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleCreateAlert}>
                  <div className="form-group">
                    <label>Currency Pair</label>
                    <select value={selectedPair} onChange={e => setSelectedPair(e.target.value)}>
                      {CURRENCY_PAIRS.map(p => (
                        <option key={p.pair} value={p.pair}>{p.pair}</option>
                      ))}
                    </select>
                  </div>

                  {currentRate && (
                    <div className="current-price-info">
                      Current: <strong>{formatRate(selectedPair, currentRate.rate)}</strong>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Alert Type</label>
                    <div className="alert-type-buttons">
                      <button
                        type="button"
                        className={`type-btn ${alertType === 'price_above' ? 'active buy' : ''}`}
                        onClick={() => setAlertType('price_above')}
                      >
                        <TrendingUp size={16} />
                        Price Above
                      </button>
                      <button
                        type="button"
                        className={`type-btn ${alertType === 'price_below' ? 'active sell' : ''}`}
                        onClick={() => setAlertType('price_below')}
                      >
                        <TrendingDown size={16} />
                        Price Below
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Target Price</label>
                    <input
                      type="number"
                      step="any"
                      value={targetPrice}
                      onChange={e => setTargetPrice(e.target.value)}
                      placeholder="Enter target price"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Note (optional)</label>
                    <input
                      type="text"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Add a note..."
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                    Create Alert
                  </button>
                </form>

                <button className="notification-btn" onClick={requestNotificationPermission}>
                  <Bell size={16} />
                  Enable Push Notifications
                </button>
              </div>
            </div>
          )}

          {/* Alerts List */}
          <div className="alerts-list">
            {alerts.length === 0 ? (
              <div className="empty-state">
                <Bell size={48} />
                <p>No alerts yet</p>
                <span>Create an alert to get notified when price hits your target</span>
              </div>
            ) : (
              alerts.map(alert => (
                <div key={alert.id} className={`alert-card card ${alert.triggered ? 'triggered' : ''} ${!alert.active ? 'inactive' : ''}`}>
                  <div className="alert-main">
                    <div className="alert-info">
                      <div className="alert-pair">
                        <h3>{alert.pair}</h3>
                        <span className={`badge ${alert.type === 'price_above' ? 'badge-buy' : 'badge-sell'}`}>
                          {alert.type === 'price_above' ? 'Above' : 'Below'}
                        </span>
                      </div>
                      <div className="alert-target">
                        Target: <strong>{formatRate(alert.pair, alert.targetPrice)}</strong>
                      </div>
                      {alert.note && <p className="alert-note">{alert.note}</p>}
                    </div>

                    <div className="alert-actions">
                      {alert.triggered ? (
                        <button className="btn btn-sm btn-outline" onClick={() => resetAlert(alert.id)}>
                          Reset
                        </button>
                      ) : (
                        <button
                          className={`toggle-btn ${alert.active ? 'active' : ''}`}
                          onClick={() => toggleAlert(alert.id)}
                        >
                          {alert.active ? 'ON' : 'OFF'}
                        </button>
                      )}
                      <button className="delete-btn" onClick={() => deleteAlert(alert.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {alert.triggered && (
                    <div className="alert-triggered-info">
                      Triggered at {new Date(alert.triggeredAt).toLocaleString()}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {activeTab === 'signals' && (
        <div className="signals-list">
          <p className="signals-disclaimer">
            Sample trading signals for educational purposes. Always do your own analysis.
          </p>

          {sampleSignals.map((signal, idx) => (
            <div key={idx} className="signal-card card">
              <div className="signal-header">
                <h3>{signal.pair}</h3>
                <span className={`signal-type ${signal.type.toLowerCase()}`}>
                  {signal.type}
                </span>
              </div>

              <div className="signal-details">
                <div className="signal-row">
                  <span>Entry</span>
                  <strong>{signal.entry}</strong>
                </div>
                <div className="signal-row">
                  <span>Take Profit</span>
                  <strong className="profit">{signal.tp}</strong>
                </div>
                <div className="signal-row">
                  <span>Stop Loss</span>
                  <strong className="loss">{signal.sl}</strong>
                </div>
              </div>

              <div className="signal-confidence">
                <span>Confidence</span>
                <div className="confidence-bar">
                  <div className="confidence-fill" style={{ width: `${signal.confidence}%` }} />
                </div>
                <span>{signal.confidence}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
