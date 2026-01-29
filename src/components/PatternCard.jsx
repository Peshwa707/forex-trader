/**
 * PatternCard Component
 * Part of Phase A: Trust Foundation - Trade History & Learning Database
 *
 * Displays discovered trading patterns with win rates and confidence adjustments
 */

import { TrendingUp, TrendingDown, AlertTriangle, Award, Clock, BarChart2 } from 'lucide-react'
import './PatternCard.css'

export function PatternCard({ pattern, type = 'winning' }) {
  const isWinning = type === 'winning' || pattern.type === 'HIGH_VALUE'

  return (
    <div className={`pattern-card ${isWinning ? 'winning' : 'losing'}`}>
      <div className="pattern-header">
        <div className="pattern-icon">
          {isWinning ? (
            <Award className="icon win" size={18} />
          ) : (
            <AlertTriangle className="icon loss" size={18} />
          )}
        </div>
        <div className="pattern-title">
          <span className="pattern-type">
            {isWinning ? 'HIGH VALUE PATTERN' : 'PATTERN TO AVOID'}
          </span>
          <h4 className="pattern-name">{pattern.name}</h4>
        </div>
        <div className={`confidence-badge ${pattern.confidenceAdjustment >= 0 ? 'positive' : 'negative'}`}>
          {pattern.confidenceAdjustment >= 0 ? '+' : ''}{pattern.confidenceAdjustment}%
        </div>
      </div>

      <p className="pattern-description">{pattern.description}</p>

      <div className="pattern-stats">
        <div className="stat">
          <TrendingUp size={14} />
          <span className="stat-value">{pattern.winRate}%</span>
          <span className="stat-label">Win Rate</span>
        </div>
        <div className="stat">
          <BarChart2 size={14} />
          <span className="stat-value">{pattern.trades}</span>
          <span className="stat-label">Trades</span>
        </div>
        <div className="stat">
          <span className={`stat-value ${pattern.avgPnl >= 0 ? 'positive' : 'negative'}`}>
            {pattern.avgPnl >= 0 ? '+' : ''}${pattern.avgPnl?.toFixed(2) || '0.00'}
          </span>
          <span className="stat-label">Avg P/L</span>
        </div>
      </div>

      <div className="pattern-impact">
        {isWinning ? (
          <span className="impact-text positive">
            Bot adds +{pattern.confidenceAdjustment}% confidence when this pattern appears
          </span>
        ) : (
          <span className="impact-text negative">
            Bot subtracts {Math.abs(pattern.confidenceAdjustment)}% confidence when this pattern appears
          </span>
        )}
      </div>
    </div>
  )
}

export function PatternCardList({ patterns, type = 'winning', emptyMessage = 'No patterns discovered yet' }) {
  if (!patterns || patterns.length === 0) {
    return (
      <div className="pattern-list-empty">
        <BarChart2 size={32} />
        <p>{emptyMessage}</p>
        <span>Patterns are discovered after analyzing trade history</span>
      </div>
    )
  }

  return (
    <div className="pattern-card-list">
      {patterns.map((pattern, index) => (
        <PatternCard key={index} pattern={pattern} type={type} />
      ))}
    </div>
  )
}

export default PatternCard
