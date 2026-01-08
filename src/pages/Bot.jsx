import { useState, useEffect, useRef } from 'react'
import { Bot, Play, Pause, TrendingUp, TrendingDown, Target, Activity, RefreshCw, Trash2, Download, Settings, Zap, X, DollarSign, Clock, Shield } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { generateAllSuggestions, getTradingPerformance, updatePredictionsWithPrices, suggestPositionSize } from '../services/autoTrader'
import { getPredictionLogs, getSuggestedTrades, getAccuracyStats, clearAllLogs, exportLogs } from '../services/predictionLogger'
import { fetchLiveRates } from '../services/forexApi'
import {
  getAutoSettings, saveAutoSettings, getActiveTrades, executeTrade,
  updateAllTrades, closeTrade, closeAllTrades, getTradingStats, resetAccount
} from '../services/tradeExecutor'
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

  // Auto-trading state
  const [autoSettings, setAutoSettings] = useState(getAutoSettings())
  const [activeTrades, setActiveTrades] = useState([])
  const [tradingStats, setTradingStats] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [currentPrices, setCurrentPrices] = useState({})

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
    setActiveTrades(getActiveTrades())
    setTradingStats(getTradingStats())
    setAutoSettings(getAutoSettings())
  }

  const runBot = async () => {
    setLoading(true)

    // Update old predictions with current prices
    const rates = await fetchLiveRates()
    const priceMap = {}
    rates.forEach(r => {
      priceMap[r.pair] = r.rate
    })
    setCurrentPrices(priceMap)
    updatePredictionsWithPrices(priceMap)

    // Update active trades with current prices and check for exits
    const tradeResults = updateAllTrades(priceMap)
    if (tradeResults.closed.length > 0) {
      console.log(`Auto-closed ${tradeResults.closed.length} trades`)
    }

    // Generate new suggestions
    const newSuggestions = await generateAllSuggestions()

    // Auto-execute trades if enabled
    const settings = getAutoSettings()
    if (settings.enabled && newSuggestions.length > 0) {
      newSuggestions.forEach(suggestion => {
        if (suggestion.confidence >= settings.minConfidence) {
          const result = executeTrade(suggestion, settings)
          if (result.success) {
            console.log(`Auto-executed trade: ${suggestion.pair} ${suggestion.signal}`)
          }
        }
      })
    }

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

  // Trade execution handlers
  const handleExecuteTrade = (suggestion) => {
    const result = executeTrade(suggestion, autoSettings)
    if (result.success) {
      loadData()
    } else {
      alert(`Cannot execute trade: ${result.reason}`)
    }
  }

  const handleCloseTrade = (tradeId) => {
    const trade = activeTrades.find(t => t.id === tradeId)
    if (trade && currentPrices[trade.pair]) {
      closeTrade(tradeId, currentPrices[trade.pair], 'MANUAL')
      loadData()
    }
  }

  const handleCloseAllTrades = () => {
    if (confirm('Close all active trades?')) {
      closeAllTrades(currentPrices)
      loadData()
    }
  }

  const handleToggleAutoTrading = () => {
    const newSettings = { ...autoSettings, enabled: !autoSettings.enabled }
    saveAutoSettings(newSettings)
    setAutoSettings(newSettings)
  }

  const handleUpdateSettings = (key, value) => {
    const newSettings = { ...autoSettings, [key]: value }
    saveAutoSettings(newSettings)
    setAutoSettings(newSettings)
  }

  const handleResetAccount = () => {
    if (confirm('Reset account to $10,000? This will close all trades and clear history.')) {
      resetAccount(10000)
      loadData()
    }
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
            <p>Auto predictions & execution</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setShowSettings(true)}>
            <Settings size={20} />
          </button>
          <button
            className={`bot-toggle ${isRunning ? 'running' : ''}`}
            onClick={() => setIsRunning(!isRunning)}
          >
            {isRunning ? <Pause size={20} /> : <Play size={20} />}
            {isRunning ? 'Stop' : 'Start'}
          </button>
        </div>
      </header>

      {/* Account Balance Bar */}
      {tradingStats && (
        <div className="balance-bar">
          <div className="balance-main">
            <DollarSign size={18} />
            <span className="balance-value">${parseFloat(tradingStats.accountBalance).toLocaleString()}</span>
          </div>
          <div className="balance-stats">
            <span className={`today-pnl ${parseFloat(tradingStats.todaysPnl) >= 0 ? 'profit' : 'loss'}`}>
              Today: {parseFloat(tradingStats.todaysPnl) >= 0 ? '+' : ''}${tradingStats.todaysPnl}
            </span>
            <span className="active-count">{activeTrades.length} active</span>
          </div>
          <button
            className={`auto-trade-toggle ${autoSettings.enabled ? 'enabled' : ''}`}
            onClick={handleToggleAutoTrading}
          >
            <Zap size={16} />
            {autoSettings.enabled ? 'Auto ON' : 'Auto OFF'}
          </button>
        </div>
      )}

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
        <button className={`tab ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          Active ({activeTrades.length})
        </button>
        <button className={`tab ${activeTab === 'trades' ? 'active' : ''}`} onClick={() => setActiveTab('trades')}>
          Signals
        </button>
        <button className={`tab ${activeTab === 'performance' ? 'active' : ''}`} onClick={() => setActiveTab('performance')}>
          Stats
        </button>
        <button className={`tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
          Logs
        </button>
      </div>

      {/* Active Trades Tab */}
      {activeTab === 'active' && (
        <>
          {activeTrades.length > 0 && (
            <div className="section-header">
              <h2>Active Trades</h2>
              <button className="btn btn-sm btn-danger" onClick={handleCloseAllTrades}>
                Close All
              </button>
            </div>
          )}

          {activeTrades.length === 0 ? (
            <div className="empty-state">
              <Target size={48} />
              <p>No active trades</p>
              <span>Execute trades from Signals tab or enable Auto Trading</span>
            </div>
          ) : (
            <div className="active-trades-list">
              {activeTrades.map(trade => (
                <ActiveTradeCard
                  key={trade.id}
                  trade={trade}
                  onClose={() => handleCloseTrade(trade.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

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
                <TradeCard key={trade.id} trade={trade} onExecute={handleExecuteTrade} />
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

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          settings={autoSettings}
          onUpdate={handleUpdateSettings}
          onClose={() => setShowSettings(false)}
          onReset={handleResetAccount}
        />
      )}
    </div>
  )
}

function TradeCard({ trade, onExecute }) {
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

      <div className="trade-actions">
        <span className="position-hint">{positionSize.lotSize} lots @ 1% risk</span>
        <button className="btn btn-sm btn-primary" onClick={() => onExecute(trade)}>
          <Zap size={14} />
          Execute
        </button>
      </div>
    </div>
  )
}

function ActiveTradeCard({ trade, onClose }) {
  const pnl = parseFloat(trade.pnl || 0)
  const pnlPips = parseFloat(trade.pnlPips || 0)

  return (
    <div className={`active-trade-card card ${pnl >= 0 ? 'profit' : 'loss'}`}>
      <div className="active-trade-header">
        <div className="trade-pair">
          <h3>{trade.pair}</h3>
          <span className={`trade-signal ${trade.signal?.toLowerCase()}`}>
            {trade.direction === 'UP' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {trade.signal}
          </span>
        </div>
        <div className={`trade-pnl ${pnl >= 0 ? 'profit' : 'loss'}`}>
          <span className="pnl-value">{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>
          <span className="pnl-pips">{pnlPips >= 0 ? '+' : ''}{pnlPips.toFixed(1)} pips</span>
        </div>
      </div>

      <div className="active-trade-prices">
        <div className="price-item">
          <span className="price-label">Entry</span>
          <span className="price-value">{trade.entryPrice}</span>
        </div>
        <div className="price-item">
          <span className="price-label">Current</span>
          <span className="price-value current">{trade.currentPrice}</span>
        </div>
        <div className="price-item">
          <span className="price-label">SL</span>
          <span className="price-value loss">{trade.trailingStop || trade.stopLoss}</span>
        </div>
        <div className="price-item">
          <span className="price-label">TP</span>
          <span className="price-value profit">{trade.takeProfit}</span>
        </div>
      </div>

      <div className="active-trade-footer">
        <span className="trade-size">{trade.positionSize} lots</span>
        <span className="trade-time">
          <Clock size={12} />
          {new Date(trade.openedAt).toLocaleTimeString()}
        </span>
        <button className="btn btn-sm btn-outline" onClick={onClose}>
          <X size={14} />
          Close
        </button>
      </div>
    </div>
  )
}

function SettingsModal({ settings, onUpdate, onClose, onReset }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Settings size={20} /> Auto-Trading Settings</h2>
          <button className="close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label>
              <Shield size={16} />
              Risk Management
            </label>
            <div className="setting-row">
              <span>Risk per Trade</span>
              <div className="setting-input">
                <input
                  type="number"
                  value={settings.riskPerTrade}
                  onChange={e => onUpdate('riskPerTrade', parseFloat(e.target.value))}
                  min="0.1"
                  max="5"
                  step="0.1"
                />
                <span>%</span>
              </div>
            </div>
            <div className="setting-row">
              <span>Max Open Trades</span>
              <input
                type="number"
                value={settings.maxOpenTrades}
                onChange={e => onUpdate('maxOpenTrades', parseInt(e.target.value))}
                min="1"
                max="10"
              />
            </div>
            <div className="setting-row">
              <span>Max Daily Trades</span>
              <input
                type="number"
                value={settings.maxDailyTrades}
                onChange={e => onUpdate('maxDailyTrades', parseInt(e.target.value))}
                min="1"
                max="50"
              />
            </div>
            <div className="setting-row">
              <span>Max Daily Loss</span>
              <div className="setting-input">
                <input
                  type="number"
                  value={settings.maxDailyLoss}
                  onChange={e => onUpdate('maxDailyLoss', parseFloat(e.target.value))}
                  min="1"
                  max="20"
                  step="0.5"
                />
                <span>%</span>
              </div>
            </div>
          </div>

          <div className="setting-group">
            <label>
              <Target size={16} />
              Trade Filters
            </label>
            <div className="setting-row">
              <span>Min Confidence</span>
              <div className="setting-input">
                <input
                  type="number"
                  value={settings.minConfidence}
                  onChange={e => onUpdate('minConfidence', parseInt(e.target.value))}
                  min="50"
                  max="90"
                />
                <span>%</span>
              </div>
            </div>
            <div className="setting-row">
              <span>Trading Hours (UTC)</span>
              <div className="setting-input hours">
                <input
                  type="number"
                  value={settings.tradingHours.start}
                  onChange={e => onUpdate('tradingHours', { ...settings.tradingHours, start: parseInt(e.target.value) })}
                  min="0"
                  max="23"
                />
                <span>to</span>
                <input
                  type="number"
                  value={settings.tradingHours.end}
                  onChange={e => onUpdate('tradingHours', { ...settings.tradingHours, end: parseInt(e.target.value) })}
                  min="0"
                  max="23"
                />
              </div>
            </div>
          </div>

          <div className="setting-group">
            <label>
              <TrendingUp size={16} />
              Trailing Stop
            </label>
            <div className="setting-row">
              <span>Enable Trailing Stop</span>
              <input
                type="checkbox"
                checked={settings.useTrailingStop}
                onChange={e => onUpdate('useTrailingStop', e.target.checked)}
              />
            </div>
            {settings.useTrailingStop && (
              <div className="setting-row">
                <span>Trailing Distance</span>
                <div className="setting-input">
                  <input
                    type="number"
                    value={settings.trailingStopPips}
                    onChange={e => onUpdate('trailingStopPips', parseInt(e.target.value))}
                    min="5"
                    max="100"
                  />
                  <span>pips</span>
                </div>
              </div>
            )}
          </div>

          <div className="setting-group danger">
            <label>
              <DollarSign size={16} />
              Account
            </label>
            <div className="setting-row">
              <span>Current Balance</span>
              <span className="balance-display">${parseFloat(settings.accountBalance).toLocaleString()}</span>
            </div>
            <button className="btn btn-danger btn-block" onClick={onReset}>
              Reset Account to $10,000
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
