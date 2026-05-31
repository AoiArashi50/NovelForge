import { useState } from "react"
import { BookOpen } from "lucide-react"

interface Book3DProps {
  coverColor?: string
  className?: string
}

export default function Book3D({ coverColor = "#F59E0B", className = "" }: Book3DProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      className={`book-scene ${className}`}
      style={{ perspective: "600px" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="book-pivot relative w-16 h-20"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
          transform: isHovered ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* 封面 */}
        <div
          className="absolute inset-0 rounded-lg flex items-center justify-center"
          style={{
            backfaceVisibility: "hidden",
            background: `linear-gradient(135deg, ${coverColor}22, ${coverColor}11)`,
            border: `1px solid ${coverColor}33`,
          }}
        >
          <BookOpen className="w-8 h-8" style={{ color: coverColor }} />
        </div>
        {/* 封底 */}
        <div
          className="absolute inset-0 rounded-lg flex items-center justify-center"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: `linear-gradient(135deg, ${coverColor}11, ${coverColor}05)`,
            border: `1px solid ${coverColor}22`,
          }}
        >
          <span className="font-mono text-xs" style={{ color: `${coverColor}66` }}>NF</span>
        </div>
      </div>
    </div>
  )
}
