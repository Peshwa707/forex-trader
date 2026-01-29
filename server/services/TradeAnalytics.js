/**
 * Trade Analytics Service
 * Part of Phase A: Trust Foundation - Trade History & Learning Database
 *
 * Analyzes historical trades to discover patterns and adjust prediction confidence
 */

import { getDb } from '../database.js'

/**
 * Get win rate statistics by hour of day
 */
export function getWinRateByHour() {
  const db = getDb()
  const results = db.exec(`
    SELECT
      hour_of_day as hour,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate,
      ROUND(AVG(pnl), 2) as avg_pnl
    FROM trades
    WHERE status = 'closed' AND hour_of_day IS NOT NULL
    GROUP BY hour_of_day
    ORDER BY hour_of_day
  `)

  if (!results.length) return []

  return results[0].values.map(row => ({
    hour: row[0],
    trades: row[1],
    wins: row[2],
    winRate: row[3],
    avgPnl: row[4]
  }))
}

/**
 * Get win rate statistics by day of week
 */
export function getWinRateByDayOfWeek() {
  const db = getDb()
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  const results = db.exec(`
    SELECT
      day_of_week,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate,
      ROUND(AVG(pnl), 2) as avg_pnl
    FROM trades
    WHERE status = 'closed' AND day_of_week IS NOT NULL
    GROUP BY day_of_week
    ORDER BY day_of_week
  `)

  if (!results.length) return []

  return results[0].values.map(row => ({
    dayOfWeek: row[0],
    dayName: dayNames[row[0]] || 'Unknown',
    trades: row[1],
    wins: row[2],
    winRate: row[3],
    avgPnl: row[4]
  }))
}

/**
 * Get win rate statistics by market session
 */
export function getWinRateBySession() {
  const db = getDb()
  const results = db.exec(`
    SELECT
      market_session as session,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate,
      ROUND(AVG(pnl), 2) as avg_pnl
    FROM trades
    WHERE status = 'closed' AND market_session IS NOT NULL
    GROUP BY market_session
    ORDER BY win_rate DESC
  `)

  if (!results.length) return []

  return results[0].values.map(row => ({
    session: row[0],
    trades: row[1],
    wins: row[2],
    winRate: row[3],
    avgPnl: row[4]
  }))
}

/**
 * Get win rate statistics by RSI zones
 */
export function getWinRateByRSI() {
  const db = getDb()
  const results = db.exec(`
    SELECT
      CASE
        WHEN rsi_at_entry < 30 THEN 'Oversold (<30)'
        WHEN rsi_at_entry > 70 THEN 'Overbought (>70)'
        ELSE 'Neutral (30-70)'
      END as rsi_zone,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate,
      ROUND(AVG(pnl), 2) as avg_pnl
    FROM trades
    WHERE status = 'closed' AND rsi_at_entry IS NOT NULL
    GROUP BY rsi_zone
    ORDER BY win_rate DESC
  `)

  if (!results.length) return []

  return results[0].values.map(row => ({
    zone: row[0],
    trades: row[1],
    wins: row[2],
    winRate: row[3],
    avgPnl: row[4]
  }))
}

/**
 * Get win rate statistics by currency pair
 */
export function getWinRateByPair() {
  const db = getDb()
  const results = db.exec(`
    SELECT
      pair,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate,
      ROUND(AVG(pnl), 2) as avg_pnl
    FROM trades
    WHERE status = 'closed'
    GROUP BY pair
    ORDER BY trades DESC
  `)

  if (!results.length) return []

  return results[0].values.map(row => ({
    pair: row[0],
    trades: row[1],
    wins: row[2],
    winRate: row[3],
    avgPnl: row[4]
  }))
}

/**
 * Get win rate by trend direction at entry
 */
export function getWinRateByTrend() {
  const db = getDb()
  const results = db.exec(`
    SELECT
      trend_at_entry as trend,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      ROUND(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as win_rate,
      ROUND(AVG(pnl), 2) as avg_pnl
    FROM trades
    WHERE status = 'closed' AND trend_at_entry IS NOT NULL
    GROUP BY trend_at_entry
    ORDER BY win_rate DESC
  `)

  if (!results.length) return []

  return results[0].values.map(row => ({
    trend: row[0],
    trades: row[1],
    wins: row[2],
    winRate: row[3],
    avgPnl: row[4]
  }))
}

/**
 * Discover high-value patterns (win rate > 60% with significant sample)
 */
export function discoverWinningPatterns(minTrades = 10) {
  const patterns = []

  // Check RSI patterns
  const rsiStats = getWinRateByRSI()
  for (const stat of rsiStats) {
    if (stat.trades >= minTrades && stat.winRate >= 60) {
      patterns.push({
        type: 'HIGH_VALUE',
        name: `RSI ${stat.zone}`,
        description: `Trades entered when RSI is ${stat.zone.toLowerCase()}`,
        winRate: stat.winRate,
        trades: stat.trades,
        avgPnl: stat.avgPnl,
        confidenceAdjustment: Math.round((stat.winRate - 50) / 5) // +1% per 5% above 50%
      })
    }
  }

  // Check session patterns
  const sessionStats = getWinRateBySession()
  for (const stat of sessionStats) {
    if (stat.trades >= minTrades && stat.winRate >= 60) {
      patterns.push({
        type: 'HIGH_VALUE',
        name: `${stat.session} Session`,
        description: `Trades entered during ${stat.session} market session`,
        winRate: stat.winRate,
        trades: stat.trades,
        avgPnl: stat.avgPnl,
        confidenceAdjustment: Math.round((stat.winRate - 50) / 5)
      })
    }
  }

  // Check hour patterns
  const hourStats = getWinRateByHour()
  for (const stat of hourStats) {
    if (stat.trades >= minTrades && stat.winRate >= 65) {
      const hourStr = stat.hour < 12 ? `${stat.hour}am` : `${stat.hour - 12 || 12}pm`
      patterns.push({
        type: 'HIGH_VALUE',
        name: `${hourStr} UTC`,
        description: `Trades entered at ${hourStr} UTC`,
        winRate: stat.winRate,
        trades: stat.trades,
        avgPnl: stat.avgPnl,
        confidenceAdjustment: Math.round((stat.winRate - 50) / 5)
      })
    }
  }

  // Check trend alignment
  const trendStats = getWinRateByTrend()
  for (const stat of trendStats) {
    if (stat.trades >= minTrades && stat.winRate >= 60) {
      patterns.push({
        type: 'HIGH_VALUE',
        name: `${stat.trend} Trend`,
        description: `Trades aligned with ${stat.trend.toLowerCase()} trend`,
        winRate: stat.winRate,
        trades: stat.trades,
        avgPnl: stat.avgPnl,
        confidenceAdjustment: Math.round((stat.winRate - 50) / 5)
      })
    }
  }

  return patterns.sort((a, b) => b.winRate - a.winRate)
}

/**
 * Discover patterns to avoid (win rate < 45% with significant sample)
 */
export function discoverLosingPatterns(minTrades = 10) {
  const patterns = []

  // Check RSI patterns
  const rsiStats = getWinRateByRSI()
  for (const stat of rsiStats) {
    if (stat.trades >= minTrades && stat.winRate < 45) {
      patterns.push({
        type: 'AVOID',
        name: `RSI ${stat.zone}`,
        description: `Trades entered when RSI is ${stat.zone.toLowerCase()}`,
        winRate: stat.winRate,
        trades: stat.trades,
        avgPnl: stat.avgPnl,
        confidenceAdjustment: -Math.round((50 - stat.winRate) / 5) // -1% per 5% below 50%
      })
    }
  }

  // Check session patterns
  const sessionStats = getWinRateBySession()
  for (const stat of sessionStats) {
    if (stat.trades >= minTrades && stat.winRate < 45) {
      patterns.push({
        type: 'AVOID',
        name: `${stat.session} Session`,
        description: `Trades entered during ${stat.session} market session`,
        winRate: stat.winRate,
        trades: stat.trades,
        avgPnl: stat.avgPnl,
        confidenceAdjustment: -Math.round((50 - stat.winRate) / 5)
      })
    }
  }

  // Check day of week patterns (like Friday afternoon)
  const dayStats = getWinRateByDayOfWeek()
  for (const stat of dayStats) {
    if (stat.trades >= minTrades && stat.winRate < 45) {
      patterns.push({
        type: 'AVOID',
        name: `${stat.dayName}`,
        description: `Trades entered on ${stat.dayName}`,
        winRate: stat.winRate,
        trades: stat.trades,
        avgPnl: stat.avgPnl,
        confidenceAdjustment: -Math.round((50 - stat.winRate) / 5)
      })
    }
  }

  // Check hour patterns
  const hourStats = getWinRateByHour()
  for (const stat of hourStats) {
    if (stat.trades >= minTrades && stat.winRate < 40) {
      const hourStr = stat.hour < 12 ? `${stat.hour}am` : `${stat.hour - 12 || 12}pm`
      patterns.push({
        type: 'AVOID',
        name: `${hourStr} UTC`,
        description: `Trades entered at ${hourStr} UTC`,
        winRate: stat.winRate,
        trades: stat.trades,
        avgPnl: stat.avgPnl,
        confidenceAdjustment: -Math.round((50 - stat.winRate) / 5)
      })
    }
  }

  return patterns.sort((a, b) => a.winRate - b.winRate)
}

/**
 * Get all discovered patterns
 */
export function getAllPatterns(minTrades = 10) {
  return {
    winning: discoverWinningPatterns(minTrades),
    losing: discoverLosingPatterns(minTrades)
  }
}

/**
 * Calculate confidence adjustment based on current market conditions
 * Returns adjustment in percentage points (+/- value to add to base confidence)
 */
export function calculateConfidenceAdjustment(tradeContext) {
  const { rsi, marketSession, hourOfDay, trend } = tradeContext
  let adjustment = 0
  const reasons = []

  // Get historical patterns
  const patterns = getAllPatterns(10)

  // Check RSI zone
  const rsiZone = rsi < 30 ? 'Oversold (<30)' : rsi > 70 ? 'Overbought (>70)' : 'Neutral (30-70)'
  const rsiPattern = [...patterns.winning, ...patterns.losing].find(p =>
    p.name.includes('RSI') && p.name.includes(rsiZone.split(' ')[0])
  )
  if (rsiPattern) {
    adjustment += rsiPattern.confidenceAdjustment
    reasons.push({
      factor: `RSI ${rsiZone}`,
      adjustment: rsiPattern.confidenceAdjustment,
      historical: `${rsiPattern.winRate}% win rate over ${rsiPattern.trades} trades`
    })
  }

  // Check session
  if (marketSession) {
    const sessionPattern = [...patterns.winning, ...patterns.losing].find(p =>
      p.name.toLowerCase().includes(marketSession.toLowerCase())
    )
    if (sessionPattern) {
      adjustment += sessionPattern.confidenceAdjustment
      reasons.push({
        factor: `${marketSession} session`,
        adjustment: sessionPattern.confidenceAdjustment,
        historical: `${sessionPattern.winRate}% win rate over ${sessionPattern.trades} trades`
      })
    }
  }

  // Check trend alignment
  if (trend) {
    const trendPattern = [...patterns.winning, ...patterns.losing].find(p =>
      p.name.toLowerCase().includes(trend.toLowerCase())
    )
    if (trendPattern) {
      adjustment += trendPattern.confidenceAdjustment
      reasons.push({
        factor: `${trend} trend`,
        adjustment: trendPattern.confidenceAdjustment,
        historical: `${trendPattern.winRate}% win rate over ${trendPattern.trades} trades`
      })
    }
  }

  // Cap adjustment between -15% and +15%
  adjustment = Math.max(-15, Math.min(15, adjustment))

  return {
    adjustment,
    reasons,
    adjustedConfidence: null // To be calculated by caller with base confidence
  }
}

/**
 * Get comprehensive analytics summary
 */
export function getAnalyticsSummary() {
  const db = getDb()

  // Get total trade count
  const countResult = db.exec(`
    SELECT COUNT(*) as total FROM trades WHERE status = 'closed'
  `)
  const totalTrades = countResult.length ? countResult[0].values[0][0] : 0

  return {
    totalTradesAnalyzed: totalTrades,
    byHour: getWinRateByHour(),
    byDayOfWeek: getWinRateByDayOfWeek(),
    bySession: getWinRateBySession(),
    byRSI: getWinRateByRSI(),
    byPair: getWinRateByPair(),
    byTrend: getWinRateByTrend(),
    patterns: getAllPatterns(10)
  }
}

/**
 * Store a discovered pattern in the database
 */
export function savePattern(pattern) {
  const db = getDb()
  const now = new Date().toISOString()

  db.run(`
    INSERT INTO trade_patterns (pattern_name, pattern_type, win_rate, trade_count, avg_pnl, confidence_adjustment, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    pattern.name,
    pattern.type,
    pattern.winRate,
    pattern.trades,
    pattern.avgPnl,
    pattern.confidenceAdjustment,
    now,
    now
  ])
}

/**
 * Update stored patterns from current trade data
 */
export function refreshPatterns() {
  const db = getDb()
  const patterns = getAllPatterns(10)

  // Clear old patterns
  db.run('DELETE FROM trade_patterns')

  // Save winning patterns
  for (const pattern of patterns.winning) {
    savePattern(pattern)
  }

  // Save losing patterns
  for (const pattern of patterns.losing) {
    savePattern(pattern)
  }

  return patterns
}
