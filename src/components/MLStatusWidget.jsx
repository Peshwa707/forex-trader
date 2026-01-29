/**
 * ML Status Widget
 * Displays machine learning model status and training progress
 *
 * Shows:
 * - Training data progress (X/200 trades)
 * - Model status (untrained/training/deployed)
 * - Toggle for accelerated collection
 * - Performance metrics
 * - Train button
 */

import { useState, useEffect, useRef } from 'react'
import { Brain, Database, Zap, Play, Check, X, AlertTriangle, TrendingUp } from 'lucide-react'
import { mlApi, settingsApi } from '../services/api'
import './MLStatusWidget.css'

export default function MLStatusWidget({ onStatusChange }) {
  const [status, setStatus] = useState(null)
  const [trainingData, setTrainingData] = useState(null)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [training, setTraining] = useState(false)
  const [toggling, setToggling] = useState(false)
  const intervalRef = useRef(null)

  const loadStatus = async () => {
    try {
      const [mlStatus, dataStatus, settingsData] = await Promise.all([
        mlApi.getStatus(),
        mlApi.getTrainingData(),
        settingsApi.get()
      ])
      setStatus(mlStatus)
      setTrainingData(dataStatus)
      setSettings(settingsData)
      if (onStatusChange) onStatusChange({ mlStatus, dataStatus })
    } catch (error) {
      console.error('Failed to load ML status:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    // Refresh every 30 seconds
    intervalRef.current = setInterval(loadStatus, 30000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const handleToggleML = async () => {
    if (toggling) return
    setToggling(true)
    try {
      const newEnabled = !settings?.useMLForSLTP
      await mlApi.toggle(newEnabled)
      await loadStatus()
    } catch (error) {
      alert(`Failed to toggle ML: ${error.message}`)
    } finally {
      setToggling(false)
    }
  }

  const handleToggleAccelerate = async () => {
    if (toggling) return
    setToggling(true)
    try {
      const newEnabled = !settings?.mlAcceleratedCollection
      await mlApi.accelerate(newEnabled)
      await loadStatus()
    } catch (error) {
      alert(`Failed to toggle accelerated mode: ${error.message}`)
    } finally {
      setToggling(false)
    }
  }

  const handleTrain = async () => {
    if (training) return
    if (!confirm('Start ML model training? This may take several minutes.')) return
    setTraining(true)
    try {
      await mlApi.train()
      alert('Training completed successfully!')
      await loadStatus()
    } catch (error) {
      alert(`Training failed: ${error.message}`)
    } finally {
      setTraining(false)
    }
  }

  if (loading) {
    return (
      <div className="ml-widget ml-loading">
        <Brain size={16} className="ml-icon spinning" />
        <span>Loading ML status...</span>
      </div>
    )
  }

  const minRequired = settings?.minTradesForTraining ?? 200
  const tradeCount = trainingData?.count ?? 0
  const progress = Math.min((tradeCount / minRequired) * 100, 100)
  const canTrain = tradeCount >= minRequired
  const isAccelerated = settings?.mlAcceleratedCollection ?? false
  const isMLEnabled = settings?.useMLForSLTP ?? false

  // Determine model status
  let modelStatus = 'No Model'
  let modelStatusClass = 'none'
  if (status?.modelLoaded) {
    modelStatus = 'Deployed'
    modelStatusClass = 'deployed'
  } else if (status?.lastTrainingDate) {
    modelStatus = 'Trained'
    modelStatusClass = 'trained'
  }

  return (
    <div className={`ml-widget ${isMLEnabled ? 'ml-enabled' : 'ml-disabled'}`}>
      {/* Header */}
      <div className="ml-header">
        <div className="ml-title">
          <Brain size={16} className="ml-icon" />
          <span>ML Model</span>
          {isMLEnabled && <span className="ml-badge">Active</span>}
        </div>
        <button
          className={`ml-toggle-btn ${isMLEnabled ? 'danger' : ''}`}
          onClick={handleToggleML}
          disabled={toggling || !canTrain}
          title={!canTrain ? `Need ${minRequired} trades to enable ML` : ''}
        >
          {toggling ? '...' : isMLEnabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      {/* Status Row */}
      <div className="ml-status-row">
        {/* Model Status */}
        <div className={`ml-status-item ${modelStatusClass}`}>
          {modelStatusClass === 'deployed' ? <Check size={14} /> :
           modelStatusClass === 'trained' ? <TrendingUp size={14} /> :
           <X size={14} />}
          <span>{modelStatus}</span>
        </div>

        {/* Accelerated Mode */}
        <div className={`ml-status-item ${isAccelerated ? 'accelerated' : 'normal'}`}>
          <Zap size={14} />
          <span>{isAccelerated ? 'Fast Collection' : 'Normal'}</span>
        </div>
      </div>

      {/* Training Data Progress */}
      <div className="ml-progress">
        <div className="ml-progress-header">
          <Database size={14} />
          <span>Training Data: {tradeCount} / {minRequired} trades</span>
          {canTrain && <Check size={14} className="ready-icon" />}
        </div>
        <div className="ml-progress-bar">
          <div
            className={`ml-progress-fill ${progress >= 100 ? 'complete' : progress >= 50 ? 'halfway' : 'starting'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="ml-progress-hint">
          {!canTrain && (
            <span>Need {minRequired - tradeCount} more trades for training</span>
          )}
          {canTrain && !status?.modelLoaded && (
            <span className="ready-text">Ready to train!</span>
          )}
          {status?.modelLoaded && (
            <span className="deployed-text">Model is making predictions</span>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="ml-actions">
        <button
          className={`ml-action-btn ${isAccelerated ? 'active' : ''}`}
          onClick={handleToggleAccelerate}
          disabled={toggling}
          title="Lower confidence thresholds to collect data faster"
        >
          <Zap size={14} />
          {isAccelerated ? 'Stop Fast Mode' : 'Fast Collect'}
        </button>
        <button
          className="ml-action-btn train"
          onClick={handleTrain}
          disabled={training || !canTrain}
          title={!canTrain ? `Need ${minRequired} trades` : 'Train ML model'}
        >
          <Play size={14} />
          {training ? 'Training...' : 'Train Model'}
        </button>
      </div>

      {/* Performance Metrics (if model deployed) */}
      {status?.modelLoaded && status?.metrics && (
        <div className="ml-metrics">
          <div className="ml-metric">
            <span className="ml-metric-label">Accuracy</span>
            <span className="ml-metric-value">{(status.metrics.accuracy * 100).toFixed(1)}%</span>
          </div>
          <div className="ml-metric">
            <span className="ml-metric-label">Win Rate</span>
            <span className="ml-metric-value">{(status.metrics.winRate * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* Warning for accelerated mode */}
      {isAccelerated && (
        <div className="ml-warning">
          <AlertTriangle size={12} />
          <span>Fast mode: Lower thresholds active for data collection</span>
        </div>
      )}
    </div>
  )
}
