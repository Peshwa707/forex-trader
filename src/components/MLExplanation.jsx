/**
 * MLExplanation Component
 * Displays ML decision factors and explanations for trades
 * Part of Phase B: Real ML Implementation
 */

import { Brain, TrendingUp, TrendingDown, Clock, Zap, BarChart2, Target, AlertCircle } from 'lucide-react'
import './MLExplanation.css'

/**
 * Shows ML prediction explanation for a single trade
 */
export default function MLExplanation({ mlPrediction, levels }) {
  if (!mlPrediction) return null

  const { useML, slMultiplier, tpMultiplier, confidence, explanation, abTestGroup, reason } = mlPrediction

  return (
    <div className={`ml-explanation ${useML ? 'ml-active' : 'ml-fallback'}`}>
      <div className="ml-explanation-header">
        <Brain size={16} className={useML ? 'icon-active' : 'icon-inactive'} />
        <span className="ml-status">
          {useML ? 'ML-Optimized Levels' : 'Rule-Based Levels'}
        </span>
        {abTestGroup && (
          <span className={`ab-test-badge ${abTestGroup.toLowerCase()}`}>
            {abTestGroup}
          </span>
        )}
      </div>

      <div className="ml-levels">
        <div className="ml-level-item">
          <span className="level-label">SL Multiplier</span>
          <span className="level-value">{slMultiplier?.toFixed(2)}x ATR</span>
        </div>
        <div className="ml-level-item">
          <span className="level-label">TP Multiplier</span>
          <span className="level-value">{tpMultiplier?.toFixed(2)}x ATR</span>
        </div>
        {confidence && (
          <div className="ml-level-item">
            <span className="level-label">ML Confidence</span>
            <span className={`level-value ${confidence >= 70 ? 'high' : confidence >= 50 ? 'medium' : 'low'}`}>
              {Math.round(confidence)}%
            </span>
          </div>
        )}
      </div>

      {explanation && (
        <p className="ml-explanation-text">{explanation}</p>
      )}

      {!useML && reason && (
        <p className="ml-fallback-reason">
          <AlertCircle size={12} />
          {reason}
        </p>
      )}
    </div>
  )
}

/**
 * Compact ML badge for trade cards
 */
export function MLBadge({ mlPrediction }) {
  if (!mlPrediction) return null

  const { useML, abTestGroup } = mlPrediction

  return (
    <span className={`ml-badge ${useML ? 'ml-active' : 'ml-fallback'}`}>
      <Brain size={12} />
      {useML ? 'ML' : 'Rules'}
      {abTestGroup && <span className="ab-group">({abTestGroup[0]})</span>}
    </span>
  )
}

/**
 * Feature importance visualization
 */
export function MLFeatureImportance({ features }) {
  if (!features || Object.keys(features).length === 0) return null

  const sortedFeatures = Object.entries(features)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 5)

  return (
    <div className="ml-feature-importance">
      <h4>
        <Zap size={14} />
        Key Decision Factors
      </h4>
      <div className="feature-list">
        {sortedFeatures.map(([name, value]) => (
          <div key={name} className="feature-item">
            <span className="feature-name">{formatFeatureName(name)}</span>
            <div className="feature-bar-container">
              <div
                className={`feature-bar ${value >= 0 ? 'positive' : 'negative'}`}
                style={{ width: `${Math.min(Math.abs(value) * 100, 100)}%` }}
              />
            </div>
            <span className={`feature-value ${value >= 0 ? 'positive' : 'negative'}`}>
              {value >= 0 ? '+' : ''}{(value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * ML Status indicator for bot page
 */
export function MLStatusIndicator({ status }) {
  if (!status) return null

  const { initialized, modelLoaded, modelVersion, trainingDataCount, useMLForSLTP } = status

  const getStatusColor = () => {
    if (!initialized) return 'status-inactive'
    if (!modelLoaded) return 'status-collecting'
    if (!useMLForSLTP) return 'status-ready'
    return 'status-active'
  }

  const getStatusText = () => {
    if (!initialized) return 'Not Initialized'
    if (!modelLoaded) return `Collecting Data (${trainingDataCount || 0}/200)`
    if (!useMLForSLTP) return 'Model Ready (Disabled)'
    return `Active v${modelVersion || '1'}`
  }

  return (
    <div className={`ml-status-indicator ${getStatusColor()}`}>
      <Brain size={16} />
      <div className="status-info">
        <span className="status-label">ML Status</span>
        <span className="status-text">{getStatusText()}</span>
      </div>
      {modelLoaded && (
        <div className="status-meta">
          <span>{trainingDataCount} samples</span>
        </div>
      )}
    </div>
  )
}

// Helper function
function formatFeatureName(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}
