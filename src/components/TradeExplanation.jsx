/**
 * TradeExplanation Component
 * Displays why each trade was made or skipped
 * Part of Phase A: Trust Foundation
 */

import { TrendingUp, TrendingDown, CheckCircle, XCircle, AlertCircle, Clock, Target, Shield } from 'lucide-react'
import './TradeExplanation.css'

export default function TradeExplanation({ explanation }) {
  if (!explanation) return null

  const getIcon = () => {
    switch (explanation.type) {
      case 'TRADE_EXECUTED':
        return explanation.direction === 'UP'
          ? <TrendingUp size={16} className="icon buy" />
          : <TrendingDown size={16} className="icon sell" />
      case 'TRADE_RESULT':
        return explanation.action === 'WIN'
          ? <CheckCircle size={16} className="icon win" />
          : <XCircle size={16} className="icon loss" />
      case 'TRADE_SKIPPED':
        return <AlertCircle size={16} className="icon skipped" />
      case 'TRADE_BLOCKED':
        return <Shield size={16} className="icon blocked" />
      default:
        return <Target size={16} className="icon neutral" />
    }
  }

  const getTypeClass = () => {
    switch (explanation.type) {
      case 'TRADE_EXECUTED':
        return explanation.direction === 'UP' ? 'executed-buy' : 'executed-sell'
      case 'TRADE_RESULT':
        return explanation.action === 'WIN' ? 'result-win' : 'result-loss'
      case 'TRADE_SKIPPED':
        return 'skipped'
      case 'TRADE_BLOCKED':
        return 'blocked'
      default:
        return 'neutral'
    }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className={`trade-explanation ${getTypeClass()}`}>
      <div className="explanation-header">
        {getIcon()}
        <span className="explanation-headline">{explanation.headline}</span>
        <span className="explanation-time">
          <Clock size={12} />
          {formatTime(explanation.timestamp)}
        </span>
      </div>
      <p className="explanation-reason">{explanation.reason}</p>
      {explanation.details && (
        <div className="explanation-details">
          {explanation.details.confidence && (
            <span className="detail-item confidence">
              {explanation.details.confidence}
            </span>
          )}
          {explanation.details.indicators && explanation.details.indicators.length > 0 && (
            <div className="detail-indicators">
              {explanation.details.indicators.slice(0, 3).map((ind, idx) => (
                <span key={idx} className="indicator-tag">{ind}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * TradeExplanationList - Shows recent trade decisions
 */
export function TradeExplanationList({ explanations, maxItems = 5 }) {
  if (!explanations || explanations.length === 0) {
    return (
      <div className="explanation-list-empty">
        <Target size={32} />
        <p>No recent decisions</p>
        <span>Trade explanations will appear here when the bot runs</span>
      </div>
    )
  }

  return (
    <div className="trade-explanation-list">
      {explanations.slice(0, maxItems).map((exp, idx) => (
        <TradeExplanation key={exp.timestamp || idx} explanation={exp} />
      ))}
    </div>
  )
}
