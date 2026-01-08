import { useState, useEffect } from 'react'
import { Plus, Trash2, TrendingUp, TrendingDown, Calendar, X, Filter } from 'lucide-react'
import { CURRENCY_PAIRS } from '../services/forexApi'
import './Journal.css'

export default function Journal() {
  const [trades, setTrades] = useState(() => {
    return JSON.parse(localStorage.getItem('forex_trades') || '[]')
  })
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('all')

  // Form state
  const [formData, setFormData] = useState({
    pair: 'EUR/USD',
    type: 'BUY',
    entryPrice: '',
    exitPrice: '',
    lotSize: '0.01',
    stopLoss: '',
    takeProfit: '',
    notes: '',
    date: new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    localStorage.setItem('forex_trades', JSON.stringify(trades))
  }, [trades])

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const calculatePnL = (trade) => {
    if (!trade.entryPrice || !trade.exitPrice) return 0
    const pips = trade.pair.includes('JPY')
      ? (trade.exitPrice - trade.entryPrice) * 100
      : (trade.exitPrice - trade.entryPrice) * 10000

    const direction = trade.type === 'BUY' ? 1 : -1
    const pipValue = trade.pair.includes('JPY') ? 0.01 : 0.0001
    const lotValue = parseFloat(trade.lotSize) * 100000 * pipValue

    return pips * direction * lotValue
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    const newTrade = {
      id: Date.now(),
      ...formData,
      entryPrice: parseFloat(formData.entryPrice),
      exitPrice: formData.exitPrice ? parseFloat(formData.exitPrice) : null,
      lotSize: parseFloat(formData.lotSize),
      stopLoss: formData.stopLoss ? parseFloat(formData.stopLoss) : null,
      takeProfit: formData.takeProfit ? parseFloat(formData.takeProfit) : null,
      status: formData.exitPrice ? 'closed' : 'open',
      pnl: formData.exitPrice ? calculatePnL({
        ...formData,
        entryPrice: parseFloat(formData.entryPrice),
        exitPrice: parseFloat(formData.exitPrice),
        lotSize: parseFloat(formData.lotSize)
      }) : 0,
      createdAt: new Date().toISOString()
    }

    setTrades([newTrade, ...trades])
    setShowForm(false)
    setFormData({
      pair: 'EUR/USD',
      type: 'BUY',
      entryPrice: '',
      exitPrice: '',
      lotSize: '0.01',
      stopLoss: '',
      takeProfit: '',
      notes: '',
      date: new Date().toISOString().split('T')[0]
    })
  }

  const deleteTrade = (id) => {
    if (confirm('Delete this trade?')) {
      setTrades(trades.filter(t => t.id !== id))
    }
  }

  const closeTrade = (id, exitPrice) => {
    setTrades(trades.map(t => {
      if (t.id !== id) return t
      const updatedTrade = { ...t, exitPrice: parseFloat(exitPrice), status: 'closed' }
      updatedTrade.pnl = calculatePnL(updatedTrade)
      return updatedTrade
    }))
  }

  const filteredTrades = trades.filter(trade => {
    if (filter === 'open') return trade.status === 'open'
    if (filter === 'closed') return trade.status === 'closed'
    if (filter === 'wins') return trade.pnl > 0
    if (filter === 'losses') return trade.pnl < 0
    return true
  })

  // Stats
  const closedTrades = trades.filter(t => t.status === 'closed')
  const totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0)
  const wins = closedTrades.filter(t => t.pnl > 0).length
  const winRate = closedTrades.length > 0 ? ((wins / closedTrades.length) * 100).toFixed(1) : 0

  return (
    <div className="page journal-page">
      <header className="page-header">
        <h1>Trading Journal</h1>
        <p>Track and analyze your trades</p>
      </header>

      {/* Stats Summary */}
      <div className="journal-stats">
        <div className="stat">
          <span className="stat-value">{trades.length}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat">
          <span className="stat-value">{winRate}%</span>
          <span className="stat-label">Win Rate</span>
        </div>
        <div className="stat">
          <span className={`stat-value ${totalPnL >= 0 ? 'profit' : 'loss'}`}>
            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
          </span>
          <span className="stat-label">Total P/L</span>
        </div>
      </div>

      <button className="btn btn-primary add-trade-btn" onClick={() => setShowForm(true)}>
        <Plus size={18} />
        Log Trade
      </button>

      {/* Filter Tabs */}
      <div className="filter-tabs">
        {['all', 'open', 'closed', 'wins', 'losses'].map(f => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Trade Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Log New Trade</h2>
              <button className="close-btn" onClick={() => setShowForm(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Pair</label>
                  <select name="pair" value={formData.pair} onChange={handleInputChange}>
                    {CURRENCY_PAIRS.map(p => (
                      <option key={p.pair} value={p.pair}>{p.pair}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Type</label>
                  <div className="type-buttons">
                    <button
                      type="button"
                      className={`type-btn ${formData.type === 'BUY' ? 'active buy' : ''}`}
                      onClick={() => setFormData(p => ({ ...p, type: 'BUY' }))}
                    >
                      BUY
                    </button>
                    <button
                      type="button"
                      className={`type-btn ${formData.type === 'SELL' ? 'active sell' : ''}`}
                      onClick={() => setFormData(p => ({ ...p, type: 'SELL' }))}
                    >
                      SELL
                    </button>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Entry Price</label>
                  <input
                    type="number"
                    step="any"
                    name="entryPrice"
                    value={formData.entryPrice}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Exit Price (optional)</label>
                  <input
                    type="number"
                    step="any"
                    name="exitPrice"
                    value={formData.exitPrice}
                    onChange={handleInputChange}
                    placeholder="Leave empty if open"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Lot Size</label>
                  <input
                    type="number"
                    step="0.01"
                    name="lotSize"
                    value={formData.lotSize}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    name="date"
                    value={formData.date}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Stop Loss</label>
                  <input
                    type="number"
                    step="any"
                    name="stopLoss"
                    value={formData.stopLoss}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="form-group">
                  <label>Take Profit</label>
                  <input
                    type="number"
                    step="any"
                    name="takeProfit"
                    value={formData.takeProfit}
                    onChange={handleInputChange}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="Trade rationale, market conditions..."
                  rows={3}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                Save Trade
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Trades List */}
      <div className="trades-list">
        {filteredTrades.length === 0 ? (
          <div className="empty-state">
            <Calendar size={48} />
            <p>No trades found</p>
            <span>Start logging your trades to track performance</span>
          </div>
        ) : (
          filteredTrades.map(trade => (
            <TradeCard
              key={trade.id}
              trade={trade}
              onDelete={deleteTrade}
              onClose={closeTrade}
            />
          ))
        )}
      </div>
    </div>
  )
}

function TradeCard({ trade, onDelete, onClose }) {
  const [showCloseInput, setShowCloseInput] = useState(false)
  const [exitPrice, setExitPrice] = useState('')

  const handleClose = () => {
    if (exitPrice) {
      onClose(trade.id, exitPrice)
      setShowCloseInput(false)
    }
  }

  return (
    <div className={`trade-card card ${trade.status}`}>
      <div className="trade-header">
        <div className="trade-pair">
          <h3>{trade.pair}</h3>
          <span className={`trade-type ${trade.type.toLowerCase()}`}>{trade.type}</span>
          <span className={`trade-status ${trade.status}`}>{trade.status}</span>
        </div>
        <button className="delete-btn" onClick={() => onDelete(trade.id)}>
          <Trash2 size={16} />
        </button>
      </div>

      <div className="trade-details">
        <div className="detail-row">
          <span>Entry</span>
          <strong>{trade.entryPrice}</strong>
        </div>
        {trade.exitPrice && (
          <div className="detail-row">
            <span>Exit</span>
            <strong>{trade.exitPrice}</strong>
          </div>
        )}
        <div className="detail-row">
          <span>Lot Size</span>
          <strong>{trade.lotSize}</strong>
        </div>
        {trade.stopLoss && (
          <div className="detail-row">
            <span>SL</span>
            <strong className="loss">{trade.stopLoss}</strong>
          </div>
        )}
        {trade.takeProfit && (
          <div className="detail-row">
            <span>TP</span>
            <strong className="profit">{trade.takeProfit}</strong>
          </div>
        )}
      </div>

      {trade.notes && (
        <p className="trade-notes">{trade.notes}</p>
      )}

      <div className="trade-footer">
        <span className="trade-date">{new Date(trade.date).toLocaleDateString()}</span>

        {trade.status === 'closed' ? (
          <span className={`trade-pnl ${trade.pnl >= 0 ? 'profit' : 'loss'}`}>
            {trade.pnl >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
          </span>
        ) : (
          <div className="close-trade">
            {showCloseInput ? (
              <div className="close-input-group">
                <input
                  type="number"
                  step="any"
                  value={exitPrice}
                  onChange={e => setExitPrice(e.target.value)}
                  placeholder="Exit price"
                />
                <button className="btn btn-sm btn-success" onClick={handleClose}>Close</button>
                <button className="btn btn-sm btn-outline" onClick={() => setShowCloseInput(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-sm btn-outline" onClick={() => setShowCloseInput(true)}>
                Close Trade
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
