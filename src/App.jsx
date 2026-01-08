import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Prices from './pages/Prices'
import Signals from './pages/Signals'
import Journal from './pages/Journal'
import Learn from './pages/Learn'
import Analysis from './pages/Analysis'
import './index.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="prices" element={<Prices />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="signals" element={<Signals />} />
          <Route path="journal" element={<Journal />} />
          <Route path="learn" element={<Learn />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
