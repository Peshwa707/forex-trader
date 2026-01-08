import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, RefreshCw, Star, StarOff } from 'lucide-react'
import { fetchLiveRates, formatRate, CURRENCY_PAIRS } from '../services/forexApi'
import './Prices.css'

export default function Prices() {
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [favorites, setFavorites] = useState(() => {
    return JSON.parse(localStorage.getItem('forex_favorites') || '["EUR/USD", "GBP/USD", "USD/JPY"]')
  })
  const [filter, setFilter] = useState('all')
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    loadRates()
    const interval = setInterval(loadRates, 30000)
    return () => clearInterval(interval)
  }, [])

  const loadRates = async () => {
    const data = await fetchLiveRates()
    setRates(data)
    setLoading(false)
    setRefreshing(false)
    setLastUpdate(new Date())
  }

  const handleRefresh = () => {
    setRefreshing(true)
    loadRates()
  }

  const toggleFavorite = (pair) => {
    const newFavorites = favorites.includes(pair)
      ? favorites.filter(p => p !== pair)
      : [...favorites, pair]
    setFavorites(newFavorites)
    localStorage.setItem('forex_favorites', JSON.stringify(newFavorites))
  }

  const filteredRates = rates.filter(rate => {
    if (filter === 'favorites') return favorites.includes(rate.pair)
    if (filter === 'majors') return ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD'].includes(rate.pair)
    if (filter === 'metals') return rate.pair.includes('XAU') || rate.pair.includes('XAG')
    return true
  })

  return (
    <div className="page prices-page">
      <header className="page-header">
        <h1>Live Prices</h1>
        <button className={`refresh-btn ${refreshing ? 'spinning' : ''}`} onClick={handleRefresh}>
          <RefreshCw size={20} />
        </button>
      </header>

      {lastUpdate && (
        <p className="last-update">
          Last updated: {lastUpdate.toLocaleTimeString()}
        </p>
      )}

      <div className="tabs">
        <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All
        </button>
        <button className={`tab ${filter === 'favorites' ? 'active' : ''}`} onClick={() => setFilter('favorites')}>
          Favorites
        </button>
        <button className={`tab ${filter === 'majors' ? 'active' : ''}`} onClick={() => setFilter('majors')}>
          Majors
        </button>
        <button className={`tab ${filter === 'metals' ? 'active' : ''}`} onClick={() => setFilter('metals')}>
          Metals
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading rates...</div>
      ) : (
        <div className="rates-list">
          {filteredRates.map(rate => (
            <div key={rate.pair} className="price-card card">
              <div className="price-main">
                <div className="price-info">
                  <div className="pair-header">
                    <h3>{rate.pair}</h3>
                    <button
                      className={`favorite-btn ${favorites.includes(rate.pair) ? 'active' : ''}`}
                      onClick={() => toggleFavorite(rate.pair)}
                    >
                      {favorites.includes(rate.pair) ? <Star size={18} /> : <StarOff size={18} />}
                    </button>
                  </div>
                  <span className="pair-name">{rate.name}</span>
                </div>

                <div className="price-value">
                  <span className="current-price">{formatRate(rate.pair, rate.rate)}</span>
                  <span className={`price-change ${rate.change >= 0 ? 'profit' : 'loss'}`}>
                    {rate.change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {rate.change >= 0 ? '+' : ''}{(rate.changePercent).toFixed(3)}%
                  </span>
                </div>
              </div>

              <div className="price-details">
                <div className="detail">
                  <span className="detail-label">High</span>
                  <span className="detail-value profit">{formatRate(rate.pair, rate.high)}</span>
                </div>
                <div className="detail">
                  <span className="detail-label">Low</span>
                  <span className="detail-value loss">{formatRate(rate.pair, rate.low)}</span>
                </div>
                <div className="detail">
                  <span className="detail-label">Spread</span>
                  <span className="detail-value">{((rate.high - rate.low) * 10000).toFixed(1)} pips</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
