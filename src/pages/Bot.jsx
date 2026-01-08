import { useState, useEffect, useRef } from 'react'
import { Bot, Play, Pause, TrendingUp, TrendingDown, Target, Activity, RefreshCw, Trash2, Download } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { generateAllSuggestions, getTradingPerformance, updatePredictionsWithPrices, suggestPositionSize } from '../services/autoTrader'
import { getPredictionLogs, getSuggestedTrades, getAccuracyStats, clearAllLogs, exportLogs } from '../services/predictionLogger'
import { fetchLiveRates } from '../services/forexApi'
import './Bot.css'

export default function BotPage() {
  const [isRunning, setIsRunning] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [performance, setPerformance] = useState(null)
  const [logs, setLogs] = useState([])
  const [activeTab, setActiveTab] = useState('trades')
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    loadData()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (isRunning) {
      runBot()
      intervalRef.current = setInterval(runBot, 60000) // Run every minute
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning])

  const loadData = () => {
    setPerformance(getTradingPerformance())
    setLogs(getPredictionLogs().slice(-50).reverse())
    setSuggestions(getSuggestedTrades().slice(0, 10))
  }

  const runBot = async () => {
    setLoading(true)

    // Update old predictions with current prices
    const rates = await fetchLiveRates()
    const priceMap = {}
    rates.forEach(r => {
      priceMap[r.pair] = r.rate
    })
    updatePredictionsWithPrices(priceMap)

    // Generate new suggestions
    const newSuggestions = await generateAllSuggestions()

    loadData()
    setLastUpdate(new Date())
    setLoading(false)
  }

  const handleClearLogs = () => {
    if (confirm('Clear all prediction logs? This cannot be undone.')) {
      clearAllLogs()
      loadData()
    }
  }

  const handleExport = () => {
    const data = exportLogs()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `forex-bot-logs-${new Date().toISOString().split('T')[0]}.json`
    a.click()
  }

  // Prepare accuracy chart data
  const accuracyData = []
  const logsForChart = getPredictionLogs().filter(l => l.outcome !== null)
  let runningCorrect = 0
  let runningTotal = 0

  logsForChart.slice(-100).forEach((log, idx) => {
    runningTotal++
    if (log.correct) runningCorrect++
    accuracyData.push({
      idx,
      accuracy: ((runningCorrect / runningTotal) * 100).toFixed(1),
      pips: parseFloat(log.pnlPips || 0)
    })
  })

  // Cumulative P/L data
  const pnlData = []
  let cumPnl = 0
  logsForChart.slice(-100).forEach((log, idx) => {
    cumPnl += parseFloat(log.pnlPips || 0)
    pnlData.push({
      idx,
      pnl: cumPnl.toFixed(1)
    })
  })

  return (
    <div className="page bot-page">
      <header className="page-header">
        <div className="header-content">
          <Bot size={28} className="header-icon" />
          <div>
            <h1>Trading Bot</h1>
            <p>Auto predictions & tracking</p>
          </div>
        </div>
        <button
          className={`bot-toggle ${isRunning ? 'running' : ''}`}
          onClick={() => setIsRunning(!isRunning)}
        >
          {isRunning ? <Pause size={20} /> : <Play size={20} />}
          {isRunning ? 'Stop' : 'Start'}
        </button>
      </header>

      {/* Status Bar */}
      <div className="status-bar">
        <div className={`status-indicator ${isRunning ? 'active' : ''}`}>
          <span className="status-dot" />
          {isRunning ? 'Bot Running' : 'Bot Stopped'}
        </div>
        {lastUpdate && (
          <span className="last-update">
            Updated: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
        {loading && <RefreshCw size={16} className="spinning" />}
      </div>

      {/* Performance Summary */}
      {performance && (
        <div className="performance-grid">
          <div className="perf-card">
            <span className="perf-label">Accuracy</span>
            <span className={`perf-value ${parseFloat(performance.accuracy) >= 50 ? 'profit' : 'loss'}`}>
              {performance.accuracy}%
            </span>
          </div>
          <div className="perf-card">
            <span className="perf-label">Win Rate</span>
            <span className={`perf-value ${parseFloat(performance.winRate) >= 50 ? 'profit' : 'loss'}`}>
              {performance.winRate}%
            </span>
          </div>
          <div className="perf-card">
            <span className="perf-label">Total Pips</span>
            <span className={`perf-value ${parseFloat(performance.totalPips) >= 0 ? 'profit' : 'loss'}`}>
              {parseFloat(performance.totalPips) >= 0 ? '+' : ''}{performance.totalPips}
            </span>
          </div>
          <div className="perf-card">
            <span className="perf-label">Profit Factor</span>
            <span className={`perf-value ${parseFloat(performance.profitFactor) >= 1 ? 'profit' : 'loss'}`}>
              {performance.profitFactor}
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'trades' ? 'active' : ''}`} onClick={() => setActiveTab('trades')}>
          Trades
        </button>
        <button className={`tab ${activeTab === 'performance' ? 'active' : ''}`} onClick={() => setActiveTab('performance')}>
          Performance
        </button>
        <button className={`tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
          Logs
        </button>
      </div>

      {activeTab === 'trades' && (
        <>
          <div className="section-header">
            <h2>Suggested Trades</h2>
            <button className="btn btn-sm btn-outline" onClick={runBot} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spinning' : ''} />
              Refresh
            </button>
          </div>

          {suggestions.length === 0 ? (
            <div className="empty-state">
              <Target size={48} />
              <p>No trade suggestions yet</p>
              <span>Start the bot to generate predictions</span>
            </div>
          ) : (
            <div className="trades-list">
              {suggestions.map(trade => (
                <TradeCard key={trade.id} trade={trade} />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'performance' && performance && (
        <>
          {/* Accuracy Chart */}
          <div className="chart-card card">
            <h3>Accuracy Over Time</h3>
            {accuracyData.length > 0 ? (
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={accuracyData}>
                    <XAxis dataKey="idx" hide />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      contentStyle={{ background: '#21262d', border: '1px solid #30363d' }}
                      formatter={(value) => [`${value}%`, 'Accuracy']}
                    />
                    <Line type="monotone" dataKey="accuracy" stroke="#58a6ff" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="no-data">No data yet</p>
            )}
          </div>

          {/* Cumulative P/L Chart */}
          <div className="chart-card card">
            <h3>Cumulative P/L (Pips)</h3>
            {pnlData.length > 0 ? (
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={pnlData}>
                    <XAxis dataKey="idx" hide />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ background: '#21262d', border: '1px solid #30363d' }}
                      formatter={(value) => [`${value} pips`, 'P/L']}
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="#3fb950"
                      fill="rgba(63, 185, 80, 0.2)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="no-data">No data yet</p>
            )}
          </div>

          {/* Detailed Stats */}
          <div className="stats-card card">
            <h3>Detailed Statistics</h3>
            <div className="stats-grid">
              <div className="stat-row">
                <span>Total Predictions</span>
                <span>{performance.totalPredictions}</span>
              </div>
              <div className="stat-row">
                <span>Resolved</span>
                <span>{performance.resolvedPredictions}</span>
              </div>
              <div className="stat-row">
                <span>Correct</span>
                <span className="profit">{performance.correctPredictions}</span>
              </div>
              <div className="stat-row">
                <span>Recent Accuracy (50)</span>
                <span className={parseFloat(performance.recentAccuracy) >= 50 ? 'profit' : 'loss'}>
                  {performance.recentAccuracy}%
                </span>
              </div>
              <div className="stat-row">
                <span>Avg Win</span>
                <span className="profit">+{performance.avgWinPips} pips</span>
              </div>
              <div className="stat-row">
                <span>Avg Loss</span>
                <span className="loss">-{performance.avgLossPips} pips</span>
              </div>
              <div className="stat-row">
                <span>Max Win Streak</span>
                <span className="profit">{performance.maxWinStreak}</span>
              </div>
              <div className="stat-row">
                <span>Max Lose Streak</span>
                <span className="loss">{performance.maxLoseStreak}</span>
              </div>
              <div className="stat-row">
                <span>Current Streak</span>
                <span className={performance.currentStreak >= 0 ? 'profit' : 'loss'}>
                  {performance.currentStreak >= 0 ? '+' : ''}{performance.currentStreak}
                </span>
              </div>
            </div>
          </div>

          {/* By Pair Performance */}
          {Object.keys(performance.byPair).length > 0 && (
            <div className="pair-stats card">
              <h3>Performance by Pair</h3>
              {Object.entries(performance.byPair).map(([pair, stats]) => (
                <div key={pair} className="pair-stat-row">
                  <span className="pair-name">{pair}</span>
                  <span className="pair-accuracy">
                    {((stats.correct / stats.total) * 100).toFixed(0)}%
                  </span>
                  <span className={`pair-pips ${stats.pips >= 0 ? 'profit' : 'loss'}`}>
                    {stats.pips >= 0 ? '+' : ''}{stats.pips.toFixed(0)} pips
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'logs' && (
        <>
          <div className="section-header">
            <h2>Prediction Logs</h2>
            <div className="log-actions">
              <button className="btn btn-sm btn-outline" onClick={handleExport}>
                <Download size={14} />
                Export
              </button>
              <button className="btn btn-sm btn-danger" onClick={handleClearLogs}>
                <Trash2 size={14} />
                Clear
              </button>
            </div>
          </div>

          <div className="logs-list">
            {logs.length === 0 ? (
              <div className="empty-state">
                <Activity size={48} />
                <p>No prediction logs yet</p>
              </div>
            ) : (
              logs.map(log => (
                <div key={log.id} className={`log-card ${log.outcome?.toLowerCase() || 'pending'}`}>
                  <div className="log-header">
                    <span className="log-pair">{log.pair}</span>
                    <span className={`log-signal ${log.signal.toLowerCase()}`}>
                      {log.direction === 'UP' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                      {log.signal}
                    </span>
                    <span className="log-confidence">{log.confidence}%</span>
                  </div>

                  <div className="log-details">
                    <div className="log-prices">
                      <span>Entry: {log.priceAtPrediction}</span>
                      {log.priceAtResolution && <span>Exit: {log.priceAtResolution}</span>}
                    </div>
                    {log.outcome && (
                      <div className={`log-result ${log.correct ? 'profit' : 'loss'}`}>
                        <span>{log.correct ? '✓' : '✗'} {log.pnlPips} pips</span>
                      </div>
                    )}
                  </div>

                  <div className="log-time">
                    {new Date(log.timestamp).toLocaleString()}
                    {log.autoResolved && <span className="auto-resolved">Auto</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

function TradeCard({ trade }) {
  const positionSize = suggestPositionSize(10000, 1, trade) // $10k account, 1% risk

  return (
    <div className={`trade-card card ${trade.signal.toLowerCase()}`}>
      <div className="trade-header">
        <div className="trade-pair">
          <h3>{trade.pair}</h3>
          <span className={`trade-signal ${trade.signal.toLowerCase()}`}>
            {trade.direction === 'UP' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            {trade.signal}
          </span>
        </div>
        <div className="trade-confidence">
          <span className="confidence-value">{trade.confidence}%</span>
          <span className="confidence-label">confidence</span>
        </div>
      </div>

      <div className="trade-levels">
        <div className="level">
          <span className="level-label">Entry</span>
          <span className="level-value">{trade.entryPrice}</span>
        </div>
        <div className="level">
          <span className="level-label">Stop Loss</span>
          <span className="level-value loss">{trade.stopLoss}</span>
        </div>
        <div className="level">
          <span className="level-label">Take Profit</span>
          <span className="level-value profit">{trade.takeProfit}</span>
        </div>
      </div>

      <div className="trade-meta">
        <span className="rr-ratio">R:R {trade.riskRewardRatio}</span>
        <span className="potential-pips">+{trade.potentialPips} pips potential</span>
      </div>

      <div className="trade-reasoning">
        <strong>Reasoning:</strong> {trade.reasoning}
      </div>

      <div className="position-suggestion">
        <span>Suggested: {positionSize.lotSize} lots ($10k @ 1% risk)</span>
      </div>
    </div>
  )
}
