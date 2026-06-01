import { createContext, useContext, useState, useCallback, useRef } from "react"

export type ToastType = "success" | "error" | "warning" | "info"

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
}

interface ToastContextValue {
  toasts: ToastItem[]
  addToast: (message: string, type: ToastType, duration?: number) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((message: string, type: ToastType, duration = 3500) => {
    const id = `toast_${++idRef.current}_${Date.now()}`
    const item: ToastItem = { id, message, type, duration }
    setToasts(prev => {
      const next = [...prev, item]
      // 最多保留 5 个，超出时移除最早的
      return next.length > 5 ? next.slice(next.length - 5) : next
    })
    // 自动消失
    setTimeout(() => {
      removeToast(id)
    }, duration)
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider")
  }

  return {
    success: (message: string, duration?: number) => ctx.addToast(message, "success", duration),
    error: (message: string, duration?: number) => ctx.addToast(message, "error", duration),
    warning: (message: string, duration?: number) => ctx.addToast(message, "warning", duration),
    info: (message: string, duration?: number) => ctx.addToast(message, "info", duration),
  }
}

// Toast 图标映射
const ICONS: Record<ToastType, React.ReactNode> = {
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
}

const STYLES: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: "bg-green-500/10", border: "border-l-green-500", text: "text-green-400" },
  error: { bg: "bg-red-500/10", border: "border-l-red-500", text: "text-red-400" },
  warning: { bg: "bg-amber-500/10", border: "border-l-amber-500", text: "text-amber-400" },
  info: { bg: "bg-blue-500/10", border: "border-l-blue-500", text: "text-blue-400" },
}

function ToastContainer({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[320px]">
      {toasts.map(toast => {
        const style = STYLES[toast.type]
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 px-4 py-3 rounded-lg ${style.bg} border-l-2 ${style.border} shadow-lg backdrop-blur-sm animate-toast-in`}
          >
            <span className={`shrink-0 mt-0.5 ${style.text}`}>{ICONS[toast.type]}</span>
            <span className="text-sm text-white/80 flex-1 break-words">{toast.message}</span>
            <button
              onClick={() => onRemove(toast.id)}
              className="shrink-0 p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
              aria-label="关闭"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
