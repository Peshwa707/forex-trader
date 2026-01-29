/**
 * ML Dashboard Page
 * Part of Phase B: Real ML Implementation
 *
 * Displays ML model status, training data, A/B test results
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Brain, RefreshCw, Play, Square, BarChart2, Database, Beaker,
  AlertTriangle, CheckCircle, TrendingUp, TrendingDown, Activity,
  Layers, Target, Zap, Clock, Download
} from 'lucide-react'
import { mlApi, accountApi } from '../services/api'
import './MLDashboard.css'

export default function MLDashboard() {
  const [status, setStatus] = useState(null)
  const [trainingData, setTrainingData] = useState([])
  const [abTest, setABTest] = useState(null)
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [training, setTraining] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [statusData, trainingDataRes, abTestData, modelsData] = await Promise.all([
        mlApi.getStatus().catch(() => null),
        mlApi.getTrainingData(50).catch(() => ({ records: [] })),
        mlApi.getABTestStatus().catch(() => null),
        mlApi.getModels().catch(() => ({ models: [] }))
      ])
      setStatus(statusData)
      setTrainingData(trainingDataRes?.records || [])
      setABTest(abTestData)
      setModels(modelsData?.models || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  const handleToggleML = async () => {
    try {
      const newState = !status?.useMLForSLTP
      await mlApi.toggle(newState)
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleTrain = async () => {
    setTraining(true)
    try {
      await mlApi.train()
      await loadData()
    } catch (err) {
      setError(err.message)
    } finally {
      setTraining(false)
    }
  }

  const handleStartABTest = async () => {
    try {
      await mlApi.startABTest('ML vs Rule-Based')
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleStopABTest = async () => {
    try {
      await mlApi.stopABTest()
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleExport = async () => {
    try {
      const data = await accountApi.export()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ml-training-data-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [loadData])

  if (loading) {
    return (
      <div className="ml-dashboard">
        <div className="ml-loading">
          <RefreshCw className="spin" size={24} />
          <span>Loading ML Dashboard...</span>
        </div>
      </div>
    )
  }

  const minTradesNeeded = status?.minTradesForTraining || 200
  const currentTrainingCount = status?.trainingDataCount || 0
  const dataProgress = Math.min((currentTrainingCount / minTradesNeeded) * 100, 100)
  const canTrain = currentTrainingCount >= minTradesNeeded

  return (
    <div className="ml-dashboard">
      <header className="ml-header">
        <div className="header-title">
          <Brain size={24} />
          <h1>ML Dashboard</h1>
        </div>
        <div className="header-actions">
          <button
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? 'spin' : ''} size={16} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="ml-error">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <nav className="ml-tabs">
        <button
          className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <BarChart2 size={16} />
          Overview
        </button>
        <button
          className={`tab ${activeTab === 'training' ? 'active' : ''}`}
          onClick={() => setActiveTab('training')}
        >
          <Database size={16} />
          Training Data
        </button>
        <button
          className={`tab ${activeTab === 'abtest' ? 'active' : ''}`}
          onClick={() => setActiveTab('abtest')}
        >
          <Beaker size={16} />
          A/B Testing
        </button>
        <button
          className={`tab ${activeTab === 'models' ? 'active' : ''}`}
          onClick={() => setActiveTab('models')}
        >
          <Layers size={16} />
          Models
        </button>
      </nav>

      <main className="ml-content">
        {activeTab === 'overview' && (
          <div className="overview-tab">
            {/* Status Cards */}
            <div className="status-cards">
              <div className={`status-card ${status?.initialized ? 'active' : 'inactive'}`}>
                <div className="card-icon">
                  <Brain size={24} />
                </div>
                <div className="card-content">
                  <span className="card-label">ML Service</span>
                  <span className="card-value">
                    {status?.initialized ? 'Initialized' : 'Not Initialized'}
                  </span>
                </div>
              </div>

              <div className={`status-card ${status?.modelLoaded ? 'active' : 'inactive'}`}>
                <div className="card-icon">
                  <Target size={24} />
                </div>
                <div className="card-content">
                  <span className="card-label">Model Status</span>
                  <span className="card-value">
                    {status?.modelLoaded ? `v${status.modelVersion}` : 'Not Trained'}
                  </span>
                </div>
              </div>

              <div className={`status-card ${status?.useMLForSLTP ? 'active' : 'inactive'}`}>
                <div className="card-icon">
                  <Zap size={24} />
                </div>
                <div className="card-content">
                  <span className="card-label">ML Predictions</span>
                  <span className="card-value">
                    {status?.useMLForSLTP ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <button
                  className={`toggle-btn ${status?.useMLForSLTP ? 'on' : 'off'}`}
                  onClick={handleToggleML}
                  disabled={!status?.modelLoaded}
                >
                  {status?.useMLForSLTP ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="status-card">
                <div className="card-icon">
                  <Database size={24} />
                </div>
                <div className="card-content">
                  <span className="card-label">Training Samples</span>
                  <span className="card-value">{currentTrainingCount}</span>
                </div>
              </div>
            </div>

            {/* Data Collection Progress */}
            <div className="progress-section">
              <h3>
                <Activity size={18} />
                Data Collection Progress
              </h3>
              <div className="progress-container">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${dataProgress}%` }}
                  />
                </div>
                <span className="progress-text">
                  {currentTrainingCount} / {minTradesNeeded} trades
                  {canTrain ? ' - Ready to train!' : ''}
                </span>
              </div>
              {!canTrain && (
                <p className="progress-hint">
                  Continue paper trading to collect more data. ML training requires
                  at least {minTradesNeeded} closed trades with outcomes.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="actions-section">
              <h3>
                <Zap size={18} />
                Quick Actions
              </h3>
              <div className="action-buttons">
                <button
                  className="action-btn primary"
                  onClick={handleTrain}
                  disabled={!canTrain || training}
                >
                  {training ? (
                    <>
                      <RefreshCw className="spin" size={16} />
                      Training...
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Train Model
                    </>
                  )}
                </button>
                <button
                  className="action-btn secondary"
                  onClick={handleExport}
                >
                  <Download size={16} />
                  Export Data
                </button>
              </div>
            </div>

            {/* Model Performance */}
            {status?.modelLoaded && status?.lastTraining && (
              <div className="performance-section">
                <h3>
                  <TrendingUp size={18} />
                  Model Performance
                </h3>
                <div className="performance-grid">
                  <div className="performance-item">
                    <span className="perf-label">Validation Loss</span>
                    <span className="perf-value">
                      {status.lastTraining.validationLoss?.toFixed(4) || 'N/A'}
                    </span>
                  </div>
                  <div className="performance-item">
                    <span className="perf-label">Backtest Improvement</span>
                    <span className={`perf-value ${(status.lastTraining.improvement || 0) >= 0 ? 'positive' : 'negative'}`}>
                      {status.lastTraining.improvement
                        ? `${status.lastTraining.improvement >= 0 ? '+' : ''}${status.lastTraining.improvement.toFixed(1)}%`
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="performance-item">
                    <span className="perf-label">Training Samples</span>
                    <span className="perf-value">
                      {status.lastTraining.trainingSize || 'N/A'}
                    </span>
                  </div>
                  <div className="performance-item">
                    <span className="perf-label">Trained At</span>
                    <span className="perf-value">
                      {status.lastTraining.trainedAt
                        ? new Date(status.lastTraining.trainedAt).toLocaleDateString()
                        : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'training' && (
          <div className="training-tab">
            <div className="training-header">
              <h3>
                <Database size={18} />
                Recent Training Data
              </h3>
              <span className="data-count">{trainingData.length} records</span>
            </div>

            {trainingData.length === 0 ? (
              <div className="empty-state">
                <Database size={48} />
                <h4>No Training Data Yet</h4>
                <p>Start paper trading to collect ML training data.</p>
              </div>
            ) : (
              <div className="training-table-wrapper">
                <table className="training-table">
                  <thead>
                    <tr>
                      <th>Trade ID</th>
                      <th>Pair</th>
                      <th>Direction</th>
                      <th>RSI</th>
                      <th>ATR</th>
                      <th>Session</th>
                      <th>SL Used</th>
                      <th>TP Used</th>
                      <th>PnL Pips</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trainingData.map((record) => (
                      <tr key={record.id}>
                        <td>{record.trade_id}</td>
                        <td>{record.pair || '-'}</td>
                        <td className={record.trade_direction === 1 ? 'up' : 'down'}>
                          {record.trade_direction === 1 ? 'UP' : 'DOWN'}
                        </td>
                        <td>{record.rsi_14?.toFixed(1) || '-'}</td>
                        <td>{record.atr_14?.toFixed(5) || '-'}</td>
                        <td>{getSessionName(record)}</td>
                        <td>{record.sl_multiplier_used?.toFixed(2) || '-'}x</td>
                        <td>{record.tp_multiplier_used?.toFixed(2) || '-'}x</td>
                        <td className={record.pnl_pips >= 0 ? 'positive' : 'negative'}>
                          {record.pnl_pips?.toFixed(1) || '-'}
                        </td>
                        <td>
                          <span className={`outcome-badge ${record.close_reason?.toLowerCase()}`}>
                            {record.close_reason || 'OPEN'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'abtest' && (
          <div className="abtest-tab">
            <div className="abtest-header">
              <h3>
                <Beaker size={18} />
                A/B Testing
              </h3>
              {abTest?.active ? (
                <button className="action-btn danger" onClick={handleStopABTest}>
                  <Square size={16} />
                  Stop Test
                </button>
              ) : (
                <button
                  className="action-btn primary"
                  onClick={handleStartABTest}
                  disabled={!status?.modelLoaded}
                >
                  <Play size={16} />
                  Start Test
                </button>
              )}
            </div>

            {abTest?.active ? (
              <div className="abtest-results">
                <div className="test-info">
                  <span className="test-name">{abTest.active.name}</span>
                  <span className="test-started">
                    <Clock size={14} />
                    Started {new Date(abTest.active.startedAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="groups-comparison">
                  <div className="group-card control">
                    <h4>Control (Rule-Based)</h4>
                    <div className="group-stats">
                      <div className="stat">
                        <span className="stat-label">Trades</span>
                        <span className="stat-value">{abTest.active.control?.trades || 0}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Win Rate</span>
                        <span className="stat-value">
                          {((abTest.active.control?.winRate || 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Avg PnL</span>
                        <span className={`stat-value ${(abTest.active.control?.avgPnl || 0) >= 0 ? 'positive' : 'negative'}`}>
                          {(abTest.active.control?.avgPnl || 0).toFixed(1)} pips
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Sharpe</span>
                        <span className="stat-value">
                          {(abTest.active.control?.sharpe || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="group-card treatment">
                    <h4>Treatment (ML)</h4>
                    <div className="group-stats">
                      <div className="stat">
                        <span className="stat-label">Trades</span>
                        <span className="stat-value">{abTest.active.treatment?.trades || 0}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Win Rate</span>
                        <span className="stat-value">
                          {((abTest.active.treatment?.winRate || 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Avg PnL</span>
                        <span className={`stat-value ${(abTest.active.treatment?.avgPnl || 0) >= 0 ? 'positive' : 'negative'}`}>
                          {(abTest.active.treatment?.avgPnl || 0).toFixed(1)} pips
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Sharpe</span>
                        <span className="stat-value">
                          {(abTest.active.treatment?.sharpe || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="significance-card">
                  <h4>Statistical Significance</h4>
                  <div className="significance-content">
                    <div className="p-value">
                      <span className="label">p-value</span>
                      <span className={`value ${(abTest.active.pValue || 1) < 0.05 ? 'significant' : ''}`}>
                        {(abTest.active.pValue || 1).toFixed(4)}
                      </span>
                    </div>
                    <div className="improvement">
                      <span className="label">ML Improvement</span>
                      <span className={`value ${(abTest.active.improvement || 0) >= 0 ? 'positive' : 'negative'}`}>
                        {(abTest.active.improvement || 0) >= 0 ? '+' : ''}
                        {(abTest.active.improvement || 0).toFixed(1)} pips/trade
                      </span>
                    </div>
                    <div className="verdict">
                      {(abTest.active.pValue || 1) < 0.05 ? (
                        (abTest.active.improvement || 0) > 0 ? (
                          <span className="positive">
                            <CheckCircle size={16} />
                            ML is significantly better!
                          </span>
                        ) : (
                          <span className="negative">
                            <AlertTriangle size={16} />
                            Rule-based is significantly better
                          </span>
                        )
                      ) : (
                        <span className="neutral">
                          <Activity size={16} />
                          Not enough data for significance (need p &lt; 0.05)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <Beaker size={48} />
                <h4>No Active A/B Test</h4>
                <p>
                  Start an A/B test to compare ML predictions against rule-based
                  SL/TP calculations. 50% of trades will use each method.
                </p>
                {!status?.modelLoaded && (
                  <p className="warning">
                    <AlertTriangle size={14} />
                    Train a model first before starting A/B testing.
                  </p>
                )}
              </div>
            )}

            {abTest?.history?.length > 0 && (
              <div className="test-history">
                <h4>Previous Tests</h4>
                <div className="history-list">
                  {abTest.history.map((test) => (
                    <div key={test.id} className="history-item">
                      <div className="history-info">
                        <span className="history-name">{test.name}</span>
                        <span className="history-dates">
                          {new Date(test.startedAt).toLocaleDateString()} -
                          {test.endedAt ? new Date(test.endedAt).toLocaleDateString() : 'Ongoing'}
                        </span>
                      </div>
                      <div className="history-result">
                        <span className={`history-improvement ${(test.improvement || 0) >= 0 ? 'positive' : 'negative'}`}>
                          {(test.improvement || 0) >= 0 ? '+' : ''}{(test.improvement || 0).toFixed(1)} pips
                        </span>
                        <span className="history-conclusion">{test.conclusion || 'Ended'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'models' && (
          <div className="models-tab">
            <div className="models-header">
              <h3>
                <Layers size={18} />
                Model Versions
              </h3>
            </div>

            {models.length === 0 ? (
              <div className="empty-state">
                <Layers size={48} />
                <h4>No Models Trained</h4>
                <p>Train your first model when you have enough data.</p>
              </div>
            ) : (
              <div className="models-list">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className={`model-card ${model.is_active ? 'active' : ''}`}
                  >
                    <div className="model-info">
                      <div className="model-version">
                        <span className="version-label">Version</span>
                        <span className="version-number">{model.version}</span>
                      </div>
                      {model.is_active && (
                        <span className="active-badge">
                          <CheckCircle size={12} />
                          Active
                        </span>
                      )}
                    </div>
                    <div className="model-stats">
                      <div className="model-stat">
                        <span className="stat-label">Training Loss</span>
                        <span className="stat-value">{model.training_loss?.toFixed(4) || 'N/A'}</span>
                      </div>
                      <div className="model-stat">
                        <span className="stat-label">Validation Loss</span>
                        <span className="stat-value">{model.validation_loss?.toFixed(4) || 'N/A'}</span>
                      </div>
                      <div className="model-stat">
                        <span className="stat-label">Training Samples</span>
                        <span className="stat-value">{model.training_samples || 'N/A'}</span>
                      </div>
                      <div className="model-stat">
                        <span className="stat-label">Created</span>
                        <span className="stat-value">
                          {model.created_at ? new Date(model.created_at).toLocaleDateString() : 'N/A'}
                        </span>
                      </div>
                    </div>
                    {!model.is_active && (
                      <button
                        className="activate-btn"
                        onClick={() => mlApi.activateModel(model.id).then(loadData)}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="ml-footer">
        <p>
          ML models optimize SL/TP levels based on historical trade performance.
          Requires minimum {minTradesNeeded} trades for initial training.
        </p>
      </footer>
    </div>
  )
}

// Helper function to get session name from one-hot encoded flags
function getSessionName(record) {
  if (record.session_overlap) return 'Overlap'
  if (record.session_london) return 'London'
  if (record.session_newyork) return 'New York'
  if (record.session_asian) return 'Asian'
  return 'Unknown'
}
