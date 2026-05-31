import { useRef, useState, useCallback } from "react"
import { motion } from "framer-motion"

interface LiquidGlassCardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export default function LiquidGlassCard({ children, className = "", onClick }: LiquidGlassCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState({ x: 50, y: 50, velX: 0, velY: 0 })
  const lastMouseRef = useRef({ x: 0, y: 0, time: 0 })

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    const now = Date.now()
    const dt = now - lastMouseRef.current.time
    if (dt > 0) {
      const velX = (e.clientX - lastMouseRef.current.x) / dt * 10
      const velY = (e.clientY - lastMouseRef.current.y) / dt * 10
      setTransform({ x, y, velX, velY })
    }
    lastMouseRef.current = { x: e.clientX, y: e.clientY, time: now }
  }, [])

  const moveX = transform.x * 1.2
  const moveY = transform.y * 0.8
  const skewX = transform.velX * 0.1
  const skewY = transform.velY * 0.05
  const scale = 1 + Math.sqrt(transform.velX * transform.velX + transform.velY * transform.velY) * 0.002
  const rotate = Math.atan2(transform.velY, transform.velX) * (180 / Math.PI)

  return (
    <motion.div
      ref={cardRef}
      className={`relative overflow-hidden rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/10 cursor-pointer ${className}`}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      whileHover={{ y: -4, borderColor: "rgba(245, 158, 11, 0.3)" }}
      transition={{ duration: 0.3 }}
    >
      {/* 液态反光层 */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          maskImage: `radial-gradient(circle at ${transform.x}% ${transform.y}%, black 0%, transparent 60%)`,
          WebkitMaskImage: `radial-gradient(circle at ${transform.x}% ${transform.y}%, black 0%, transparent 60%)`,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.4) 45%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.4) 55%, transparent 60%)",
            transform: `translate(${moveX - 50}%, ${moveY - 50}%) skew(${skewX}deg, ${skewY}deg) scale(${scale}) rotate(${rotate}deg)`,
            transition: "transform 0.1s ease-out",
          }}
        />
      </div>

      {/* 内容 */}
      <div className="relative z-20">
        {children}
      </div>
    </motion.div>
  )
}
