/**
 * Analytics Page
 * Part of Phase A: Trust Foundation - Trade History & Learning Database
 *
 * Displays discovered patterns and win rate analysis
 */

import { useState, useEffect } from 'react'
import {
  BarChart2, RefreshCw, TrendingUp, TrendingDown, Award, AlertTriangle,
  Clock, Calendar, Activity, Zap, Target
} from 'lucide-react'
import { analyticsApi } from '../services/api'
import { PatternCardList } from '../components/PatternCard'
import {
  WinRateByHour, WinRateByDay, WinRateBySession,
  WinRateByRSI, WinRateByPair, WinRateByTrend
} from '../components/WinRateChart'
import './Analytics.css'

export default function Analytics() {
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('patterns')

  const loadAnalytics = async () => {
    try {
      setError(null)
      const data = await analyticsApi.getSummary()
      setAnalytics(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const refreshPatterns = async () => {
    setRefreshing(true)
    try {
      await analyticsApi.refreshPatterns()
      await loadAnalytics()
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadAnalytics()
  }, [])

  if (loading) {
    return (
      <div className="analytics-page">
        <div className="analytics-loading">
          <RefreshCw className="spin" size={24} />
          <span>Loading analytics...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="analytics-page">
        <div className="analytics-error">
          <AlertTriangle size={24} />
          <span>Error: {error}</span>
          <button onClick={loadAnalytics}>Retry</button>
        </div>
      </div>
    )
  }

  const { patterns, totalTradesAnalyzed } = analytics || {}
  const winningPatterns = patterns?.winning || []
  const losingPatterns = patterns?.losing || []

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <div className="header-title">
          <BarChart2 size={24} />
          <h1>Trade Analytics</h1>
        </div>
        <div className="header-meta">
          <span className="trades-analyzed">
            <Activity size={14} />
            {totalTradesAnalyzed || 0} trades analyzed
          </span>
          <button
            className="refresh-btn"
            onClick={refreshPatterns}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? 'spin' : ''} size={16} />
            {refreshing ? 'Refreshing...' : 'Refresh Patterns'}
          </button>
        </div>
      </header>

      <nav className="analytics-tabs">
        <button
          className={`tab ${activeTab === 'patterns' ? 'active' : ''}`}
          onClick={() => setActiveTab('patterns')}
        >
          <Target size={16} />
          Discovered Patterns
        </button>
        <button
          className={`tab ${activeTab === 'time' ? 'active' : ''}`}
          onClick={() => setActiveTab('time')}
        >
          <Clock size={16} />
          Time Analysis
        </button>
        <button
          className={`tab ${activeTab === 'indicators' ? 'active' : ''}`}
          onClick={() => setActiveTab('indicators')}
        >
          <Zap size={16} />
          Indicator Analysis
        </button>
      </nav>

      <main className="analytics-content">
        {activeTab === 'patterns' && (
          <div className="patterns-tab">
            <div className="pattern-section">
              <div className="section-header">
                <Award className="icon positive" size={20} />
                <h3>High Value Patterns</h3>
                <span className="pattern-count">{winningPatterns.length} found</span>
              </div>
              <p className="section-description">
                These patterns have historically shown win rates above 60%. The bot automatically
                increases confidence when these conditions are detected.
              </p>
              <PatternCardList
                patterns={winningPatterns}
                type="winning"
                emptyMessage="No high-value patterns discovered yet. Need more trade history."
              />
            </div>

            <div className="pattern-section">
              <div className="section-header">
                <AlertTriangle className="icon negative" size={20} />
                <h3>Patterns to Avoid</h3>
                <span className="pattern-count">{losingPatterns.length} found</span>
              </div>
              <p className="section-description">
                These patterns have historically shown win rates below 45%. The bot automatically
                decreases confidence or skips trades when these conditions are detected.
              </p>
              <PatternCardList
                patterns={losingPatterns}
                type="losing"
                emptyMessage="No patterns to avoid discovered yet."
              />
            </div>

            {winningPatterns.length === 0 && losingPatterns.length === 0 && (
              <div className="no-patterns-message">
                <BarChart2 size={48} />
                <h3>Not Enough Data Yet</h3>
                <p>
                  Patterns are discovered after analyzing at least 10 trades with similar conditions.
                  Keep trading and check back later!
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'time' && (
          <div className="time-tab">
            <div className="charts-grid">
              <WinRateByHour data={analytics?.byHour} />
              <WinRateByDay data={analytics?.byDayOfWeek} />
              <WinRateBySession data={analytics?.bySession} />
            </div>

            <div className="time-insights">
              <h4>Time-Based Insights</h4>
              {analytics?.bySession?.length > 0 && (
                <ul className="insights-list">
                  {analytics.bySession
                    .filter(s => s.trades >= 10)
                    .sort((a, b) => b.winRate - a.winRate)
                    .slice(0, 3)
                    .map((s, i) => (
                      <li key={i} className={s.winRate >= 55 ? 'positive' : s.winRate < 45 ? 'negative' : ''}>
                        <TrendingUp size={14} />
                        <span>
                          <strong>{s.session}</strong> session has {s.winRate}% win rate
                          ({s.trades} trades, avg ${s.avgPnl?.toFixed(2)})
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {(!analytics?.bySession || analytics.bySession.length === 0) && (
                <p className="no-data">Not enough data for time-based insights yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'indicators' && (
          <div className="indicators-tab">
            <div className="charts-grid">
              <WinRateByRSI data={analytics?.byRSI} />
              <WinRateByTrend data={analytics?.byTrend} />
              <WinRateByPair data={analytics?.byPair} />
            </div>

            <div className="indicator-insights">
              <h4>Indicator-Based Insights</h4>
              {analytics?.byRSI?.length > 0 && (
                <ul className="insights-list">
                  {analytics.byRSI
                    .filter(r => r.trades >= 10)
                    .sort((a, b) => b.winRate - a.winRate)
                    .map((r, i) => (
                      <li key={i} className={r.winRate >= 55 ? 'positive' : r.winRate < 45 ? 'negative' : ''}>
                        <Zap size={14} />
                        <span>
                          <strong>{r.zone}</strong> has {r.winRate}% win rate
                          ({r.trades} trades, avg ${r.avgPnl?.toFixed(2)})
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {(!analytics?.byRSI || analytics.byRSI.length === 0) && (
                <p className="no-data">Not enough data for indicator insights yet.</p>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="analytics-footer">
        <p>
          Analytics are updated in real-time as trades are completed.
          Patterns require at least 10 similar trades to be considered statistically significant.
        </p>
      </footer>
    </div>
  )
}
