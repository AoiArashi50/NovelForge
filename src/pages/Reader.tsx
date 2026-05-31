import { useParams, useNavigate } from "react-router"
import { trpc } from "@/providers/trpc"
import { useState, useEffect } from "react"
import type React from "react"
import NavBar from "@/components/NavBar"
import {
  ChevronLeft, ChevronRight, List, Languages, Type, ArrowLeft,
  Play, Download, Bookmark, BookmarkPlus, X, Loader2, Settings, Save,
  Highlighter, PenLine
} from "lucide-react"

export default function Reader() {
  const { novelId } = useParams<{ novelId: string }>()
  const navigate = useNavigate()
  const id = parseInt(novelId || "0")
  const [currentChapterId, setCurrentChapterId] = useState<number | null>(null)
  const [bilingualMode, setBilingualMode] = useState<"original" | "translated" | "bilingual">("translated")
  const [showSidebar, setShowSidebar] = useState(false)
  const [fontSize, setFontSize] = useState(18)
  const [theme, setTheme] = useState<"light" | "sepia" | "dark" | "oled">("dark")
  const [fontFamily, setFontFamily] = useState<"serif" | "sans" | "mono">("serif")
  const [lineHeight, setLineHeight] = useState(1.8)
  const [paragraphSpacing, setParagraphSpacing] = useState(1.5)
  const [marginSize, setMarginSize] = useState(24)
  const [layoutMode, setLayoutMode] = useState<"continuous" | "paginated">("continuous")
  const [showSettings, setShowSettings] = useState(false)
  const [jumpInput, setJumpInput] = useState("")
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [editingChapter, setEditingChapter] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [bookmarkNote, setBookmarkNote] = useState("")
  const [showBookmarkForm, setShowBookmarkForm] = useState(false)

  // Annotations / Highlights
  const [showAnnotations, setShowAnnotations] = useState(false)
  const [selectedText, setSelectedText] = useState("")
  const [selectedParagraphIndex, setSelectedParagraphIndex] = useState<number | null>(null)
  const [annotationNote, setAnnotationNote] = useState("")
  const [annotationColor, setAnnotationColor] = useState("yellow")
  const [showAnnotationForm, setShowAnnotationForm] = useState(false)

  const { data: chapterList } = trpc.chapter.list.useQuery({ novelId: id })
  const { data: currentChapter } = trpc.chapter.getById.useQuery(
    { id: currentChapterId || 0 },
    { enabled: !!currentChapterId }
  )
  const { data: novel } = trpc.novel.getById.useQuery({ id })
  const { data: bookmarks } = trpc.chapter.bookmark.list.useQuery({ novelId: id })
  const utils = trpc.useUtils()

  const updateChapterMutation = trpc.chapter.update.useMutation({
    onSuccess: () => {
      utils.chapter.getById.invalidate({ id: currentChapterId || 0 })
      setEditingChapter(false)
    },
  })
  const createBookmarkMutation = trpc.chapter.bookmark.create.useMutation({
    onSuccess: () => utils.chapter.bookmark.list.invalidate({ novelId: id }),
  })
  const deleteBookmarkMutation = trpc.chapter.bookmark.delete.useMutation({
    onSuccess: () => utils.chapter.bookmark.list.invalidate({ novelId: id }),
  })
  const translateMutation = trpc.translate.start.useMutation({
    onSuccess: () => {
      utils.chapter.list.invalidate({ novelId: id })
      utils.novel.getById.invalidate({ id })
    },
  })
  const trpcUtils = trpc.useUtils()

  // Annotations
  const { data: annotationList } = trpc.annotation.list.useQuery(
    { chapterId: currentChapterId || 0 },
    { enabled: !!currentChapterId }
  )
  const createAnnotationMutation = trpc.annotation.create.useMutation({
    onSuccess: () => {
      utils.annotation.list.invalidate({ chapterId: currentChapterId || 0 })
      setShowAnnotationForm(false)
      setSelectedText("")
      setSelectedParagraphIndex(null)
      setAnnotationNote("")
    },
  })
  const deleteAnnotationMutation = trpc.annotation.delete.useMutation({
    onSuccess: () => utils.annotation.list.invalidate({ chapterId: currentChapterId || 0 }),
  })

  useEffect(() => {
    if (chapterList && chapterList.length > 0 && !currentChapterId) {
      setCurrentChapterId(chapterList[0].id)
    }
  }, [chapterList, currentChapterId])

  // 自动切换阅读模式：无翻译时默认显示原文
  useEffect(() => {
    if (chapterList && chapterList.length > 0 && !chapterList.some(ch => ch.contentTranslated)) {
      setBilingualMode("original")
    }
  }, [chapterList])

  useEffect(() => {
    if (currentChapter?.contentTranslated) {
      setEditContent(currentChapter.contentTranslated)
    }
  }, [currentChapter?.contentTranslated])

  const currentIndex = chapterList?.findIndex(ch => ch.id === currentChapterId) ?? -1
  const totalChapters = chapterList?.length ?? 0
  const progressPercent = totalChapters > 0 ? ((currentIndex + 1) / totalChapters) * 100 : 0

  const cycleBilingualMode = () => {
    setBilingualMode(prev =>
      prev === "original" ? "translated" : prev === "translated" ? "bilingual" : "original"
    )
  }

  const handleJump = () => {
    const num = parseInt(jumpInput, 10)
    if (chapterList && num >= 1 && num <= chapterList.length) {
      setCurrentChapterId(chapterList[num - 1].id)
      setJumpInput("")
    }
  }

  const handleExport = async () => {
    const result = await trpcUtils.translate.export.fetch({ novelId: id, format: "pure" })
    const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${novel?.title || "novel"}_纯中文.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveEdit = () => {
    if (!currentChapterId) return
    updateChapterMutation.mutate({ id: currentChapterId, contentTranslated: editContent })
  }

  // Text selection handler for annotations
  const handleTextSelection = (paragraphIndex: number) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setShowAnnotationForm(false)
      return
    }
    const text = selection.toString().trim()
    if (text.length < 1) {
      setShowAnnotationForm(false)
      return
    }
    setSelectedText(text)
    setSelectedParagraphIndex(paragraphIndex)
    setShowAnnotationForm(true)
  }

  const handleCreateAnnotation = () => {
    if (!currentChapterId || selectedParagraphIndex === null || !selectedText) return
    createAnnotationMutation.mutate({
      novelId: id,
      chapterId: currentChapterId,
      paragraphIndex: selectedParagraphIndex,
      startOffset: 0,
      endOffset: selectedText.length,
      selectedText,
      note: annotationNote.trim() || undefined,
      color: annotationColor as "yellow" | "green" | "blue" | "pink" | "purple",
    })
  }

  const handleAddBookmark = () => {
    if (!currentChapterId) return
    createBookmarkMutation.mutate({
      novelId: id,
      chapterId: currentChapterId,
      note: bookmarkNote.trim() || undefined,
    })
    setBookmarkNote("")
    setShowBookmarkForm(false)
  }

  const isBookmarked = bookmarks?.some(bm => bm.chapterId === currentChapterId)

  const themeConfig = {
    light: {
      bg: "bg-white",
      text: "text-gray-900",
      subText: "text-gray-500",
      border: "border-gray-200",
      cardBg: "bg-gray-50",
      hoverBg: "hover:bg-gray-100",
      activeBg: "bg-amber-100 text-amber-700",
      divider: "border-gray-200",
      label: "text-amber-600/80",
      inputBg: "bg-gray-50",
      stickyBg: "bg-white/90",
    },
    sepia: {
      bg: "bg-[#F5E6C8]",
      text: "text-[#433422]",
      subText: "text-[#8B7355]",
      border: "border-[#D4C4A8]",
      cardBg: "bg-[#EDE0C0]",
      hoverBg: "hover:bg-[#E5D5B0]",
      activeBg: "bg-amber-200/50 text-amber-800",
      divider: "border-[#D4C4A8]",
      label: "text-amber-700/80",
      inputBg: "bg-[#FAF0D8]",
      stickyBg: "bg-[#F5E6C8]/90",
    },
    dark: {
      bg: "bg-[#111827]",
      text: "text-[#FDFBF5]",
      subText: "text-white/60",
      border: "border-white/10",
      cardBg: "bg-[#1F2937]",
      hoverBg: "hover:bg-white/10",
      activeBg: "bg-amber-500/20 text-amber-400",
      divider: "border-white/10",
      label: "text-amber-500/60",
      inputBg: "bg-white/5",
      stickyBg: "bg-[#111827]/90",
    },
    oled: {
      bg: "bg-black",
      text: "text-white",
      subText: "text-white/50",
      border: "border-white/10",
      cardBg: "bg-[#0A0A0A]",
      hoverBg: "hover:bg-white/10",
      activeBg: "bg-amber-500/20 text-amber-400",
      divider: "border-white/10",
      label: "text-amber-500/60",
      inputBg: "bg-white/5",
      stickyBg: "bg-black/90",
    },
  } as const

  const t = themeConfig[theme]
  const bgColor = t.bg
  const textColor = t.text
  const subTextColor = t.subText
  const borderColor = t.border
  const cardBg = t.cardBg
  const hoverBg = t.hoverBg
  const activeBg = t.activeBg
  const dividerColor = t.divider
  const labelColor = t.label
  const isLightTheme = theme === "light" || theme === "sepia"
  const inactiveText = isLightTheme ? "text-black/40 hover:bg-black/10" : "text-white/40 hover:bg-white/10"
  const inactiveBg = isLightTheme ? "bg-black/5" : "bg-white/5"
  const chapterText = isLightTheme ? "text-black/70 hover:bg-black/5" : "text-white/70 hover:bg-white/5"

  const hasTranslation = chapterList?.some(ch => ch.contentTranslated)

  return (
    <div className={`min-h-screen ${bgColor} ${textColor} transition-colors duration-300`}>
      <NavBar />

      <header className={`sticky top-14 z-40 ${t.stickyBg} backdrop-blur-md border-b ${borderColor}`}>
        <div className="max-w-[800px] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/library")} className={`p-2 ${hoverBg} rounded-lg transition-colors`} title="返回小说库">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button onClick={() => setShowSidebar(!showSidebar)} className={`p-2 ${hoverBg} rounded-lg transition-colors`}>
              <List className="w-5 h-5" />
            </button>
            <button onClick={() => setShowBookmarks(!showBookmarks)} className={`p-2 ${hoverBg} rounded-lg transition-colors ${showBookmarks ? "text-amber-400" : ""}`} title="书签">
              <Bookmark className="w-5 h-5" />
            </button>
            <button onClick={() => setShowAnnotations(!showAnnotations)} className={`p-2 ${hoverBg} rounded-lg transition-colors ${showAnnotations ? "text-amber-400" : ""}`} title="批注">
              <Highlighter className="w-5 h-5" />
            </button>
          </div>
          <span className={`font-mono text-sm ${subTextColor} truncate max-w-[200px]`}>
            {currentChapter?.title || "选择章节"}
          </span>
          <div className="flex gap-2">
            <button onClick={cycleBilingualMode} className={`p-2 ${hoverBg} rounded-lg transition-colors`} title="切换双语">
              <Languages className="w-5 h-5" />
            </button>
            <button onClick={() => setFontSize(s => Math.min(s + 2, 28))} className={`p-2 ${hoverBg} rounded-lg transition-colors`} title="增大字体">
              <Type className="w-5 h-5" />
            </button>
            <button onClick={() => setFontSize(s => Math.max(s - 2, 12))} className={`p-2 ${hoverBg} rounded-lg transition-colors hidden sm:block`} title="减小字体">
              <Type className="w-4 h-4" />
            </button>
            <button onClick={() => setShowSettings(!showSettings)} className={`p-2 ${hoverBg} rounded-lg transition-colors`} title="阅读设置">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className={`h-0.5 ${isLightTheme ? "bg-black/5" : "bg-white/5"}`}>
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className={`max-w-[800px] mx-auto px-4 pb-1 flex justify-between text-xs font-mono ${subTextColor}`}>
          <span>第 {currentIndex + 1} / {totalChapters} 章</span>
          <span>{progressPercent.toFixed(0)}%</span>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className={`max-w-[800px] mx-auto px-6 pt-4`}>
          <div className={`p-5 rounded-xl ${cardBg} border ${borderColor} space-y-5`}>
            <div className="flex items-center justify-between">
              <h3 className={`font-mono text-xs uppercase tracking-wider ${subTextColor}`}>阅读设置</h3>
              <button onClick={() => setShowSettings(false)} className={`p-1 rounded ${hoverBg}`}><X className="w-4 h-4" /></button>
            </div>

            {/* Theme */}
            <div>
              <label className={`block font-mono text-xs ${subTextColor} mb-2`}>主题</label>
              <div className="flex gap-2">
                {[
                  { key: "light" as const, label: "明亮", bg: "bg-white", text: "text-gray-900", border: "border-gray-300" },
                  { key: "sepia" as const, label: " sepia", bg: "bg-[#F5E6C8]", text: "text-[#433422]", border: "border-[#D4C4A8]" },
                  { key: "dark" as const, label: "暗色", bg: "bg-[#111827]", text: "text-[#FDFBF5]", border: "border-white/20" },
                  { key: "oled" as const, label: "OLED", bg: "bg-black", text: "text-white", border: "border-white/20" },
                ].map(({ key, label, bg, text, border }) => (
                  <button
                    key={key}
                    onClick={() => setTheme(key)}
                    className={`flex-1 py-2 rounded-xl text-sm border-2 transition-all ${bg} ${text} ${theme === key ? border + " ring-2 ring-amber-500/40" : "border-transparent opacity-60 hover:opacity-100"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Family */}
            <div>
              <label className={`block font-mono text-xs ${subTextColor} mb-2`}>字体</label>
              <div className="flex gap-2">
                {[
                  { key: "serif" as const, label: "衬线体", className: "font-serif" },
                  { key: "sans" as const, label: "无衬线", className: "font-sans" },
                  { key: "mono" as const, label: "等宽", className: "font-mono" },
                ].map(({ key, label, className }) => (
                  <button
                    key={key}
                    onClick={() => setFontFamily(key)}
                    className={`flex-1 py-2 rounded-xl text-sm border transition-colors ${className} ${fontFamily === key ? "bg-amber-500/20 border-amber-500/30 text-amber-400" : "bg-white/5 border-transparent hover:bg-white/10 text-white/60"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Layout Mode */}
            <div>
              <label className={`block font-mono text-xs ${subTextColor} mb-2`}>布局</label>
              <div className="flex gap-2">
                {[
                  { key: "continuous" as const, label: "连续滚动" },
                  { key: "paginated" as const, label: "分页" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setLayoutMode(key)}
                    className={`flex-1 py-2 rounded-xl text-sm border transition-colors ${layoutMode === key ? "bg-amber-500/20 border-amber-500/30 text-amber-400" : "bg-white/5 border-transparent hover:bg-white/10 text-white/60"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders */}
            <div className="space-y-4">
              <ReaderSlider label="字体大小" value={fontSize} min={12} max={28} step={1} unit="px" onChange={setFontSize} />
              <ReaderSlider label="行间距" value={lineHeight} min={1.2} max={2.5} step={0.1} unit="" onChange={setLineHeight} />
              <ReaderSlider label="段落间距" value={paragraphSpacing} min={0.5} max={3} step={0.25} unit="rem" onChange={setParagraphSpacing} />
              <ReaderSlider label="边距" value={marginSize} min={8} max={48} step={4} unit="px" onChange={setMarginSize} />
            </div>
          </div>
        </div>
      )}

      {/* Translation banner */}
      {!hasTranslation && novel?.status !== "translated" && (
        <div className={`max-w-[800px] mx-auto px-6 pt-4`}>
          <div className={`p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between`}>
            <div className="flex items-center gap-3">
              <Play className="w-5 h-5 text-amber-500" />
              <span className="text-sm text-amber-400">该小说尚未翻译，点击开始 AI 翻译</span>
            </div>
            <button
              onClick={() => translateMutation.mutate({ novelId: id, style: "fluent" })}
              disabled={translateMutation.isPending}
              className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              {translateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {translateMutation.isPending ? "翻译中..." : "开始翻译"}
            </button>
          </div>
        </div>
      )}

      <div className="flex relative">
        {/* Chapter sidebar */}
        {showSidebar && (
          <aside className={`fixed left-0 top-[7.5rem] bottom-0 w-72 ${cardBg} border-r ${borderColor} overflow-y-auto z-40 transition-colors`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-mono text-xs uppercase tracking-wider ${subTextColor}`}>章节列表</h3>
                <button onClick={() => setShowSidebar(false)} className={`p-1 rounded ${hoverBg}`}><X className="w-4 h-4" /></button>
              </div>

              {/* Jump to chapter */}
              <div className="flex gap-2 mb-4">
                <input
                  type="number"
                  min={1}
                  max={totalChapters}
                  value={jumpInput}
                  onChange={e => setJumpInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleJump()}
                  placeholder={`1-${totalChapters}`}
                  className={`flex-1 px-3 py-1.5 rounded-lg bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-sm text-[#FDFBF5] placeholder:text-white/40`}
                />
                <button
                  onClick={handleJump}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-lg text-sm font-medium"
                >
                  跳转
                </button>
              </div>

              {chapterList?.map((ch, idx) => (
                <button
                  key={ch.id}
                  onClick={() => { setCurrentChapterId(ch.id); setShowSidebar(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    ch.id === currentChapterId
                      ? activeBg
                      : `${chapterText}`
                  }`}
                >
                  <span className={`font-mono text-xs ${subTextColor} mr-2`}>{idx + 1}</span>
                  {ch.title || `第${idx + 1}章`}
                  {bookmarks?.some(bm => bm.chapterId === ch.id) && (
                    <Bookmark className="w-3 h-3 inline ml-1.5 text-amber-500" />
                  )}
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Bookmarks sidebar */}
        {showBookmarks && (
          <aside className={`fixed right-0 top-[7.5rem] bottom-0 w-72 ${cardBg} border-l ${borderColor} overflow-y-auto z-40 transition-colors`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-mono text-xs uppercase tracking-wider ${subTextColor}`}>我的书签</h3>
                <button onClick={() => setShowBookmarks(false)} className={`p-1 rounded ${hoverBg}`}><X className="w-4 h-4" /></button>
              </div>

              {bookmarks?.length === 0 ? (
                <p className={`text-sm ${subTextColor} text-center py-8`}>暂无书签</p>
              ) : (
                <div className="space-y-2">
                  {bookmarks?.map(bm => {
                    const ch = chapterList?.find(c => c.id === bm.chapterId)
                    return (
                      <div key={bm.id} className={`p-3 rounded-lg ${isLightTheme ? "bg-black/5" : "bg-white/5"} group`}>
                        <button
                          onClick={() => {
                            setCurrentChapterId(bm.chapterId)
                            setShowBookmarks(false)
                          }}
                          className="text-left text-sm w-full mb-1 truncate"
                        >
                          {ch?.title || `章节 #${bm.chapterId}`}
                        </button>
                        {bm.note && <p className="text-xs text-white/50 mb-1">{bm.note}</p>}
                        <button
                          onClick={() => deleteBookmarkMutation.mutate({ id: bm.id })}
                          className="text-xs text-red-400/60 hover:text-red-400"
                        >
                          删除
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Annotations sidebar */}
        {showAnnotations && (
          <aside className={`fixed right-0 top-[7.5rem] bottom-0 w-80 ${cardBg} border-l ${borderColor} overflow-y-auto z-40 transition-colors`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-mono text-xs uppercase tracking-wider ${subTextColor}`}>批注列表</h3>
                <button onClick={() => setShowAnnotations(false)} className={`p-1 rounded ${hoverBg}`}><X className="w-4 h-4" /></button>
              </div>

              {annotationList?.length === 0 ? (
                <p className={`text-sm ${subTextColor} text-center py-8`}>暂无批注<br /><span className="text-xs opacity-60">选中文字即可添加高亮和批注</span></p>
              ) : (
                <div className="space-y-3">
                  {annotationList?.map(ann => (
                    <div key={ann.id} className={`p-3 rounded-lg ${inactiveBg} group`}>
                      <div className="flex items-start gap-2 mb-2">
                        <span className={`w-3 h-3 rounded-full shrink-0 mt-0.5 ${
                          ann.color === "yellow" ? "bg-yellow-400" :
                          ann.color === "green" ? "bg-green-400" :
                          ann.color === "blue" ? "bg-blue-400" :
                          ann.color === "pink" ? "bg-pink-400" :
                          "bg-purple-400"
                        }`} />
                        <p className="text-sm line-clamp-2 flex-1">{ann.selectedText}</p>
                      </div>
                      {ann.note && (
                        <div className="flex items-start gap-1.5 mb-2">
                          <PenLine className="w-3 h-3 text-white/50 mt-0.5 shrink-0" />
                          <p className="text-xs text-white/50">{ann.note}</p>
                        </div>
                      )}
                      <button
                        onClick={() => deleteAnnotationMutation.mutate({ id: ann.id })}
                        className="text-xs text-red-400/60 hover:text-red-400"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        <main className="flex-1 max-w-[800px] mx-auto px-6 py-8">
          {currentChapter ? (
            <article
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: lineHeight,
                paddingLeft: `${marginSize}px`,
                paddingRight: `${marginSize}px`,
              }}
              className={fontFamily === "serif" ? "font-serif" : fontFamily === "sans" ? "font-sans" : "font-mono"}
            >
              {/* Bookmark button */}
              <div className="flex items-center justify-end gap-2 mb-4">
                <button
                  onClick={() => {
                    if (isBookmarked) {
                      const bm = bookmarks?.find(b => b.chapterId === currentChapterId)
                      if (bm) deleteBookmarkMutation.mutate({ id: bm.id })
                    } else {
                      setShowBookmarkForm(true)
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
                    isBookmarked
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/20"
                      : `${inactiveBg + " " + inactiveText}`
                  }`}
                >
                  {isBookmarked ? <Bookmark className="w-3.5 h-3.5" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                  {isBookmarked ? "已书签" : "添加书签"}
                </button>

                {bilingualMode === "translated" && (
                  <>
                    <button
                      onClick={() => setEditingChapter(!editingChapter)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
                        editingChapter
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/20"
                          : `${inactiveBg + " " + inactiveText}`
                      }`}
                    >
                      <Settings className="w-3.5 h-3.5" />
                      {editingChapter ? "取消编辑" : "编辑译文"}
                    </button>
                    <button
                      onClick={handleExport}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
                        inactiveBg + " " + inactiveText
                      }`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      导出
                    </button>
                  </>
                )}
              </div>

              {/* Bookmark form */}
              {showBookmarkForm && (
                <div className={`mb-6 p-4 rounded-xl ${isLightTheme ? "bg-black/5" : "bg-white/5"} border ${borderColor}`}>
                  <p className="text-sm mb-2">添加书签</p>
                  <input
                    value={bookmarkNote}
                    onChange={e => setBookmarkNote(e.target.value)}
                    placeholder="备注（可选）"
                    className={`w-full px-3 py-2 rounded-lg bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-sm mb-2 text-[#FDFBF5]`}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddBookmark}
                      disabled={createBookmarkMutation.isPending}
                      className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full text-xs font-medium"
                    >
                      添加
                    </button>
                    <button
                      onClick={() => { setShowBookmarkForm(false); setBookmarkNote(""); }}
                      className="px-4 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* Annotation form */}
              {showAnnotationForm && selectedText && (
                <div className={`mb-6 p-4 rounded-xl ${isLightTheme ? "bg-black/5" : "bg-white/5"} border border-amber-500/20`}>
                  <p className="text-sm mb-2 flex items-center gap-2">
                    <Highlighter className="w-4 h-4 text-amber-500" />
                    添加批注
                  </p>
                  <p className="text-xs text-white/40 mb-3 line-clamp-2 font-mono">"{selectedText}"</p>
                  <div className="flex gap-2 mb-3">
                    {["yellow", "green", "blue", "pink", "purple"].map(color => (
                      <button
                        key={color}
                        onClick={() => setAnnotationColor(color)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          annotationColor === color ? "border-white scale-110" : "border-transparent"
                        } ${
                          color === "yellow" ? "bg-yellow-400" :
                          color === "green" ? "bg-green-400" :
                          color === "blue" ? "bg-blue-400" :
                          color === "pink" ? "bg-pink-400" :
                          "bg-purple-400"
                        }`}
                      />
                    ))}
                  </div>
                  <textarea
                    value={annotationNote}
                    onChange={e => setAnnotationNote(e.target.value)}
                    placeholder="添加批注（可选）..."
                    className={`w-full h-16 px-3 py-2 rounded-lg bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-sm mb-2 text-[#FDFBF5] resize-none`}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateAnnotation}
                      disabled={createAnnotationMutation.isPending}
                      className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full text-xs font-medium"
                    >
                      {createAnnotationMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                      保存
                    </button>
                    <button
                      onClick={() => { setShowAnnotationForm(false); setSelectedText(""); setAnnotationNote(""); }}
                      className="px-4 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {(bilingualMode === "original" || bilingualMode === "bilingual") && (
                <div className={bilingualMode === "bilingual" ? `mb-8 pb-8 border-b ${dividerColor}` : ""}>
                  <p className={`font-mono text-xs ${labelColor} mb-4 uppercase tracking-wider`}>原文</p>
                  <div className={isLightTheme ? "text-black/80" : "text-white/80"}>
                    {renderParagraphs(currentChapter.contentOriginal || "", paragraphSpacing, 0, handleTextSelection, annotationList)}
                  </div>
                </div>
              )}

              {(bilingualMode === "translated" || bilingualMode === "bilingual") && (
                <div>
                  {bilingualMode === "bilingual" && (
                    <p className={`font-mono text-xs ${labelColor} mb-4 uppercase tracking-wider`}>译文</p>
                  )}
                  {editingChapter ? (
                    <div>
                      <textarea
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        className={`w-full h-96 px-4 py-3 rounded-xl bg-white/5 border ${borderColor} focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none font-serif leading-[1.8]`}
                        style={{ fontSize: `${fontSize}px` }}
                      />
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={handleSaveEdit}
                          disabled={updateChapterMutation.isPending}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-sm font-medium"
                        >
                          <Save className="w-3.5 h-3.5" /> 保存
                        </button>
                        <button
                          onClick={() => setEditingChapter(false)}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {renderParagraphs(currentChapter.contentTranslated || currentChapter.contentOriginal || "暂无翻译", paragraphSpacing, 1000, handleTextSelection, annotationList)}
                    </div>
                  )}
                </div>
              )}
            </article>
          ) : (
            <div className={`text-center ${subTextColor} mt-20`}>请选择章节开始阅读</div>
          )}

          <div className="flex justify-between mt-16">
            <button
              onClick={() => {
                if (currentIndex > 0 && chapterList) {
                  setCurrentChapterId(chapterList[currentIndex - 1].id)
                }
              }}
              disabled={currentIndex <= 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-full ${inactiveBg + " " + (isLightTheme ? "hover:bg-black/10" : "hover:bg-white/10")} disabled:opacity-30 disabled:cursor-not-allowed transition-colors`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="font-mono text-sm">上一章</span>
            </button>
            <button
              onClick={() => {
                if (chapterList && currentIndex < chapterList.length - 1) {
                  setCurrentChapterId(chapterList[currentIndex + 1].id)
                }
              }}
              disabled={!chapterList || currentIndex >= chapterList.length - 1}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-400 text-[#111827] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <span className="font-mono text-sm font-medium">下一章</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </main>
      </div>
    </div>
  )
}

type AnnotationItem = {
  id: number
  paragraphIndex: number
  selectedText: string
  color: string
  note: string | null
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "bg-yellow-400/30",
  green: "bg-green-400/30",
  blue: "bg-blue-400/30",
  pink: "bg-pink-400/30",
  purple: "bg-purple-400/30",
}

// Render text split into paragraphs with configurable spacing and highlight support
function renderParagraphs(
  text: string,
  spacing: number,
  paragraphIndexOffset: number,
  onTextSelect: (paragraphIndex: number) => void,
  annotationList?: AnnotationItem[] | null
) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  return paragraphs.map((para, i) => {
    const pIdx = paragraphIndexOffset + i
    const paraAnnotations = annotationList?.filter(a => a.paragraphIndex === pIdx) || []
    return (
      <p
        key={i}
        className="whitespace-pre-wrap select-text"
        style={{ marginBottom: `${spacing}rem` }}
        onMouseUp={() => onTextSelect(pIdx)}
      >
        {renderHighlightedText(para.trim(), paraAnnotations)}
      </p>
    )
  })
}

function renderHighlightedText(text: string, annotations: AnnotationItem[]) {
  if (annotations.length === 0) return text
  // Sort by position in text
  const sorted = [...annotations].sort((a, b) => text.indexOf(a.selectedText) - text.indexOf(b.selectedText))
  const result: React.ReactNode[] = []
  let lastIndex = 0
  for (const ann of sorted) {
    const idx = text.indexOf(ann.selectedText, lastIndex)
    if (idx === -1) continue
    if (idx > lastIndex) {
      result.push(text.slice(lastIndex, idx))
    }
    result.push(
      <mark
        key={ann.id}
        className={`${HIGHLIGHT_COLORS[ann.color] || HIGHLIGHT_COLORS.yellow} rounded px-0.5 cursor-pointer`}
        title={ann.note || undefined}
      >
        {ann.selectedText}
      </mark>
    )
    lastIndex = idx + ann.selectedText.length
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }
  return result.length > 0 ? result : text
}

// Reader settings slider component
function ReaderSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  const percentage = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-white/70">{label}</span>
        <span className="font-mono text-xs text-amber-500">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #F59E0B ${percentage}%, rgba(255,255,255,0.1) ${percentage}%)`,
        }}
      />
    </div>
  )
}
