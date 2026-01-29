import { useState, useEffect } from 'react'
import { Brain, TrendingUp, TrendingDown, Minus, RefreshCw, Activity, Target, BarChart3, Zap } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { CURRENCY_PAIRS } from '../services/forexApi'
import { trainModel, analyzePair, generateHistoricalData, getModelStatus } from '../services/mlPrediction'
import { calculateRSI } from '../services/technicalAnalysis'
import './Analysis.css'

export default function Analysis() {
  const [selectedPair, setSelectedPair] = useState('EUR/USD')
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null) // Track analysis errors
  const [priceHistory, setPriceHistory] = useState([])
  const [modelStatus, setModelStatus] = useState({ trained: false, isTraining: false, progress: 0 })
  const [trainingLogs, setTrainingLogs] = useState([])
  const [activeTab, setActiveTab] = useState('prediction')

  const getBasePrice = (pair) => {
    const basePrices = {
      'EUR/USD': 1.0850,
      'GBP/USD': 1.2700,
      'USD/JPY': 149.50,
      'USD/CHF': 0.8700,
      'AUD/USD': 0.6650,
      'USD/CAD': 1.3600,
      'NZD/USD': 0.6100,
      'EUR/GBP': 0.8550,
      'EUR/JPY': 162.50,
      'GBP/JPY': 190.00,
      'XAU/USD': 2650.00,
      'XAG/USD': 31.50,
    }
    return basePrices[pair] || 1.0
  }

  const runAnalysis = async (history) => {
    setLoading(true)
    setError(null) // Clear previous errors
    try {
      const result = await analyzePair(history, selectedPair)
      setAnalysis(result)
    } catch (err) {
      console.error('Analysis error:', err)
      setError(err.message || 'Failed to analyze pair. Please try again.')
      setAnalysis(null) // Clear stale analysis on error
    }
    setLoading(false)
  }

  useEffect(() => {
    // Generate simulated historical data on mount
    const history = generateHistoricalData(getBasePrice(selectedPair), 180)
    setPriceHistory(history)
    runAnalysis(history)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPair])

  useEffect(() => {
    setModelStatus(getModelStatus())
  }, [])

  const handleTrain = async () => {
    setTrainingLogs([])
    setModelStatus({ ...modelStatus, isTraining: true, progress: 0 })

    const result = await trainModel(priceHistory, (progress) => {
      setModelStatus(prev => ({ ...prev, progress: progress.progress }))
      setTrainingLogs(prev => [...prev, {
        epoch: progress.epoch,
        loss: progress.loss?.toFixed(4),
        accuracy: (progress.accuracy * 100)?.toFixed(1),
        valAccuracy: (progress.valAccuracy * 100)?.toFixed(1)
      }])
    })

    setModelStatus(getModelStatus())

    if (result.success) {
      runAnalysis(priceHistory)
    }
  }

  const handleRefresh = () => {
    const history = generateHistoricalData(getBasePrice(selectedPair), 180)
    setPriceHistory(history)
    runAnalysis(history)
  }

  // Prepare chart data
  const chartData = priceHistory.slice(-100).map((price, idx) => ({
    idx,
    price: price.toFixed(5)
  }))

  const rsiData = calculateRSI(priceHistory.slice(-120), 14).slice(-100).map((rsi, idx) => ({
    idx,
    rsi: rsi.toFixed(1)
  }))

  return (
    <div className="page analysis-page">
      <header className="page-header">
        <div className="header-content">
          <Brain size={28} className="header-icon" />
          <div>
            <h1>AI Analysis</h1>
            <p>ML-powered predictions</p>
          </div>
        </div>
        <button className="refresh-btn" onClick={handleRefresh} disabled={loading}>
          <RefreshCw size={20} className={loading ? 'spinning' : ''} />
        </button>
      </header>

      {/* Pair Selector */}
      <div className="pair-selector">
        <select value={selectedPair} onChange={(e) => setSelectedPair(e.target.value)}>
          {CURRENCY_PAIRS.map(p => (
            <option key={p.pair} value={p.pair}>{p.pair}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'prediction' ? 'active' : ''}`} onClick={() => setActiveTab('prediction')}>
          Prediction
        </button>
        <button className={`tab ${activeTab === 'indicators' ? 'active' : ''}`} onClick={() => setActiveTab('indicators')}>
          Indicators
        </button>
        <button className={`tab ${activeTab === 'training' ? 'active' : ''}`} onClick={() => setActiveTab('training')}>
          Train Model
        </button>
      </div>

      {/* Error UI */}
      {error && (
        <div className="error-card card" style={{ backgroundColor: '#f85149', color: 'white', padding: '1rem', marginBottom: '1rem' }}>
          <strong>Analysis Error:</strong> {error}
          <button
            onClick={handleRefresh}
            style={{ marginLeft: '1rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {activeTab === 'prediction' && analysis && (
        <>
          {/* Main Prediction Card */}
          <div className={`prediction-card card ${analysis.prediction.signal.toLowerCase()}`}>
            <div className="prediction-header">
              <span className="prediction-source">{analysis.prediction.source}</span>
              <span className="prediction-confidence">{analysis.prediction.confidence}% confidence</span>
            </div>

            <div className="prediction-main">
              <div className={`prediction-signal ${analysis.prediction.signal.toLowerCase()}`}>
                {analysis.prediction.direction === 'UP' && <TrendingUp size={32} />}
                {analysis.prediction.direction === 'DOWN' && <TrendingDown size={32} />}
                {analysis.prediction.direction === 'NEUTRAL' && <Minus size={32} />}
                <span>{analysis.prediction.signal}</span>
              </div>

              <div className="prediction-probs">
                <div className="prob-bar">
                  <div className="prob-label">
                    <TrendingUp size={14} />
                    <span>Up</span>
                  </div>
                  <div className="prob-track">
                    <div className="prob-fill up" style={{ width: `${analysis.prediction.probabilities.up}%` }} />
                  </div>
                  <span className="prob-value">{analysis.prediction.probabilities.up}%</span>
                </div>

                <div className="prob-bar">
                  <div className="prob-label">
                    <Minus size={14} />
                    <span>Neutral</span>
                  </div>
                  <div className="prob-track">
                    <div className="prob-fill neutral" style={{ width: `${analysis.prediction.probabilities.neutral}%` }} />
                  </div>
                  <span className="prob-value">{analysis.prediction.probabilities.neutral}%</span>
                </div>

                <div className="prob-bar">
                  <div className="prob-label">
                    <TrendingDown size={14} />
                    <span>Down</span>
                  </div>
                  <div className="prob-track">
                    <div className="prob-fill down" style={{ width: `${analysis.prediction.probabilities.down}%` }} />
                  </div>
                  <span className="prob-value">{analysis.prediction.probabilities.down}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Price Chart */}
          <div className="chart-card card">
            <h3>Price Action (Last 100 periods)</h3>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <XAxis dataKey="idx" hide />
                  <YAxis domain={['auto', 'auto']} hide />
                  <Tooltip
                    contentStyle={{ background: '#21262d', border: '1px solid #30363d' }}
                    labelStyle={{ color: '#8b949e' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#58a6ff"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Key Levels */}
          <div className="levels-card card">
            <h3>Key Levels</h3>
            <div className="levels-grid">
              <div className="level">
                <span className="level-label">Current</span>
                <span className="level-value">{analysis.currentPrice}</span>
              </div>
              <div className="level">
                <span className="level-label">Resistance</span>
                <span className="level-value profit">{analysis.resistance}</span>
              </div>
              <div className="level">
                <span className="level-label">Support</span>
                <span className="level-value loss">{analysis.support}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'indicators' && analysis && (
        <>
          {/* RSI Chart */}
          <div className="chart-card card">
            <h3>RSI (14)</h3>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={rsiData}>
                  <XAxis dataKey="idx" hide />
                  <YAxis domain={[0, 100]} hide />
                  <ReferenceLine y={70} stroke="#f85149" strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke="#3fb950" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{ background: '#21262d', border: '1px solid #30363d' }}
                  />
                  <Line type="monotone" dataKey="rsi" stroke="#a371f7" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="indicator-value">
              Current RSI: <strong className={analysis.indicators.rsi > 70 ? 'loss' : analysis.indicators.rsi < 30 ? 'profit' : ''}>
                {analysis.indicators.rsi}
              </strong>
              <span className="indicator-note">
                {analysis.indicators.rsi > 70 ? '(Overbought)' : analysis.indicators.rsi < 30 ? '(Oversold)' : '(Neutral)'}
              </span>
            </div>
          </div>

          {/* Indicators Grid */}
          <div className="indicators-grid">
            <div className="indicator-card card">
              <div className="indicator-icon">
                <Activity size={20} />
              </div>
              <div className="indicator-info">
                <span className="indicator-name">MACD</span>
                <span className={`indicator-value ${analysis.indicators.macdSignal === 'Bullish' ? 'profit' : 'loss'}`}>
                  {analysis.indicators.macdSignal}
                </span>
              </div>
            </div>

            <div className="indicator-card card">
              <div className="indicator-icon">
                <BarChart3 size={20} />
              </div>
              <div className="indicator-info">
                <span className="indicator-name">Trend</span>
                <span className={`indicator-value ${analysis.indicators.trend === 'Bullish' ? 'profit' : 'loss'}`}>
                  {analysis.indicators.trend}
                </span>
              </div>
            </div>

            <div className="indicator-card card">
              <div className="indicator-icon">
                <Target size={20} />
              </div>
              <div className="indicator-info">
                <span className="indicator-name">BB Position</span>
                <span className="indicator-value">{analysis.indicators.bbPosition}%</span>
              </div>
            </div>

            <div className="indicator-card card">
              <div className="indicator-icon">
                <Zap size={20} />
              </div>
              <div className="indicator-info">
                <span className="indicator-name">SMA Cross</span>
                <span className={`indicator-value ${parseFloat(analysis.currentPrice) > parseFloat(analysis.indicators.sma20) ? 'profit' : 'loss'}`}>
                  {parseFloat(analysis.currentPrice) > parseFloat(analysis.indicators.sma20) ? 'Above' : 'Below'}
                </span>
              </div>
            </div>
          </div>

          {/* Moving Averages */}
          <div className="ma-card card">
            <h3>Moving Averages</h3>
            <div className="ma-list">
              <div className="ma-item">
                <span>SMA 20</span>
                <span>{analysis.indicators.sma20}</span>
                <span className={parseFloat(analysis.currentPrice) > parseFloat(analysis.indicators.sma20) ? 'profit' : 'loss'}>
                  {parseFloat(analysis.currentPrice) > parseFloat(analysis.indicators.sma20) ? 'BUY' : 'SELL'}
                </span>
              </div>
              <div className="ma-item">
                <span>SMA 50</span>
                <span>{analysis.indicators.sma50}</span>
                <span className={parseFloat(analysis.currentPrice) > parseFloat(analysis.indicators.sma50) ? 'profit' : 'loss'}>
                  {parseFloat(analysis.currentPrice) > parseFloat(analysis.indicators.sma50) ? 'BUY' : 'SELL'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'training' && (
        <>
          {/* Model Status */}
          <div className="model-status card">
            <h3>Model Status</h3>
            <div className="status-info">
              <div className="status-item">
                <span>Status</span>
                <span className={modelStatus.trained ? 'profit' : 'loss'}>
                  {modelStatus.isTraining ? 'Training...' : modelStatus.trained ? 'Trained' : 'Not Trained'}
                </span>
              </div>
              {modelStatus.isTraining && (
                <div className="status-item">
                  <span>Progress</span>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${modelStatus.progress}%` }} />
                  </div>
                  <span>{modelStatus.progress.toFixed(0)}%</span>
                </div>
              )}
            </div>

            <button
              className="btn btn-primary train-btn"
              onClick={handleTrain}
              disabled={modelStatus.isTraining}
            >
              <Brain size={18} />
              {modelStatus.isTraining ? 'Training...' : modelStatus.trained ? 'Retrain Model' : 'Train Model'}
            </button>

            <p className="train-note">
              Training uses {priceHistory.length.toLocaleString()} data points with technical indicators to predict price direction.
            </p>
          </div>

          {/* Training Logs */}
          {trainingLogs.length > 0 && (
            <div className="training-logs card">
              <h3>Training Progress</h3>
              <div className="logs-container">
                {trainingLogs.slice(-10).map((log, idx) => (
                  <div key={idx} className="log-entry">
                    <span className="log-epoch">Epoch {log.epoch}</span>
                    <span className="log-loss">Loss: {log.loss}</span>
                    <span className="log-acc">Acc: {log.accuracy}%</span>
                    <span className="log-val">Val: {log.valAccuracy}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* How It Works */}
          <div className="how-it-works card">
            <h3>How It Works</h3>
            <ul>
              <li><strong>Data:</strong> Historical price data with RSI, MACD, and MA indicators</li>
              <li><strong>Model:</strong> Neural network with dropout regularization</li>
              <li><strong>Output:</strong> Predicts UP, DOWN, or NEUTRAL for next period</li>
              <li><strong>Accuracy:</strong> Typically 55-65% after training (better than random)</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
