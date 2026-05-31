import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { useEffect } from 'react'
import Lenis from 'lenis'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

// 平滑滚动 Hook
function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    })

    function raf(time: number) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)

    return () => lenis.destroy()
  }, [])

  return <>{children}</>
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      <SmoothScrollProvider>
        <App />
      </SmoothScrollProvider>
    </TRPCProvider>
  </BrowserRouter>,
)
