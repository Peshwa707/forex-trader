import { useState } from 'react'
import { BookOpen, TrendingUp, Shield, Clock, ChevronDown, ChevronUp, Target, Zap, BarChart3 } from 'lucide-react'
import './Learn.css'

const educationContent = {
  basics: [
    {
      title: 'What is Forex Trading?',
      icon: BookOpen,
      content: `Forex (Foreign Exchange) is the global marketplace for trading national currencies. It's the largest financial market in the world with a daily trading volume exceeding $6 trillion.

Key Points:
• Currencies are traded in pairs (e.g., EUR/USD)
• The first currency is the "base," the second is the "quote"
• Profit comes from changes in exchange rates
• Market operates 24/5 across global time zones`
    },
    {
      title: 'Understanding Pips',
      icon: Target,
      content: `A pip (Percentage in Point) is the smallest price move in forex trading.

For most pairs: 1 pip = 0.0001
For JPY pairs: 1 pip = 0.01

Example:
If EUR/USD moves from 1.0850 to 1.0851, that's a 1 pip movement.

Pip Value Calculation:
For a standard lot (100,000 units):
• 1 pip ≈ $10 for USD pairs
• Varies for cross pairs`
    },
    {
      title: 'Lot Sizes Explained',
      icon: BarChart3,
      content: `Lot sizes determine your position size in forex:

Standard Lot: 100,000 units
• 1 pip = ~$10

Mini Lot: 10,000 units
• 1 pip = ~$1

Micro Lot: 1,000 units
• 1 pip = ~$0.10

Nano Lot: 100 units
• 1 pip = ~$0.01

Start with smaller lots while learning!`
    },
    {
      title: 'Leverage & Margin',
      icon: Zap,
      content: `Leverage allows you to control large positions with small capital.

Common Leverage Ratios:
• 1:30 (Retail EU/UK)
• 1:50 (US)
• 1:100 to 1:500 (Other regions)

Example with 1:100 leverage:
$1,000 controls $100,000 position

⚠️ WARNING: Leverage amplifies both profits AND losses. Use with caution!

Margin = Position Size ÷ Leverage`
    }
  ],
  strategies: [
    {
      title: 'Trend Following',
      icon: TrendingUp,
      content: `Follow the market's direction for consistent profits.

How to Identify Trends:
• Higher highs & higher lows = Uptrend
• Lower highs & lower lows = Downtrend
• Use moving averages (50, 200 EMA)

Entry Rules:
• Buy on pullbacks in uptrend
• Sell on rallies in downtrend
• Confirm with volume

"The trend is your friend until it bends."`
    },
    {
      title: 'Support & Resistance',
      icon: Shield,
      content: `Price levels where buying/selling pressure changes.

Support: Price floor where buyers step in
Resistance: Price ceiling where sellers appear

Trading Rules:
• Buy near support, sell near resistance
• Watch for breakouts with volume
• Previous resistance becomes support (and vice versa)

Drawing Levels:
• Connect swing highs/lows
• Focus on areas with multiple touches
• Round numbers often act as S/R`
    },
    {
      title: 'Breakout Trading',
      icon: Zap,
      content: `Trade when price breaks key levels.

Types of Breakouts:
• Range breakouts
• Triangle breakouts
• Trend line breakouts

Entry Checklist:
✓ Clear consolidation pattern
✓ Volume increase on break
✓ Retest of broken level (optional)
✓ Time of day (avoid low volume)

Stop Loss: Below/above the breakout level
Take Profit: Measure the range and project`
    },
    {
      title: 'Risk Management',
      icon: Shield,
      content: `The most important aspect of trading!

Golden Rules:
• Never risk more than 1-2% per trade
• Always use stop losses
• Maintain minimum 1:2 risk-reward ratio
• Don't overtrade

Position Size Formula:
Risk Amount = Account × Risk %
Position Size = Risk Amount ÷ Stop Loss (in pips)

Example:
$10,000 account, 1% risk, 50 pip SL
Position = $100 ÷ 50 = $2/pip ≈ 0.2 lots`
    }
  ],
  sessions: [
    {
      title: 'Trading Sessions',
      icon: Clock,
      content: `Forex operates 24 hours across four major sessions:

Sydney (22:00-07:00 UTC)
• Low volatility, good for AUD/NZD pairs

Tokyo (00:00-09:00 UTC)
• Medium volatility
• Best for JPY pairs

London (08:00-17:00 UTC)
• Highest volume session
• Best for EUR, GBP pairs

New York (13:00-22:00 UTC)
• High volatility
• USD pairs most active

Best Times: London-NY overlap (13:00-17:00 UTC)`
    },
    {
      title: 'Economic Calendar',
      icon: BookOpen,
      content: `High-impact events that move markets:

Major Events:
• Interest Rate Decisions (Central Banks)
• Non-Farm Payrolls (NFP) - First Friday monthly
• GDP Reports
• Inflation Data (CPI)
• Employment Data

Trading Tips:
• Avoid trading 30min before/after major news
• Be aware of scheduled events
• Volatility spikes create opportunities
• Use tight stops during news

Check economic calendar daily!`
    }
  ]
}

export default function Learn() {
  const [activeSection, setActiveSection] = useState('basics')
  const [expandedCards, setExpandedCards] = useState({})

  const toggleCard = (index) => {
    setExpandedCards(prev => ({
      ...prev,
      [index]: !prev[index]
    }))
  }

  const sections = [
    { id: 'basics', label: 'Basics', icon: BookOpen },
    { id: 'strategies', label: 'Strategies', icon: Target },
    { id: 'sessions', label: 'Sessions', icon: Clock }
  ]

  const currentContent = educationContent[activeSection]

  return (
    <div className="page learn-page">
      <header className="page-header">
        <h1>Learn Forex</h1>
        <p>Master the fundamentals and strategies</p>
      </header>

      <div className="section-tabs">
        {sections.map(section => (
          <button
            key={section.id}
            className={`section-tab ${activeSection === section.id ? 'active' : ''}`}
            onClick={() => setActiveSection(section.id)}
          >
            <section.icon size={18} />
            {section.label}
          </button>
        ))}
      </div>

      <div className="education-list">
        {currentContent.map((item, index) => {
          const Icon = item.icon
          const isExpanded = expandedCards[`${activeSection}-${index}`]

          return (
            <div key={index} className="education-card card">
              <button
                className="card-header"
                onClick={() => toggleCard(`${activeSection}-${index}`)}
              >
                <div className="card-title">
                  <div className="card-icon">
                    <Icon size={20} />
                  </div>
                  <h3>{item.title}</h3>
                </div>
                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>

              {isExpanded && (
                <div className="card-content">
                  <pre>{item.content}</pre>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <section className="tips-section card">
        <h3>Quick Tips</h3>
        <ul className="tips-list">
          <li>Start with a demo account to practice</li>
          <li>Never trade with money you can't afford to lose</li>
          <li>Keep a trading journal to track your progress</li>
          <li>Be patient - consistent small wins beat big losses</li>
          <li>Emotions are your enemy - stick to your plan</li>
        </ul>
      </section>
    </div>
  )
}
