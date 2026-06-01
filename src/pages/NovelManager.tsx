import { useNavigate } from "react-router"
import { trpc } from "@/providers/trpc"
import { useState, useMemo, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import NavBar from "@/components/NavBar"
import type { inferRouterOutputs } from "@trpc/server"
import type { AppRouter } from "../../api/router"
import {
  BookOpen, Trash2, Plus, Search, Upload, Play, Download,
  Tag, Edit, X, Loader2, Database, Sparkles, ChevronDown
} from "lucide-react"

type RouterOutput = inferRouterOutputs<AppRouter>
type NovelItem = RouterOutput["novel"]["list"][number]

export default function NovelManager() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const { data: novels, isLoading } = trpc.novel.list.useQuery()
  const { data: allTags } = trpc.tag.list.useQuery()
  const { data: tagMap } = trpc.novel.tagMap.useQuery()
  const createMutation = trpc.novel.create.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  })
  const deleteMutation = trpc.novel.delete.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  })
  const updateMutation = trpc.novel.update.useMutation({
    onSuccess: () => utils.novel.list.invalidate(),
  })
  const translateMutation = trpc.translate.start.useMutation({
    onSuccess: () => {
      utils.novel.list.invalidate()
      utils.chapter.list.invalidate()
    },
  })
  const indexMutation = trpc.rag.indexNovel.useMutation()
  const assignTagMutation = trpc.tag.assign.useMutation({
    onSuccess: () => utils.novel.tags.invalidate(),
  })
  const removeTagMutation = trpc.tag.remove.useMutation({
    onSuccess: () => utils.novel.tags.invalidate(),
  })

  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState("")
  const [author, setAuthor] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 })

  const [editingNovel, setEditingNovel] = useState<{ id: number; title: string; author: string } | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editAuthor, setEditAuthor] = useState("")

  const [translateNovel, setTranslateNovel] = useState<NovelItem | null>(null)
  const [translateStyle, setTranslateStyle] = useState<"literal" | "fluent" | "literary">("fluent")
  const [translatePrompt, setTranslatePrompt] = useState("")
  const [translateRagCalls, setTranslateRagCalls] = useState<Array<{ type: string; content: string; score?: number; sourceType?: string }> | null>(null)
  const [showRagPanel, setShowRagPanel] = useState(false)

  const [exportNovel, setExportNovel] = useState<NovelItem | null>(null)
  const [exportFormat, setExportFormat] = useState<"pure" | "parallel">("pure")

  const [tagNovel, setTagNovel] = useState<NovelItem | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf'],
    },
    multiple: true,
  })

  const filteredNovels = useMemo(() => {
    if (!novels) return []
    if (!searchQuery.trim()) return novels
    const q = searchQuery.toLowerCase()
    return novels.filter(n =>
      n.title.toLowerCase().includes(q) ||
      (n.author ?? "").toLowerCase().includes(q)
    )
  }, [novels, searchQuery])

  const getNovelTags = (novelId: number) => {
    if (!allTags || !tagMap) return []
    const tagIds = tagMap.filter(tm => tm.novelId === novelId).map(tm => tm.tagId)
    return allTags.filter(t => tagIds.includes(t.id))
  }

  const handleCreate = () => {
    if (!title.trim()) return
    createMutation.mutate({ title, author: author || undefined })
    setTitle("")
    setAuthor("")
    setShowForm(false)
  }

  const handleFileUpload = async () => {
    if (files.length === 0) return
    setUploading(true)
    setUploadProgress({ current: 0, total: files.length })
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const formData = new FormData()
        formData.append("file", file)
        // 批量上传时，使用文件名（去掉扩展名）作为默认标题；单文件时使用输入框标题
        const fileTitle = file.name.replace(/\.[^/.]+$/, "")
        formData.append("title", files.length === 1 && title.trim() ? title.trim() : fileTitle)
        formData.append("author", author)
        const res = await fetch("/api/upload", { method: "POST", body: formData })
        if (!res.ok) throw new Error(`Upload failed for ${file.name}`)
        setUploadProgress({ current: i + 1, total: files.length })
      }
      await utils.novel.list.invalidate()
      setShowForm(false)
      setTitle("")
      setAuthor("")
      setFiles([])
    } catch (err) {
      alert("上传失败: " + String(err))
    } finally {
      setUploading(false)
      setUploadProgress({ current: 0, total: 0 })
    }
  }

  const handleUpdate = () => {
    if (!editingNovel || !editTitle.trim()) return
    updateMutation.mutate({ id: editingNovel.id, title: editTitle, author: editAuthor || undefined })
    setEditingNovel(null)
  }

  const handleTranslate = async () => {
    if (!translateNovel) return
    const result = await translateMutation.mutateAsync({
      novelId: translateNovel.id,
      style: translateStyle,
      userPrompt: translatePrompt.trim() || undefined,
    })
    setTranslateNovel(null)
    setTranslatePrompt("")
    if (result.ragCalls && result.ragCalls.length > 0) {
      setTranslateRagCalls(result.ragCalls)
      setShowRagPanel(true)
    }
  }

  const handleExport = async () => {
    if (!exportNovel) return
    const result = await utils.translate.export.fetch({
      novelId: exportNovel.id,
      format: exportFormat,
    })
    const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${exportNovel.title}_${exportFormat === "pure" ? "纯中文" : "对照"}.txt`
    a.click()
    URL.revokeObjectURL(url)
    setExportNovel(null)
  }

  const handleAssignTag = (novelId: number, tagId: number) => {
    assignTagMutation.mutate({ novelId, tagId })
  }

  const handleRemoveTag = (novelId: number, tagId: number) => {
    removeTagMutation.mutate({ novelId, tagId })
  }

  const isTranslated = (novel: NovelItem) => novel.status === "translated"

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <NavBar />
      <div className="max-w-[1400px] mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold">我的小说文库</h1>
            <p className="text-white/70 mt-2 font-mono text-sm">管理你的翻译与阅读项目</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索小说..."
                className="pl-9 pr-4 py-2 rounded-full bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-sm w-56 text-[#FDFBF5] placeholder:text-white/40"
              />
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              添加小说
            </button>
          </div>
        </div>

        {/* Add novel form */}
        {showForm && (
          <div className="mb-8 p-6 rounded-xl bg-white/5 border border-white/10 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-xs text-white/70 mb-2">标题</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                  placeholder="小说标题"
                />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/70 mb-2">作者</label>
                <input
                  value={author}
                  onChange={e => setAuthor(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]"
                  placeholder="作者名"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-xs text-white/70 mb-2">上传文件（txt/docx/pdf，可多选批量上传）</label>
              <div
                {...getRootProps()}
                className={`w-full px-4 py-6 rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-white/20 bg-white/5 hover:border-white/40'
                }`}
              >
                <input {...getInputProps()} />
                <Upload className="w-6 h-6 mx-auto mb-2 text-white/40" />
                {isDragActive ? (
                  <p className="text-amber-400 text-sm">松开以添加文件...</p>
                ) : (
                  <p className="text-white/50 text-sm">拖拽文件到此处，或点击选择</p>
                )}
                <p className="text-white/30 text-xs mt-1 font-mono">支持 .txt / .docx / .pdf</p>
              </div>
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-white/40 text-xs font-mono">
                      <span className="truncate">{i + 1}. {f.name}</span>
                      <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-white/30 hover:text-red-400 ml-2">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {uploading && uploadProgress.total > 0 && (
                <p className="text-amber-400 text-xs mt-2 font-mono">
                  上传中... {uploadProgress.current}/{uploadProgress.total}
                </p>
              )}
            </div>

            <div className="flex gap-3">
              {files.length > 0 ? (
                <button
                  onClick={handleFileUpload}
                  disabled={uploading || (files.length === 1 && !title.trim())}
                  className="flex items-center gap-2 px-6 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading ? "上传解析中..." : `上传并解析 (${files.length})`}
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={createMutation.isPending || !title.trim()}
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium"
                >
                  创建
                </button>
              )}
              <button onClick={() => { setShowForm(false); setFiles([]); setTitle(""); setAuthor(""); }} className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full">
                取消
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-white/40 py-20">加载中...</div>
        ) : filteredNovels.length === 0 ? (
          <div className="text-center text-white/40 py-20">
            <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>{searchQuery ? "未找到匹配的小说" : "还没有小说，点击上方按钮添加"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredNovels.map(novel => {
              const novelTags = getNovelTags(novel.id)
              return (
                <div
                  key={novel.id}
                  className="group p-6 rounded-xl bg-white/[0.03] border border-white/10 hover:border-amber-500/30 hover:bg-white/[0.05] transition-all cursor-pointer"
                  onClick={() => navigate(`/reader/${novel.id}`)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                      <BookOpen className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setEditingNovel({ id: novel.id, title: novel.title, author: novel.author || "" })
                          setEditTitle(novel.title)
                          setEditAuthor(novel.author || "")
                        }}
                        className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/70 transition-colors"
                        title="编辑"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setOpenMenuId(openMenuId === novel.id ? null : novel.id)
                        }}
                        className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/70 transition-colors relative"
                        title="更多"
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform ${openMenuId === novel.id ? "rotate-180" : ""}`} />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          if (confirm("确认删除？")) deleteMutation.mutate({ id: novel.id })
                        }}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-white/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <h3 className="font-serif text-lg font-semibold mb-2 line-clamp-2">{novel.title}</h3>
                  <p className="text-white/50 text-sm mb-3">{novel.author || "未知作者"}</p>

                  {novelTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {novelTags.map(tag => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 rounded-full text-xs font-mono bg-white/5 text-white/50"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                      novel.status === "translated"
                        ? "bg-green-500/20 text-green-400"
                        : novel.status === "reading"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-white/10 text-white/50"
                    }`}>
                      {novel.status === "translated" ? "已翻译" : novel.status === "reading" ? "阅读中" : "未读"}
                    </span>
                  </div>

                  {/* Dropdown menu */}
                  {openMenuId === novel.id && (
                    <div
                      className="mt-3 p-2 rounded-lg bg-[#1F2937] border border-white/10 space-y-1"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          setOpenMenuId(null)
                          navigate(`/reader/${novel.id}`)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                      >
                        <BookOpen className="w-3.5 h-3.5" /> {isTranslated(novel) ? "阅读" : "阅读原文"}
                      </button>
                      {!isTranslated(novel) && (
                        <button
                          onClick={() => {
                            setOpenMenuId(null)
                            setTranslateNovel(novel)
                            const meta = (novel.metadata as Record<string, unknown> | null) || {}
                            const savedStyle = meta.lastTranslateStyle as "literal" | "fluent" | "literary" | undefined
                            const savedPrompt = meta.lastTranslatePrompt as string | undefined
                            if (savedStyle) setTranslateStyle(savedStyle)
                            if (savedPrompt !== undefined) setTranslatePrompt(savedPrompt)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" /> 开始翻译
                        </button>
                      )}
                      {isTranslated(novel) && (
                        <button
                          onClick={() => { setOpenMenuId(null); setExportNovel(novel); }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> 导出翻译
                        </button>
                      )}
                      <button
                        onClick={() => { setOpenMenuId(null); setTagNovel(novel); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors"
                      >
                        <Tag className="w-3.5 h-3.5" /> 编辑标签
                      </button>
                      <button
                        onClick={() => {
                          setOpenMenuId(null)
                          indexMutation.mutate({ novelId: novel.id })
                        }}
                        disabled={indexMutation.isPending}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-left text-sm text-white/70 hover:text-amber-400 transition-colors disabled:opacity-30"
                      >
                        <Database className="w-3.5 h-3.5" /> 索引到 RAG
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingNovel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-semibold">编辑小说</h3>
              <button onClick={() => setEditingNovel(null)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block font-mono text-xs text-white/70 mb-1">标题</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" />
              </div>
              <div>
                <label className="block font-mono text-xs text-white/70 mb-1">作者</label>
                <input value={editAuthor} onChange={e => setEditAuthor(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5]" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleUpdate} className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium text-sm">保存</button>
              <button onClick={() => setEditingNovel(null)} className="px-5 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Translate Modal */}
      {translateNovel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">开始翻译</h3>
              </div>
              <button onClick={() => setTranslateNovel(null)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">《{translateNovel.title}》</p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-white/70 mb-2">翻译风格</label>
                <div className="flex gap-2">
                  {([
                    { value: "literal" as const, label: "直译" },
                    { value: "fluent" as const, label: "意译" },
                    { value: "literary" as const, label: "文学性" },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setTranslateStyle(opt.value)}
                      className={`flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
                        translateStyle === opt.value
                          ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                          : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-white/70 mb-2">自定义要求（可选）</label>
                <textarea
                  value={translatePrompt}
                  onChange={e => setTranslatePrompt(e.target.value)}
                  placeholder="如：保持原文段落结构、使用古风表达、人名统一译为..."
                  className="w-full h-24 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
                />
              </div>
            </div>

            <button
              onClick={handleTranslate}
              disabled={translateMutation.isPending}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full font-medium transition-colors flex items-center justify-center gap-2"
            >
              {translateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {translateMutation.isPending ? "翻译中..." : "开始翻译"}
            </button>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {exportNovel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">导出翻译</h3>
              </div>
              <button onClick={() => setExportNovel(null)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">《{exportNovel.title}》</p>
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setExportFormat("pure")}
                className={`flex-1 px-4 py-3 rounded-xl text-sm transition-colors ${
                  exportFormat === "pure"
                    ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                    : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                }`}
              >
                纯中文模式
              </button>
              <button
                onClick={() => setExportFormat("parallel")}
                className={`flex-1 px-4 py-3 rounded-xl text-sm transition-colors ${
                  exportFormat === "parallel"
                    ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                    : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                }`}
              >
                对照模式
              </button>
            </div>
            <button
              onClick={handleExport}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              下载文件
            </button>
          </div>
        </div>
      )}

      {/* Tag Modal */}
      {tagNovel && allTags && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">编辑标签</h3>
              </div>
              <button onClick={() => setTagNovel(null)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">《{tagNovel.title}》</p>
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => {
                const isAssigned = tagMap?.some(tm => tm.novelId === tagNovel.id && tm.tagId === tag.id)
                return (
                  <button
                    key={tag.id}
                    onClick={() => {
                      if (isAssigned) handleRemoveTag(tagNovel.id, tag.id)
                      else handleAssignTag(tagNovel.id, tag.id)
                    }}
                    className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                      isAssigned
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : "bg-white/5 text-white/40 border border-transparent hover:bg-white/10 hover:text-white/60"
                    }`}
                  >
                    {isAssigned ? "✓ " : "+ "}{tag.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* RAG 调用信息面板 */}
      {showRagPanel && translateRagCalls && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">RAG 检索详情</h3>
              </div>
              <button onClick={() => setShowRagPanel(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">本次翻译共检索到 {translateRagCalls.length} 条参考</p>
            <div className="space-y-3">
              {translateRagCalls.map((call, i) => (
                <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={
                      call.type === "translation_memory" ? "text-amber-400 text-xs font-mono" :
                      call.type === "vector_search" ? "text-green-400 text-xs font-mono" :
                      "text-blue-400 text-xs font-mono"
                    }>
                      {call.type === "translation_memory" ? "翻译记忆" :
                       call.type === "vector_search" ? "向量检索" : "全文检索"}
                    </span>
                    {call.score !== undefined && (
                      <span className="text-white/40 text-xs font-mono">相似度: {(call.score * 100).toFixed(1)}%</span>
                    )}
                    {call.sourceType && (
                      <span className="text-white/30 text-xs font-mono">来源: {call.sourceType}</span>
                    )}
                  </div>
                  <p className="text-white/80 text-sm line-clamp-4">{call.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
