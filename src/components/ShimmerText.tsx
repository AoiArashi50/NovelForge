interface ShimmerTextProps {
  children: React.ReactNode
  className?: string
  as?: "h1" | "h2" | "h3" | "span" | "p"
}

export default function ShimmerText({ children, className = "", as: Tag = "span" }: ShimmerTextProps) {
  return (
    <Tag
      className={`inline-block bg-gradient-to-r from-transparent via-[#FDFBF5]/80 to-transparent bg-[length:80%] bg-no-repeat text-transparent bg-clip-text animate-shimmerSweep ${className}`}
      style={{
        WebkitBackgroundClip: "text",
        backgroundColor: "rgba(253, 251, 245, 0.2)",
      }}
    >
      {children}
    </Tag>
  )
}
