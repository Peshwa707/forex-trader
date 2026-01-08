import { Outlet, NavLink } from 'react-router-dom'
import { Home, TrendingUp, Brain, Bot, ClipboardList } from 'lucide-react'

export default function Layout() {
  return (
    <div className="app-layout">
      <main className="main-content">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
          <Home size={20} />
          <span>Home</span>
        </NavLink>
        <NavLink to="/prices" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <TrendingUp size={20} />
          <span>Prices</span>
        </NavLink>
        <NavLink to="/analysis" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Brain size={20} />
          <span>AI</span>
        </NavLink>
        <NavLink to="/bot" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Bot size={20} />
          <span>Bot</span>
        </NavLink>
        <NavLink to="/journal" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <ClipboardList size={20} />
          <span>Journal</span>
        </NavLink>
      </nav>
    </div>
  )
}
