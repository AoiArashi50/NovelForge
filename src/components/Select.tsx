import { useState, useRef, useEffect } from "react"
import { ChevronDown } from "lucide-react"

interface SelectOption {
  value: string
  label: string
  icon?: React.ReactNode
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  className?: string
}

export default function Select({ value, options, onChange, placeholder = "请选择...", label, className = "" }: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div ref={ref} className={`relative ${className}`}>
      {label && (
        <label className="block font-mono text-xs uppercase tracking-wider text-white/70 mb-2">{label}</label>
      )}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all ${
          open
            ? "bg-white/[0.07] border-amber-500/40 text-[#FDFBF5]"
            : "bg-white/[0.03] border-white/10 text-white/70 hover:bg-white/[0.05] hover:border-white/20"
        }`}
      >
        <span className="flex items-center gap-2 truncate">
          {selected?.icon}
          <span className={selected ? "text-[#FDFBF5]" : "text-white/40"}>{selected?.label || placeholder}</span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-1.5 py-1 rounded-xl bg-[#1F2937] border border-white/10 shadow-2xl shadow-black/40 overflow-hidden">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                opt.value === value
                  ? "bg-amber-500/10 text-amber-400"
                  : "text-white/70 hover:bg-white/5 hover:text-[#FDFBF5]"
              }`}
            >
              {opt.icon}
              <span className="flex-1 text-left">{opt.label}</span>
              {opt.value === value && (
                <svg className="w-3.5 h-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
