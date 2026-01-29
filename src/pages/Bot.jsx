import { useState, useEffect, useRef, useCallback } from 'react'
import { Bot, Play, Pause, TrendingUp, TrendingDown, Target, Activity, RefreshCw, Trash2, Download, Settings, Zap, X, DollarSign, Clock, Shield, Wifi, WifiOff, AlertTriangle, Link, Unlink, Brain } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { botApi, tradesApi, settingsApi, statsApi, accountApi, isApiAvailable, ibApi, modeApi, riskApi, mlApi, shariahApi } from '../services/api'
import { suggestPositionSize } from '../services/autoTrader'
import RiskDashboard from '../components/RiskDashboard'
import { TradeExplanationList } from '../components/TradeExplanation'
import ShariahStatusWidget from '../components/ShariahStatusWidget'
import Phase3AnalysisWidget from '../components/Phase3AnalysisWidget'
import MLStatusWidget from '../components/MLStatusWidget'
import './Bot.css'

export default function BotPage() {
  const [isRunning, setIsRunning] = useState(false)
  const [suggestions] = useState([])
  const [performance, setPerformance] = useState(null)
  const [logs, setLogs] = useState([])
  const [activeTab, setActiveTab] = useState('active')
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const intervalRef = useRef(null)
  const isBotCycleRunning = useRef(false) // Prevent race conditions on double-click

  // Auto-trading state
  const [autoSettings, setAutoSettings] = useState({})
  const [activeTrades, setActiveTrades] = useState([])
  const [tradingStats, setTradingStats] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [apiConnected, setApiConnected] = useState(true)

  // IB integration state
  const [ibStatus, setIbStatus] = useState(null)
  const [tradingMode, setTradingMode] = useState('SIMULATION')
  const [ibAccount, setIbAccount] = useState(null)
  const [riskStatus, setRiskStatus] = useState(null)

  // Phase A: Trust Foundation - Risk Dashboard & Trade Explanations
  const [riskDashboard, setRiskDashboard] = useState(null)
  const [tradeExplanations, setTradeExplanations] = useState([])

  // Phase B: ML Status
  const [mlStatus, setMlStatus] = useState(null)

  // Shariah Compliance Status
  const [shariahStatus, setShariahStatus] = useState(null)

  const checkApiAndLoad = async () => {
    const connected = await isApiAvailable()
    setApiConnected(connected)
    if (connected) {
      loadData()
      loadBotStatus()
    }
  }

  useEffect(() => {
    checkApiAndLoad()
    // Auto-refresh every 30 seconds
    intervalRef.current = setInterval(loadData, 30000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadBotStatus = async () => {
    try {
      const status = await botApi.getStatus()
      setIsRunning(status.enabled)
      if (status.lastRun) {
        setLastUpdate(new Date(status.lastRun))
      }
    } catch (error) {
      console.error('Failed to load bot status:', error)
    }
  }

  const loadData = async () => {
    try {
      const [trades, stats, settings, predictions, ibStatusData, modeData, riskData, riskDashboardData, explanationsData, mlStatusData] = await Promise.all([
        tradesApi.getActive(),
        statsApi.get(),
        settingsApi.get(),
        statsApi.getPredictions(50),
        ibApi.getStatus().catch((err) => {
          console.warn('IB status fetch failed:', err.message)
          return null
        }),
        modeApi.get().catch((err) => {
          console.warn('Mode fetch failed, using SIMULATION:', err.message)
          return { mode: 'SIMULATION' }
        }),
        riskApi.getStatus().catch((err) => {
          console.warn('Risk status fetch failed:', err.message)
          return null
        }),
        riskApi.getDashboard().catch((err) => {
          console.warn('Risk dashboard fetch failed:', err.message)
          return null
        }),
        statsApi.getExplanations(10).catch((err) => {
          console.warn('Explanations fetch failed:', err.message)
          return []
        }),
        mlApi.getStatus().catch((err) => {
          console.warn('ML status fetch failed:', err.message)
          return null
        })
      ])

      setActiveTrades(trades)
      setTradingStats(stats)
      setAutoSettings(settings)
      setLogs(predictions)
      setPerformance(stats)
      setIbStatus(ibStatusData)
      setTradingMode(modeData?.mode || 'SIMULATION')
      setRiskStatus(riskData)
      setRiskDashboard(riskDashboardData)
      setTradeExplanations(explanationsData)
      setMlStatus(mlStatusData)

      // Load IB account if connected
      if (ibStatusData?.isConnected) {
        const accountData = await ibApi.getAccountStatus().catch(() => null)
        setIbAccount(accountData)
      }

      setLastUpdate(new Date())
    } catch (error) {
      console.error('Failed to load data:', error)
      setApiConnected(false)
    }
  }

  const runBot = useCallback(async () => {
    // Prevent race condition from double-clicks
    if (isBotCycleRunning.current) {
      console.log('Bot cycle already running, skipping duplicate request')
      return
    }

    isBotCycleRunning.current = true
    setLoading(true)
    try {
      // Trigger a bot cycle on the server
      await botApi.runCycle()
      await loadData()
    } catch (error) {
      console.error('Failed to run bot cycle:', error)
    } finally {
      setLoading(false)
      isBotCycleRunning.current = false
    }
  }, [])

  const toggleBot = async () => {
    try {
      if (isRunning) {
        await botApi.stop()
        setIsRunning(false)
      } else {
        await botApi.start()
        setIsRunning(true)
        // Run immediately
        runBot()
      }
    } catch (error) {
      console.error('Failed to toggle bot:', error)
    }
  }

  const handleClearLogs = () => {
    // Note: Server-side doesn't have clear logs endpoint yet
    alert('Logs are stored on the server. Use export to download.')
  }

  const handleExport = async () => {
    try {
      const data = await accountApi.export()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `forex-bot-export-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      // Revoke object URL to prevent memory leak
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  // Trade execution handlers
  const handleExecuteTrade = async () => {
    // Server handles execution automatically via bot cycle
    alert('Trades are executed automatically by the server based on ML predictions')
  }

  const handleCloseTrade = async (tradeId) => {
    try {
      await tradesApi.close(tradeId)
      await loadData()
    } catch (error) {
      alert(`Failed to close trade: ${error.message}`)
    }
  }

  const handleCloseAllTrades = async () => {
    if (confirm('Close all active trades?')) {
      try {
        await tradesApi.closeAll()
        await loadData()
      } catch (error) {
        alert(`Failed to close trades: ${error.message}`)
      }
    }
  }

  const handleToggleAutoTrading = async () => {
    try {
      const newSettings = { ...autoSettings, enabled: !autoSettings.enabled }
      await settingsApi.update(newSettings)
      setAutoSettings(newSettings)
    } catch (error) {
      console.error('Failed to toggle auto trading:', error)
    }
  }

  const handleUpdateSettings = async (key, value) => {
    try {
      const newSettings = { ...autoSettings, [key]: value }
      await settingsApi.update(newSettings)
      setAutoSettings(newSettings)
    } catch (error) {
      console.error('Failed to update settings:', error)
    }
  }

  const handleResetAccount = async () => {
    if (confirm('Reset account to $10,000? This will close all trades and clear history.')) {
      try {
        await accountApi.reset(10000)
        await loadData()
      } catch (error) {
        alert(`Failed to reset account: ${error.message}`)
      }
    }
  }

  // IB connection handlers
  const handleConnectIB = async () => {
    try {
      await ibApi.connect()
      await loadData()
    } catch (error) {
      alert(`Failed to connect to IB: ${error.message}`)
    }
  }

  const handleDisconnectIB = async () => {
    try {
      await ibApi.disconnect()
      await loadData()
    } catch (error) {
      alert(`Failed to disconnect from IB: ${error.message}`)
    }
  }

  const handleModeChange = async (newMode) => {
    try {
      await modeApi.set(newMode)
      setTradingMode(newMode)
      await loadData()
    } catch (error) {
      alert(`Failed to change mode: ${error.message}`)
    }
  }

  const handleKillSwitch = async () => {
    if (confirm('EMERGENCY STOP: This will stop the bot and optionally close all trades. Continue?')) {
      const closeAll = confirm('Also close all open trades?')
      try {
        await modeApi.killswitch(closeAll)
        setIsRunning(false)
        await loadData()
        alert('Kill switch activated')
      } catch (error) {
        alert(`Kill switch failed: ${error.message}`)
      }
    }
  }

  // Prepare accuracy chart data from logs
  const accuracyData = []
  // Filter for resolved predictions with valid correct field
  const logsForChart = logs.filter(l => l.outcome !== null && l.correct !== null && l.correct !== undefined)
  let runningCorrect = 0
  let runningTotal = 0

  logsForChart.slice(-100).forEach((log, idx) => {
    runningTotal++
    // Explicitly check for true to handle null/undefined correctly
    if (log.correct === true) runningCorrect++
    accuracyData.push({
      idx,
      accuracy: runningTotal > 0 ? ((runningCorrect / runningTotal) * 100).toFixed(1) : '0.0',
      pips: parseFloat(log.pnl_pips || log.pnlPips || 0)
    })
  })

  // Cumulative P/L data
  const pnlData = []
  let cumPnl = 0
  logsForChart.slice(-100).forEach((log, idx) => {
    cumPnl += parseFloat(log.pnl_pips || log.pnlPips || 0)
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
          <div className={`connection-status ${apiConnected ? 'connected' : 'disconnected'}`}>
            {apiConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
          </div>
          <button className="icon-btn" onClick={() => setShowSettings(true)}>
            <Settings size={20} />
          </button>
          <button
            className={`bot-toggle ${isRunning ? 'running' : ''}`}
            onClick={toggleBot}
            disabled={!apiConnected}
          >
            {isRunning ? <Pause size={20} /> : <Play size={20} />}
            {isRunning ? 'Stop' : 'Start'}
          </button>
        </div>
      </header>

      {/* IB Connection & Mode Bar */}
      <div className="ib-bar">
        <div className="ib-connection">
          <span className={`ib-status ${ibStatus?.isConnected ? 'connected' : 'disconnected'}`}>
            {ibStatus?.isConnected ? <Link size={16} /> : <Unlink size={16} />}
            IB: {ibStatus?.isConnected ? 'Connected' : 'Disconnected'}
          </span>
          {ibStatus?.isConnected ? (
            <button className="btn btn-sm btn-outline" onClick={handleDisconnectIB}>
              Disconnect
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={handleConnectIB}>
              Connect
            </button>
          )}
        </div>

        <div className="mode-selector">
          <span className="mode-label">Mode:</span>
          <select
            value={tradingMode}
            onChange={(e) => handleModeChange(e.target.value)}
            className={`mode-select ${tradingMode.toLowerCase()}`}
          >
            <option value="SIMULATION">SIMULATION</option>
            <option value="PAPER" disabled={!ibStatus?.isConnected}>PAPER</option>
            <option value="LIVE" disabled={!ibStatus?.isConnected}>LIVE</option>
          </select>
        </div>

        {ibAccount && (
          <div className="ib-account-info">
            <span className="account-id">{ibAccount.accountId}</span>
            <span className="net-liq">${parseFloat(ibAccount.summary?.NetLiquidation || 0).toLocaleString()}</span>
          </div>
        )}

        <button className="btn btn-sm btn-danger kill-switch" onClick={handleKillSwitch}>
          <AlertTriangle size={14} />
          KILL
        </button>
      </div>

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

      {/* Shariah Compliance Widget */}
      <ShariahStatusWidget onStatusChange={setShariahStatus} />

      {/* Phase B: ML Status Widget */}
      <MLStatusWidget onStatusChange={setMlStatus} />

      {/* Phase 3: Advanced Analysis Widget */}
      <Phase3AnalysisWidget />

      {/* Phase A: Trust Foundation - Risk Dashboard */}
      <RiskDashboard
        riskStatus={riskDashboard}
        onKillSwitch={handleKillSwitch}
      />

      {/* Phase A: Trust Foundation - Trade Explanations */}
      <div className="explanations-panel">
        <div className="explanations-panel-header">
          <div className="explanations-panel-title">
            <Activity size={16} />
            <span>Recent Decisions</span>
          </div>
          <div className="header-links">
            <a href="/analytics" className="view-analytics-link">Analytics</a>
            <span className="link-separator">|</span>
            <a href="/backtest" className="view-analytics-link">Backtest</a>
          </div>
        </div>
        <TradeExplanationList explanations={tradeExplanations} maxItems={5} />
      </div>

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
                <span>Total Trades</span>
                <span>{performance.totalTrades}</span>
              </div>
              <div className="stat-row">
                <span>Winning Trades</span>
                <span className="profit">{performance.winningTrades}</span>
              </div>
              <div className="stat-row">
                <span>Losing Trades</span>
                <span className="loss">{performance.losingTrades}</span>
              </div>
              <div className="stat-row">
                <span>Win Rate</span>
                <span className={parseFloat(performance.winRate) >= 50 ? 'profit' : 'loss'}>
                  {performance.winRate}%
                </span>
              </div>
              <div className="stat-row">
                <span>Avg Win</span>
                <span className="profit">+{performance.avgWin} pips</span>
              </div>
              <div className="stat-row">
                <span>Avg Loss</span>
                <span className="loss">-{performance.avgLoss} pips</span>
              </div>
              <div className="stat-row">
                <span>Total P/L</span>
                <span className={parseFloat(performance.totalPnl) >= 0 ? 'profit' : 'loss'}>
                  {parseFloat(performance.totalPnl) >= 0 ? '+' : ''}${performance.totalPnl}
                </span>
              </div>
              <div className="stat-row">
                <span>Total Pips</span>
                <span className={parseFloat(performance.totalPips) >= 0 ? 'profit' : 'loss'}>
                  {parseFloat(performance.totalPips) >= 0 ? '+' : ''}{performance.totalPips}
                </span>
              </div>
              <div className="stat-row">
                <span>Profit Factor</span>
                <span className={parseFloat(performance.profitFactor) >= 1 ? 'profit' : 'loss'}>
                  {performance.profitFactor}
                </span>
              </div>
            </div>
          </div>

          {/* By Pair Performance */}
          {performance.byPair && Object.keys(performance.byPair).length > 0 && (
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
  // Handle both camelCase and snake_case from database
  const pnl = parseFloat(trade.pnl || 0)
  const pnlPips = parseFloat(trade.pnl_pips || trade.pnlPips || 0)
  const entryPrice = trade.entry_price || trade.entryPrice
  const currentPrice = trade.current_price || trade.currentPrice || entryPrice
  const stopLoss = trade.stop_loss || trade.stopLoss
  const takeProfit = trade.take_profit || trade.takeProfit
  const trailingStop = trade.trailing_stop || trade.trailingStop
  const positionSize = trade.position_size || trade.positionSize
  const openedAt = trade.opened_at || trade.openedAt

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
          <span className="pnl-value">{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
          <span className="pnl-pips">{pnlPips >= 0 ? '+' : ''}{pnlPips.toFixed(1)} pips</span>
        </div>
      </div>

      <div className="active-trade-prices">
        <div className="price-item">
          <span className="price-label">Entry</span>
          <span className="price-value">{entryPrice}</span>
        </div>
        <div className="price-item">
          <span className="price-label">Current</span>
          <span className="price-value current">{currentPrice}</span>
        </div>
        <div className="price-item">
          <span className="price-label">SL</span>
          <span className="price-value loss">{trailingStop || stopLoss}</span>
        </div>
        <div className="price-item">
          <span className="price-label">TP</span>
          <span className="price-value profit">{takeProfit}</span>
        </div>
      </div>

      <div className="active-trade-footer">
        <span className="trade-size">{positionSize} lots</span>
        <span className="trade-time">
          <Clock size={12} />
          {openedAt ? new Date(openedAt).toLocaleTimeString() : '-'}
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

// MLStatusWidget is now imported from ../components/MLStatusWidget
