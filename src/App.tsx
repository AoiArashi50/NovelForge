import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Studio from './pages/Studio'
import Reader from './pages/Reader'
import LoreLibrary from './pages/LoreLibrary'
import NovelManager from './pages/NovelManager'
import MaterialPool from './pages/MaterialPool'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/studio/:workId?" element={<Studio />} />
      <Route path="/reader/:novelId" element={<Reader />} />
      <Route path="/lore" element={<LoreLibrary />} />
      <Route path="/library" element={<NovelManager />} />
      <Route path="/materials" element={<MaterialPool />} />
    </Routes>
  )
}
