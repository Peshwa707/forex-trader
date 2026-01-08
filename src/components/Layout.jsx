import { Outlet, NavLink } from 'react-router-dom'
import { Home, TrendingUp, Bell, BookOpen, ClipboardList } from 'lucide-react'

export default function Layout() {
  return (
    <div className="app-layout">
      <main className="main-content">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
          <Home size={22} />
          <span>Home</span>
        </NavLink>
        <NavLink to="/prices" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <TrendingUp size={22} />
          <span>Prices</span>
        </NavLink>
        <NavLink to="/signals" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Bell size={22} />
          <span>Signals</span>
        </NavLink>
        <NavLink to="/journal" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <ClipboardList size={22} />
          <span>Journal</span>
        </NavLink>
        <NavLink to="/learn" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <BookOpen size={22} />
          <span>Learn</span>
        </NavLink>
      </nav>
    </div>
  )
}
