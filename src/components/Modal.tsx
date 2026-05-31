import { X } from "lucide-react"

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  icon?: React.ReactNode
  children: React.ReactNode
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl"
  footer?: React.ReactNode
}

const WIDTH_MAP = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
}

export default function Modal({ open, onClose, title, icon, children, maxWidth = "md", footer }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`w-full ${WIDTH_MAP[maxWidth]} mx-4 rounded-2xl bg-[#1F2937] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]`}
        onClick={e => e.stopPropagation()}
      >
        {(title || icon) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2.5">
              {icon && <span className="text-amber-500">{icon}</span>}
              {title && <h3 className="font-serif text-lg font-semibold">{title}</h3>}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/80 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 border-t border-white/10 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
