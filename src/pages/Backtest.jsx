/**
 * Backtest Page
 * Part of Phase A: Trust Foundation - Backtesting System
 *
 * Configure and view backtest results
 */

import { useState, useEffect } from 'react'
import {
  Play, RefreshCw, TrendingUp, TrendingDown, Calendar, DollarSign,
  Target, AlertTriangle, Award, BarChart2, Clock, Percent
} from 'lucide-react'
import { backtestApi } from '../services/api'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid
} from 'recharts'
import './Backtest.css'

export default function Backtest() {
  const [pairs, setPairs] = useState(['EUR/USD'])
  const [availablePairs, setAvailablePairs] = useState([])
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 6)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [initialBalance, setInitialBalance] = useState(10000)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('summary')

  useEffect(() => {
    loadPairs()
  }, [])

  const loadPairs = async () => {
    try {
      const data = await backtestApi.getPairs()
      setAvailablePairs(data.pairs || [])
    } catch (err) {
      console.error('Failed to load pairs:', err)
    }
  }

  const runBacktest = async () => {
    setRunning(true)
    setError(null)
    setResults(null)

    try {
      const data = await backtestApi.run({
        pairs,
        startDate,
        endDate,
        initialBalance
      })
      setResults(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const togglePair = (pair) => {
    if (pairs.includes(pair)) {
      if (pairs.length > 1) {
        setPairs(pairs.filter(p => p !== pair))
      }
    } else {
      setPairs([...pairs, pair])
    }
  }

  return (
    <div className="backtest-page">
      <header className="backtest-header">
        <div className="header-title">
          <BarChart2 size={24} />
          <h1>Backtest</h1>
        </div>
        <p className="header-subtitle">Test your strategy on historical data before risking real money</p>
      </header>

      <div className="backtest-config">
        <div className="config-section">
          <label>Currency Pairs</label>
          <div className="pair-toggles">
            {availablePairs.map(pair => (
              <button
                key={pair}
                className={`pair-toggle ${pairs.includes(pair) ? 'active' : ''}`}
                onClick={() => togglePair(pair)}
              >
                {pair}
              </button>
            ))}
          </div>
        </div>

        <div className="config-row">
          <div className="config-section">
            <label htmlFor="startDate">Start Date</label>
            <input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="config-section">
            <label htmlFor="endDate">End Date</label>
            <input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="config-section">
            <label htmlFor="balance">Initial Balance</label>
            <input
              type="number"
              id="balance"
              value={initialBalance}
              onChange={(e) => setInitialBalance(parseFloat(e.target.value) || 10000)}
              min="1000"
              step="1000"
            />
          </div>
        </div>

        <button
          className="run-backtest-btn"
          onClick={runBacktest}
          disabled={running || pairs.length === 0}
        >
          {running ? (
            <>
              <RefreshCw className="spin" size={18} />
              Running Backtest...
            </>
          ) : (
            <>
              <Play size={18} />
              Run Backtest
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="backtest-error">
          <AlertTriangle size={20} />
          <span>{error}</span>
        </div>
      )}

      {results && (
        <div className="backtest-results">
          <nav className="results-tabs">
            <button
              className={`tab ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              Summary
            </button>
            <button
              className={`tab ${activeTab === 'trades' ? 'active' : ''}`}
              onClick={() => setActiveTab('trades')}
            >
              Trades ({results.trades.total})
            </button>
            <button
              className={`tab ${activeTab === 'equity' ? 'active' : ''}`}
              onClick={() => setActiveTab('equity')}
            >
              Equity Curve
            </button>
          </nav>

          {activeTab === 'summary' && (
            <div className="results-summary">
              {/* Key Metrics Grid */}
              <div className="metrics-grid">
                <div className={`metric-card ${results.summary.totalReturn >= 0 ? 'positive' : 'negative'}`}>
                  <DollarSign size={20} />
                  <div className="metric-content">
                    <span className="metric-value">
                      {results.summary.totalReturn >= 0 ? '+' : ''}${results.summary.totalReturn.toFixed(2)}
                    </span>
                    <span className="metric-label">Total Return</span>
                    <span className="metric-detail">
                      ({results.summary.totalReturnPercent >= 0 ? '+' : ''}{results.summary.totalReturnPercent.toFixed(1)}%)
                    </span>
                  </div>
                </div>

                <div className="metric-card">
                  <Target size={20} />
                  <div className="metric-content">
                    <span className="metric-value">{results.trades.winRate}%</span>
                    <span className="metric-label">Win Rate</span>
                    <span className="metric-detail">{results.trades.wins} / {results.trades.total} trades</span>
                  </div>
                </div>

                <div className="metric-card">
                  <TrendingDown size={20} />
                  <div className="metric-content">
                    <span className="metric-value negative">-${results.risk.maxDrawdown.toFixed(2)}</span>
                    <span className="metric-label">Max Drawdown</span>
                    <span className="metric-detail">(-{results.risk.maxDrawdownPercent.toFixed(1)}%)</span>
                  </div>
                </div>

                <div className="metric-card">
                  <Award size={20} />
                  <div className="metric-content">
                    <span className="metric-value">{results.trades.profitFactor.toFixed(2)}</span>
                    <span className="metric-label">Profit Factor</span>
                    <span className="metric-detail">Gross Win / Gross Loss</span>
                  </div>
                </div>
              </div>

              {/* Balance Summary */}
              <div className="balance-summary">
                <div className="balance-item">
                  <span className="balance-label">Starting Balance</span>
                  <span className="balance-value">${results.summary.initialBalance.toLocaleString()}</span>
                </div>
                <div className="balance-arrow">→</div>
                <div className="balance-item">
                  <span className="balance-label">Final Balance</span>
                  <span className={`balance-value ${results.summary.totalReturn >= 0 ? 'positive' : 'negative'}`}>
                    ${results.summary.finalBalance.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Trade Statistics */}
              <div className="stats-section">
                <h3>Trade Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-label">Total Trades</span>
                    <span className="stat-value">{results.trades.total}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Wins</span>
                    <span className="stat-value positive">{results.trades.wins}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Losses</span>
                    <span className="stat-value negative">{results.trades.losses}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Avg Win</span>
                    <span className="stat-value positive">+${results.trades.avgWin.toFixed(2)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Avg Loss</span>
                    <span className="stat-value negative">-${results.trades.avgLoss.toFixed(2)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Avg Trade</span>
                    <span className={`stat-value ${results.trades.avgTrade >= 0 ? 'positive' : 'negative'}`}>
                      {results.trades.avgTrade >= 0 ? '+' : ''}${results.trades.avgTrade.toFixed(2)}
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Win Streak</span>
                    <span className="stat-value">{results.trades.longestWinStreak}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Lose Streak</span>
                    <span className="stat-value">{results.trades.longestLoseStreak}</span>
                  </div>
                </div>
              </div>

              {/* Risk Metrics */}
              <div className="stats-section">
                <h3>Risk Metrics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-label">Sharpe Ratio</span>
                    <span className="stat-value">{results.risk.sharpeRatio.toFixed(2)}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Max Drawdown</span>
                    <span className="stat-value negative">{results.risk.maxDrawdownPercent.toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {/* Performance Context */}
              <div className="performance-context">
                <p>
                  {results.summary.totalReturn >= 0 ? (
                    <>
                      <strong>If the bot performs like the past {Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24 * 30))} months</strong>,
                      you could expect ~{(results.summary.totalReturnPercent / Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24 * 30)))).toFixed(1)}% monthly returns
                      with occasional {results.risk.maxDrawdownPercent.toFixed(0)}% dips.
                    </>
                  ) : (
                    <>
                      <strong>Warning:</strong> This backtest shows a negative return. Consider adjusting your strategy parameters
                      or testing on different market conditions.
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'trades' && (
            <div className="trades-tab">
              <div className="trade-log">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Pair</th>
                      <th>Direction</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>P/L</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.tradeLog.slice(0, 100).map((trade, i) => (
                      <tr key={i} className={trade.pnlDollars >= 0 ? 'win' : 'loss'}>
                        <td>{new Date(trade.entryTime).toLocaleDateString()}</td>
                        <td>{trade.pair}</td>
                        <td className={trade.direction === 'UP' ? 'buy' : 'sell'}>
                          {trade.direction === 'UP' ? 'BUY' : 'SELL'}
                        </td>
                        <td>{trade.entryPrice.toFixed(trade.pair.includes('JPY') ? 3 : 5)}</td>
                        <td>{trade.exitPrice.toFixed(trade.pair.includes('JPY') ? 3 : 5)}</td>
                        <td className={trade.pnlDollars >= 0 ? 'positive' : 'negative'}>
                          {trade.pnlDollars >= 0 ? '+' : ''}${trade.pnlDollars.toFixed(2)}
                          <span className="pips">({trade.pnlPips >= 0 ? '+' : ''}{trade.pnlPips} pips)</span>
                        </td>
                        <td>{trade.closeReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {results.tradeLog.length > 100 && (
                  <p className="more-trades">Showing first 100 of {results.tradeLog.length} trades</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'equity' && (
            <div className="equity-tab">
              <div className="equity-chart">
                <ResponsiveContainer width="100%" height={400}>
                  <AreaChart data={results.equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                    <XAxis
                      dataKey="date"
                      stroke="#8b949e"
                      fontSize={12}
                      tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    />
                    <YAxis
                      stroke="#8b949e"
                      fontSize={12}
                      tickFormatter={(val) => `$${val.toLocaleString()}`}
                      domain={['dataMin - 500', 'dataMax + 500']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#21262d',
                        border: '1px solid #30363d',
                        borderRadius: '8px'
                      }}
                      formatter={(value) => [`$${value.toLocaleString()}`, 'Equity']}
                      labelFormatter={(label) => new Date(label).toLocaleDateString()}
                    />
                    <defs>
                      <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3fb950" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke="#3fb950"
                      strokeWidth={2}
                      fill="url(#equityGradient)"
                    />
                    <Line
                      type="monotone"
                      dataKey="balance"
                      stroke="#58a6ff"
                      strokeWidth={1}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-legend">
                <span className="legend-item">
                  <span className="legend-line equity"></span> Equity (with open trades)
                </span>
                <span className="legend-item">
                  <span className="legend-line balance"></span> Balance (realized)
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {!results && !running && !error && (
        <div className="backtest-placeholder">
          <BarChart2 size={48} />
          <h3>Ready to Backtest</h3>
          <p>
            Configure your backtest parameters above and click "Run Backtest" to see how the bot
            would have performed on historical data.
          </p>
          <ul className="backtest-tips">
            <li>Test on at least 3-6 months of data for meaningful results</li>
            <li>A win rate above 50% with positive profit factor is encouraging</li>
            <li>Max drawdown should ideally stay below 20% of your balance</li>
            <li>Past performance does not guarantee future results</li>
          </ul>
        </div>
      )}
    </div>
  )
}
