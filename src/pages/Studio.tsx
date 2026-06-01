import { useState, useEffect, useCallback } from "react"
import { useParams } from "react-router"
import { trpc } from "@/providers/trpc"
import NavBar from "@/components/NavBar"
import {
  PenTool, Sparkles, Save, Download,
  Lock, Unlock, ChevronRight, Clock,
  Thermometer, Music, FileText, Shield,
  Database, BookText, Wand2, RotateCw, BookOpen,
  Loader2, X, AlertCircle, Theater, Trash2
} from "lucide-react"

type WritingMode = "canon_continuation" | "character_spinoff" | "original_in_universe" | "alternate_universe"

interface GenParams {
  temperature: number
  styleFidelity: number
  characterLoyalty: number
  tone: string
  lengthTarget: "short" | "chapter" | "arc"
  canonConstraint: "strict" | "loose" | "au"
  writingMode: WritingMode
  ragLimit: number
}

const DEFAULT_PARAMS: GenParams = {
  temperature: 0.8,
  styleFidelity: 7,
  characterLoyalty: 8,
  tone: "dramatic",
  lengthTarget: "chapter",
  canonConstraint: "strict",
  writingMode: "canon_continuation",
  ragLimit: 5,
}

const MODE_OPTIONS: { value: WritingMode; label: string; description: string }[] = [
  { value: "canon_continuation", label: "正史续写", description: "严格遵循正史，只使用指定角色" },
  { value: "character_spinoff", label: "角色外传", description: "聚焦已有角色的独立故事" },
  { value: "original_in_universe", label: "同世界观原创", description: "创作新故事，不强制已有角色" },
  { value: "alternate_universe", label: "AU/平行宇宙", description: "保留角色内核，世界观可改" },
]

const TONE_OPTIONS = [
  { value: "dark", label: "黑暗压抑" },
  { value: "romantic", label: "浪漫温情" },
  { value: "action", label: "紧张激烈" },
  { value: "slice_of_life", label: "日常轻松" },
  { value: "mysterious", label: "悬疑诡秘" },
  { value: "epic", label: "史诗壮阔" },
]

export default function Studio() {
  const { workId } = useParams<{ workId: string }>()
  const utils = trpc.useUtils()

  const { data: seriesList } = trpc.lore.series.list.useQuery()
  const { data: novelList } = trpc.novel.list.useQuery()
  const { data: worksList } = trpc.generate.list.useQuery()

  const [selectedSeriesId, setSelectedSeriesId] = useState<number | null>(null)
  const [selectedParentNovelId, setSelectedParentNovelId] = useState<number | null>(null)
  const { data: characters } = trpc.lore.character.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )

  // 状态
  const [activeTab, setActiveTab] = useState<"edit" | "history">("edit")
  const [content, setContent] = useState("")
  const [displayContent, setDisplayContent] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [brief, setBrief] = useState("")
  const [title, setTitle] = useState("")
  const [userPrompt, setUserPrompt] = useState("")
  const [params, setParams] = useState<GenParams>(DEFAULT_PARAMS)
  const [lockedParagraphs, setLockedParagraphs] = useState<Set<number>>(new Set())
  const [generatedWorkId, setGeneratedWorkId] = useState<number | null>(null)
  const [useMaterials, setUseMaterials] = useState(true)
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [ragCalls, setRagCalls] = useState<Array<{
    type: string
    content: string
    score?: number
    sourceTitle?: string
    chapterNumber?: number
    chunkIndex?: number
    totalChunks?: number
  }> | null>(null)
  const [showRagPanel, setShowRagPanel] = useState(false)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>([])
  const [selectedTropeIds, setSelectedTropeIds] = useState<number[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  // 保存为风格样本
  const [showStyleSampleModal, setShowStyleSampleModal] = useState(false)
  const [styleSampleCharacterTag, setStyleSampleCharacterTag] = useState("")
  const [styleSampleSceneTag, setStyleSampleSceneTag] = useState("")

  // 查询该系列的桥段
  const { data: seriesTropes } = trpc.trope.list.useQuery(
    { seriesId: selectedSeriesId || 0 },
    { enabled: !!selectedSeriesId }
  )

  // 系列切换时重置角色选择和桥段选择
  useEffect(() => {
    setSelectedCharacterIds([])
    setSelectedTropeIds([])
  }, [selectedSeriesId])

  // 模式切换时自动调整角色默认值 + temperature
  useEffect(() => {
    if (!characters) return
    if (params.writingMode === "canon_continuation" || params.writingMode === "character_spinoff") {
      setSelectedCharacterIds(characters.map(c => c.id))
    } else {
      setSelectedCharacterIds([])
    }
    // 智能 temperature 默认值
    const tempMap: Record<WritingMode, number> = {
      canon_continuation: 0.6,
      character_spinoff: 0.75,
      original_in_universe: 0.9,
      alternate_universe: 1.0,
    }
    setParams(p => ({ ...p, temperature: tempMap[p.writingMode] }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.writingMode])

  // 查询该系列的素材列表
  const { data: seriesMaterials } = trpc.material.list.useQuery(
    { seriesId: selectedSeriesId || undefined },
    { enabled: !!selectedSeriesId }
  )

  // 重写相关
  const [regenIndex, setRegenIndex] = useState<number | null>(null)
  const [regenBrief, setRegenBrief] = useState("")

  // 生成 mutation
  const generateMutation = trpc.generate.fanfiction.useMutation({
    onSuccess: () => {
      utils.generate.list.invalidate()
    },
  })

  const continueMutation = trpc.generate.continue.useMutation()
  const regenerateMutation = trpc.generate.regenerate.useMutation()

  const saveAsStyleSampleMutation = trpc.material.saveAsStyleSample.useMutation({
    onSuccess: () => {
      utils.material.list.invalidate()
      setShowStyleSampleModal(false)
      setStyleSampleCharacterTag("")
      setStyleSampleSceneTag("")
      alert("已保存为风格样本")
    },
  })

  const deleteWorkMutation = trpc.generate.deleteWork.useMutation({
    onSuccess: () => {
      utils.generate.list.invalidate()
      if (generatedWorkId && !worksList?.some(w => w.id === generatedWorkId)) {
        setGeneratedWorkId(null)
        setContent("")
        setDisplayContent("")
      }
    },
  })

  // RAG 反馈闭环
  const feedbackMutation = trpc.rag.feedback.useMutation()
  const [feedbackState, setFeedbackState] = useState<"pending" | "helpful" | "unhelpful" | null>(null)
  const [showFeedbackDetail, setShowFeedbackDetail] = useState(false)

  // 加载已有作品
  const { data: loadedWork } = trpc.generate.getWork.useQuery(
    { id: parseInt(workId || "0", 10) },
    { enabled: !!workId && workId !== "undefined" }
  )

  // 系列切换时重置素材选择
  useEffect(() => {
    setSelectedMaterialIds([])
  }, [selectedSeriesId])

  useEffect(() => {
    if (loadedWork && workId) {
      setGeneratedWorkId(loadedWork.id)
      setTitle(loadedWork.title || "")
      setContent(loadedWork.generatedContent || "")
      setDisplayContent(loadedWork.generatedContent || "")
      setBrief(loadedWork.brief || "")
      setSelectedSeriesId(loadedWork.seriesId)
      setSelectedParentNovelId(loadedWork.parentNovelId)
      setSelectedMaterialIds([])
      if (loadedWork.parameters) {
        const p = loadedWork.parameters as unknown as Partial<GenParams> & { selectedCharacterIds?: number[]; selectedTropeIds?: number[] }
        setParams({
          temperature: p.temperature ?? DEFAULT_PARAMS.temperature,
          styleFidelity: p.styleFidelity ?? DEFAULT_PARAMS.styleFidelity,
          characterLoyalty: p.characterLoyalty ?? DEFAULT_PARAMS.characterLoyalty,
          tone: p.tone ?? DEFAULT_PARAMS.tone,
          lengthTarget: p.lengthTarget ?? DEFAULT_PARAMS.lengthTarget,
          canonConstraint: p.canonConstraint ?? DEFAULT_PARAMS.canonConstraint,
          writingMode: (p.writingMode as WritingMode) || DEFAULT_PARAMS.writingMode,
          ragLimit: p.ragLimit ?? DEFAULT_PARAMS.ragLimit,
        })
        setSelectedCharacterIds(p.selectedCharacterIds || [])
        setSelectedTropeIds(p.selectedTropeIds || [])
      }
    }
  }, [loadedWork, workId])

  // 模拟流式显示效果
  useEffect(() => {
    if (!content || isTyping) return
    setIsTyping(true)
    setDisplayContent("")
    let i = 0
    const chunkSize = 2
    const interval = setInterval(() => {
      i += chunkSize
      if (i >= content.length) {
        setDisplayContent(content)
        clearInterval(interval)
        setIsTyping(false)
      } else {
        setDisplayContent(content.slice(0, i))
      }
    }, 12)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // 处理生成
  const handleGenerate = async () => {
    if (!selectedSeriesId || !brief.trim()) return
    setIsGenerating(true)
    setContent("")
    setDisplayContent("")
    setFeedbackState(null)
    setShowFeedbackDetail(false)

    try {
      const result = await generateMutation.mutateAsync({
        seriesId: selectedSeriesId,
        brief: brief.trim(),
        parameters: params,
        title: title || undefined,
        userPrompt: userPrompt.trim() || undefined,
        parentNovelId: selectedParentNovelId || undefined,
        useMaterials,
        materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
        selectedCharacterIds: selectedCharacterIds.length > 0 ? selectedCharacterIds : undefined,
        selectedTropeIds: selectedTropeIds.length > 0 ? selectedTropeIds : undefined,
      })

      setGeneratedWorkId(result.workId)
      setContent(result.content)
      if (result.ragCalls && result.ragCalls.length > 0) {
        setRagCalls(result.ragCalls)
        setShowRagPanel(true)
      }
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings)
      } else {
        setWarnings([])
      }
    } catch (error) {
      console.error("Generation failed:", error)
    } finally {
      setIsGenerating(false)
    }
  }

  // 段落分割
  const paragraphs = displayContent
    .split("\n\n")
    .filter(p => p.trim().length > 0)

  // 锁定/解锁段落
  const toggleLock = (index: number) => {
    setLockedParagraphs(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  // 保存为小说
  const saveAsNovelMutation = trpc.generate.saveAsNovel.useMutation({
    onSuccess: () => {
      utils.novel.list.invalidate()
    },
  })

  const handleSave = () => {
    if (!generatedWorkId) return
    saveAsNovelMutation.mutate({ workId: generatedWorkId })
  }

  // 导出
  const handleExport = useCallback(() => {
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${title || "untitled"}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [content, title])

  // 续写
  const handleContinue = async () => {
    if (!generatedWorkId || isGenerating) return
    setIsGenerating(true)
    setFeedbackState(null)
    setShowFeedbackDetail(false)
    try {
      const result = await continueMutation.mutateAsync({
        workId: generatedWorkId,
        useMaterials,
        materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
      })
      setContent(prev => prev + "\n\n" + result.content)
      if (result.ragCalls && result.ragCalls.length > 0) {
        setRagCalls(result.ragCalls)
        setShowRagPanel(true)
      }
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings)
      } else {
        setWarnings([])
      }
    } catch (error) {
      console.error("Continue failed:", error)
    } finally {
      setIsGenerating(false)
    }
  }

  // 段落重写
  const handleRegenerate = async (index: number) => {
    if (!generatedWorkId || !regenBrief.trim()) return
    const originalText = paragraphs[index]
    try {
      const result = await regenerateMutation.mutateAsync({
        workId: generatedWorkId,
        originalText,
        modifiedBrief: regenBrief.trim(),
        useMaterials,
        materialIds: selectedMaterialIds.length > 0 ? selectedMaterialIds : undefined,
      })
      setContent(result.fullContent)
      setDisplayContent(result.fullContent)
      setRegenIndex(null)
      setRegenBrief("")
      if (result.ragCalls && result.ragCalls.length > 0) {
        setRagCalls(result.ragCalls)
        setShowRagPanel(true)
      }
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings)
      } else {
        setWarnings([])
      }
    } catch (error) {
      console.error("Regenerate failed:", error)
    }
  }

  // 加载作品
  const handleLoadWork = (work: NonNullable<typeof worksList>[number]) => {
    if (!work) return
    setGeneratedWorkId(work.id)
    setTitle(work.title || "")
    setContent(work.generatedContent || "")
    setDisplayContent(work.generatedContent || "")
    setBrief(work.brief || "")
    setSelectedSeriesId(work.seriesId)
    setSelectedParentNovelId(work.parentNovelId)
    setActiveTab("edit")
    if (work.parameters) {
      const p = work.parameters as unknown as Partial<GenParams> & { selectedCharacterIds?: number[]; selectedTropeIds?: number[] }
      setParams({
        temperature: p.temperature ?? DEFAULT_PARAMS.temperature,
        styleFidelity: p.styleFidelity ?? DEFAULT_PARAMS.styleFidelity,
        characterLoyalty: p.characterLoyalty ?? DEFAULT_PARAMS.characterLoyalty,
        tone: p.tone ?? DEFAULT_PARAMS.tone,
        lengthTarget: p.lengthTarget ?? DEFAULT_PARAMS.lengthTarget,
        canonConstraint: p.canonConstraint ?? DEFAULT_PARAMS.canonConstraint,
        writingMode: (p.writingMode as WritingMode) || DEFAULT_PARAMS.writingMode,
        ragLimit: p.ragLimit ?? DEFAULT_PARAMS.ragLimit,
      })
      setSelectedCharacterIds(p.selectedCharacterIds || [])
      setSelectedTropeIds(p.selectedTropeIds || [])
    }
  }

  return (
    <div className="min-h-screen bg-[#111827] text-[#FDFBF5]">
      <NavBar />
      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* 左侧编辑区 */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 顶部操作栏 */}
          <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#111827]/90 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <PenTool className="w-4 h-4 text-amber-500" />
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="作品标题"
                className="bg-transparent text-sm font-serif outline-none placeholder:text-white/40 w-64 text-[#FDFBF5]"
              />
            </div>
            <div className="flex items-center gap-2">
              {/* Tab 切换 */}
              <div className="flex bg-white/5 rounded-full p-0.5 mr-2">
                <button
                  onClick={() => setActiveTab("edit")}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    activeTab === "edit" ? "bg-amber-500/20 text-amber-400" : "text-white/70 hover:text-white/90"
                  }`}
                >
                  当前编辑
                </button>
                <button
                  onClick={() => setActiveTab("history")}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    activeTab === "history" ? "bg-amber-500/20 text-amber-400" : "text-white/70 hover:text-white/90"
                  }`}
                >
                  历史作品
                </button>
              </div>
              <button
                onClick={handleSave}
                disabled={!generatedWorkId}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-sm transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                保存
              </button>
              <button
                onClick={() => setShowStyleSampleModal(true)}
                disabled={!content || !selectedSeriesId}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-30 text-amber-400 text-sm transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                保存为风格样本
              </button>
              <button
                onClick={handleExport}
                disabled={!content}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 text-sm transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                导出
              </button>
            </div>
          </header>

          {/* 编辑画布 */}
          <div className="flex-1 overflow-y-auto p-8">
            {activeTab === "history" ? (
              <div className="max-w-3xl mx-auto">
                <h2 className="font-mono text-xs uppercase tracking-wider text-white/70 mb-6 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  历史作品
                </h2>
                {worksList?.length === 0 ? (
                  <div className="text-center text-white/60 py-20">
                    <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p>暂无历史作品</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {worksList?.map(work => (
                      <div
                        key={work.id}
                        className="p-5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-amber-500/20 transition-all group cursor-pointer"
                        onClick={() => handleLoadWork(work)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-serif text-lg font-semibold">{work.title || `作品 #${work.id}`}</h3>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                              work.status === "saved" ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/50"
                            }`}>
                              {work.status === "saved" ? "已保存" : "草稿"}
                            </span>
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                if (confirm(`确定删除「${work.title || `作品 #${work.id}`}」？此操作不可撤销。`)) {
                                  deleteWorkMutation.mutate({ id: work.id })
                                }
                              }}
                              disabled={deleteWorkMutation.isPending}
                              className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-white/40 text-sm line-clamp-2 mb-2">{work.brief}</p>
                        <p className="text-white/20 text-xs font-mono">
                          {new Date(work.createdAt).toLocaleDateString()} · {(work.generatedContent || "").length} 字
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : displayContent ? (
              <div className="max-w-3xl mx-auto space-y-4">
                {paragraphs.map((para, idx) => (
                  <div
                    key={idx}
                    className={`group relative p-4 rounded-lg transition-colors ${
                      lockedParagraphs.has(idx)
                        ? "bg-amber-500/5 border border-amber-500/20"
                        : "hover:bg-white/[0.02] border border-transparent"
                    }`}
                  >
                    <p className="font-serif leading-[1.8] text-[#FDFBF5] whitespace-pre-wrap">
                      {para}
                    </p>
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => toggleLock(idx)}
                        className={`p-1.5 rounded ${
                          lockedParagraphs.has(idx)
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-white/5 text-white/60 hover:text-white/90"
                        }`}
                        title={lockedParagraphs.has(idx) ? "解锁" : "锁定"}
                      >
                        {lockedParagraphs.has(idx) ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => { setRegenIndex(idx); setRegenBrief(""); }}
                        className="p-1.5 rounded bg-white/5 text-white/50 hover:text-amber-400"
                        title="重写"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Regenerate form */}
                    {regenIndex === idx && (
                      <div className="mt-3 p-3 rounded-lg bg-white/5 border border-amber-500/20">
                        <p className="text-xs text-amber-400 mb-2 font-mono">重写要求</p>
                        <textarea
                          value={regenBrief}
                          onChange={e => setRegenBrief(e.target.value)}
                          placeholder="描述你想如何修改这一段..."
                          className="w-full h-20 px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => handleRegenerate(idx)}
                            disabled={regenerateMutation.isPending || !regenBrief.trim()}
                            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] rounded-full text-xs font-medium"
                          >
                            {regenerateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                            重写
                          </button>
                          <button
                            onClick={() => { setRegenIndex(null); setRegenBrief(""); }}
                            className="px-4 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-xs"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-center gap-2 text-amber-500 animate-pulse">
                    <Sparkles className="w-4 h-4" />
                    <span className="font-mono text-xs">输出中...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Wand2 className="w-12 h-12 text-white/10 mx-auto mb-4" />
                  <p className="text-white/60 font-mono text-sm">在右侧面板选择系列并填写创作要求</p>
                </div>
              </div>
            )}

            {/* RAG 查看按钮 */}
            {ragCalls && activeTab === "edit" && (
              <div className="max-w-3xl mx-auto mt-4">
                <button
                  onClick={() => setShowRagPanel(true)}
                  className="w-full py-2 bg-white/5 hover:bg-white/10 text-white/50 hover:text-amber-400 rounded-full text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Database className="w-4 h-4" />
                  查看 RAG 检索详情 ({ragCalls.length} 条)
                </button>
              </div>
            )}

            {/* RAG 反馈闭环 — 👍/👎 */}
            {content && generatedWorkId && activeTab === "edit" && feedbackState !== "helpful" && (
              <div className="max-w-3xl mx-auto mt-4">
                {feedbackState === null ? (
                  <div className="flex items-center justify-center gap-3 py-2">
                    <span className="text-white/40 text-sm">本次生成满意吗？</span>
                    <button
                      onClick={() => {
                        if (generatedWorkId) {
                          feedbackMutation.mutate({ generationId: generatedWorkId, wasHelpful: true })
                          setFeedbackState("helpful")
                        }
                      }}
                      className="px-4 py-1.5 rounded-full bg-green-500/10 hover:bg-green-500/20 text-green-400 text-sm transition-colors"
                    >
                      👍 满意
                    </button>
                    <button
                      onClick={() => setFeedbackState("unhelpful")}
                      className="px-4 py-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors"
                    >
                      👎 不满意
                    </button>
                  </div>
                ) : feedbackState === "unhelpful" ? (
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <p className="text-white/60 text-sm mb-3">哪方面不对？（可多选）</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {["角色性格不对（OOC）", "风格不像原作", "世界观矛盾", "其他"].map(reason => (
                        <button
                          key={reason}
                          onClick={() => {
                            if (generatedWorkId) {
                              feedbackMutation.mutate({ generationId: generatedWorkId, wasHelpful: false, reason })
                              setShowFeedbackDetail(true)
                            }
                          }}
                          className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-red-500/20 text-white/60 hover:text-red-400 text-xs transition-colors"
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setFeedbackState(null)}
                      className="text-white/30 hover:text-white/60 text-xs"
                    >
                      取消
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            {feedbackState === "helpful" && (
              <div className="max-w-3xl mx-auto mt-4 text-center">
                <span className="text-green-400 text-sm">✓ 感谢反馈，已记录</span>
              </div>
            )}
            {showFeedbackDetail && (
              <div className="max-w-3xl mx-auto mt-4 text-center">
                <span className="text-white/40 text-sm">✓ 反馈已提交，我们会据此优化素材检索</span>
              </div>
            )}

            {/* 续写按钮 */}
            {content && generatedWorkId && activeTab === "edit" && (
              <div className="max-w-3xl mx-auto mt-4">
                <button
                  onClick={handleContinue}
                  disabled={isGenerating}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/70 rounded-full text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  续写
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右侧 AI 控制面板 */}
        <aside className="w-[360px] border-l border-white/10 bg-[#111827]/95 backdrop-blur-md overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* 系列选择 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                <BookText className="w-3.5 h-3.5" />
                选择系列
              </label>
              <select
                value={selectedSeriesId || ""}
                onChange={e => setSelectedSeriesId(Number(e.target.value) || null)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
              >
                <option value="">选择一个系列...</option>
                {seriesList?.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* 父小说选择 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                <BookOpen className="w-3.5 h-3.5" />
                关联原作（可选）
              </label>
              <select
                value={selectedParentNovelId || ""}
                onChange={e => setSelectedParentNovelId(Number(e.target.value) || null)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm"
              >
                <option value="">不关联原作</option>
                {novelList?.map(n => (
                  <option key={n.id} value={n.id}>{n.title}</option>
                ))}
              </select>
            </div>

            {/* 创作模式 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                <Wand2 className="w-3.5 h-3.5" />
                创作模式
              </label>
              <div className="grid grid-cols-2 gap-2">
                {MODE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setParams(p => ({ ...p, writingMode: opt.value }))}
                    className={`text-left px-3 py-2.5 rounded-xl text-sm transition-colors border ${
                      params.writingMode === opt.value
                        ? "bg-amber-500/20 border-amber-500/30 text-amber-400"
                        : "bg-white/5 border-transparent hover:bg-white/10 text-white/60"
                    }`}
                    title={opt.description}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-[10px] text-white/40 mt-0.5 leading-tight">{opt.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 角色选择 */}
            {selectedSeriesId && characters && characters.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
                    <Sparkles className="w-3.5 h-3.5" />
                    参演角色
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedCharacterIds(characters.map(c => c.id))}
                      className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                    >
                      全选
                    </button>
                    <span className="text-white/20">|</span>
                    <button
                      onClick={() => setSelectedCharacterIds([])}
                      className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                    >
                      清空
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {characters.map(char => {
                    const isSelected = selectedCharacterIds.includes(char.id)
                    return (
                      <button
                        key={char.id}
                        onClick={() => {
                          setSelectedCharacterIds(prev =>
                            isSelected
                              ? prev.filter(id => id !== char.id)
                              : [...prev, char.id]
                          )
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${
                          isSelected
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                            : "bg-white/[0.03] text-white/40 border-white/10 hover:border-white/20"
                        }`}
                      >
                        {isSelected ? "✓ " : ""}{char.name}
                      </button>
                    )
                  })}
                </div>
                {selectedCharacterIds.length === 0 && (
                  <p className={`text-[10px] font-mono mt-2 ${params.writingMode === "original_in_universe" ? "text-amber-400/70" : "text-white/30"}`}>
                    {params.writingMode === "original_in_universe"
                      ? "🌟 纯原创模式：未选择任何已有角色，AI 将创作全新的原创角色和故事，不使用任何已有角色"
                      : params.writingMode === "alternate_universe"
                      ? "未选择角色，AI 将自主创作新角色或根据 Brief 使用已有角色"
                      : "未选择任何角色，请至少选择一位"
                  }
                  </p>
                )}
              </div>
            )}

            {/* 桥段选择 */}
            {selectedSeriesId && seriesTropes && seriesTropes.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
                    <Theater className="w-3.5 h-3.5" />
                    参考桥段
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedTropeIds(seriesTropes.map(t => t.id))}
                      className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                    >
                      全选
                    </button>
                    <span className="text-white/20">|</span>
                    <button
                      onClick={() => setSelectedTropeIds([])}
                      className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                    >
                      清空
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {seriesTropes.map(trope => {
                    const isSelected = selectedTropeIds.includes(trope.id)
                    return (
                      <button
                        key={trope.id}
                        onClick={() => {
                          setSelectedTropeIds(prev =>
                            isSelected
                              ? prev.filter(id => id !== trope.id)
                              : [...prev, trope.id]
                          )
                        }}
                        title={trope.description || trope.name}
                        className={`px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${
                          isSelected
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                            : "bg-white/[0.03] text-white/40 border-white/10 hover:border-white/20"
                        }`}
                      >
                        {isSelected ? "✓ " : ""}{trope.name}
                      </button>
                    )
                  })}
                </div>
                {selectedTropeIds.length === 0 && (
                  <p className="text-[10px] font-mono mt-2 text-white/30">
                    未选择桥段。选择桥段后，AI 将借鉴其情节结构和情感节奏来增强创作。
                  </p>
                )}
              </div>
            )}

            {/* 素材作用域 */}
            {selectedSeriesId && (
              <div>
                <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                  <Database className="w-3.5 h-3.5" />
                  素材作用域
                </label>
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    id="use-materials"
                    checked={useMaterials}
                    onChange={e => {
                      setUseMaterials(e.target.checked)
                      if (!e.target.checked) setSelectedMaterialIds([])
                    }}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500"
                  />
                  <label htmlFor="use-materials" className="text-sm text-white/70">
                    包含素材池中的投喂素材
                  </label>
                </div>
                {useMaterials && seriesMaterials && seriesMaterials.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {seriesMaterials.map(m => (
                      <label
                        key={m.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMaterialIds.includes(m.id)}
                          onChange={e => {
                            setSelectedMaterialIds(prev =>
                              e.target.checked
                                ? [...prev, m.id]
                                : prev.filter(id => id !== m.id)
                            )
                          }}
                          className="w-3.5 h-3.5 mt-0.5 rounded border-white/20 bg-white/5 text-amber-500 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-xs text-white/60 truncate">{m.title}</div>
                          <div className="text-[10px] text-white/50 font-mono mt-0.5">
                            {m.sourceType === "parallel_corpus" ? "平行语料" :
                             m.sourceType === "reference_novel" ? "参考小说" : "知识文档"}
                            {m.status === "indexed" ? " · 已索引" : m.status === "indexing" ? " · 索引中" : ""}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                {useMaterials && seriesMaterials && seriesMaterials.length === 0 && (
                  <p className="text-xs text-white/50 font-mono">该系列暂无素材</p>
                )}
              </div>
            )}

            {/* 创作要求 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                <PenTool className="w-3.5 h-3.5" />
                创作要求 (Brief)
              </label>
              <textarea
                value={brief}
                onChange={e => {
                  setBrief(e.target.value)
                  // 清除 warnings，因为用户正在修改 brief
                  if (warnings.length > 0) setWarnings([])
                }}
                placeholder="描述你想创作的内容，如：萧炎在魔兽山脉修炼时遇到一位神秘老者的故事"
                className="w-full h-32 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
              />
              {/* Brief 冲突警告 */}
              {warnings.length > 0 && (
                <div className="mt-3 space-y-2">
                  {warnings.map((w, i) => {
                    const charMatch = w.match(/"([^"]+)"/)
                    const charName = charMatch?.[1]
                    const char = characters?.find(c => c.name === charName)
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-amber-300 leading-relaxed">{w}</p>
                          {char && !selectedCharacterIds.includes(char.id) && (
                            <button
                              onClick={() => {
                                setSelectedCharacterIds(prev => [...prev, char.id])
                                // 移除已处理的 warning
                                setWarnings(prev => prev.filter((_, idx) => idx !== i))
                              }}
                              className="mt-1.5 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
                            >
                              + 添加 {char.name}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 用户自定义提示词 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                <Wand2 className="w-3.5 h-3.5" />
                自定义系统提示词 (可选)
              </label>
              <textarea
                value={userPrompt}
                onChange={e => setUserPrompt(e.target.value)}
                placeholder="追加到系统提示词的自定义指令，优先级最高。如：模仿金庸风格，多用环境描写..."
                className="w-full h-24 px-4 py-3 rounded-xl bg-white/5 border border-amber-500/20 focus:border-amber-500 outline-none text-[#FDFBF5] text-sm resize-none placeholder:text-white/40"
              />
            </div>

            {/* 参数滑块 */}
            <div className="space-y-5">
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70">
                <Thermometer className="w-3.5 h-3.5" />
                生成参数
              </label>

              <SliderControl
                label="创造力 (Temperature)"
                value={params.temperature}
                min={0}
                max={2}
                step={0.05}
                onChange={v => setParams(p => ({ ...p, temperature: v }))}
                description="值越高输出越发散有创意，越低越保守"
              />

              <SliderControl
                label="风格忠实度"
                value={params.styleFidelity}
                min={1}
                max={10}
                step={1}
                onChange={v => setParams(p => ({ ...p, styleFidelity: v }))}
                description="对原作写作风格的模仿程度"
              />

              <SliderControl
                label="RAG 检索条数"
                value={params.ragLimit}
                min={1}
                max={10}
                step={1}
                onChange={v => setParams(p => ({ ...p, ragLimit: v }))}
                description={
                  params.ragLimit <= 3
                    ? `保守模式：检索 ${params.ragLimit} 条，Token 占用少，适合短场景`
                    : params.ragLimit <= 6
                    ? `推荐模式：检索 ${params.ragLimit} 条，兼顾质量与效率（推荐）`
                    : `深度模式：检索 ${params.ragLimit} 条，参考更全面，适合长篇章或素材丰富的场景`
                }
              />

              <SliderControl
                label="角色忠诚度"
                value={params.characterLoyalty}
                min={1}
                max={10}
                step={1}
                onChange={v => setParams(p => ({ ...p, characterLoyalty: v }))}
                description="对角色设定卡的遵守严格程度"
              />
            </div>

            {/* 氛围选择 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                <Music className="w-3.5 h-3.5" />
                氛围
              </label>
              <div className="grid grid-cols-2 gap-2">
                {TONE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setParams(p => ({ ...p, tone: opt.value }))}
                    className={`px-3 py-2 rounded-xl text-sm transition-colors ${
                      params.tone === opt.value
                        ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                        : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 长度目标 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                <FileText className="w-3.5 h-3.5" />
                长度
              </label>
              <div className="flex gap-2">
                {[
                  { value: "short" as const, label: "短场景" },
                  { value: "chapter" as const, label: "完整章" },
                  { value: "arc" as const, label: "故事线" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setParams(p => ({ ...p, lengthTarget: opt.value }))}
                    className={`flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
                      params.lengthTarget === opt.value
                        ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                        : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 正史约束 */}
            <div>
              <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-white/70 mb-3">
                <Shield className="w-3.5 h-3.5" />
                正史约束
              </label>
              <div className="flex gap-2">
                {[
                  { value: "strict" as const, label: "严格" },
                  { value: "loose" as const, label: "宽松" },
                  { value: "au" as const, label: "AU" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setParams(p => ({ ...p, canonConstraint: opt.value }))}
                    className={`flex-1 px-3 py-2 rounded-xl text-sm transition-colors ${
                      params.canonConstraint === opt.value
                        ? "bg-amber-500/20 border border-amber-500/30 text-amber-400"
                        : "bg-white/5 border border-transparent hover:bg-white/10 text-white/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 生成按钮 */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !selectedSeriesId || !brief.trim()}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed text-[#111827] rounded-full font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  开始创作
                </>
              )}
            </button>
          </div>
        </aside>
      </div>

      {/* RAG 调用信息面板 */}
      {showRagPanel && ragCalls && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-500" />
                <h3 className="font-serif text-lg font-semibold">RAG 检索详情</h3>
              </div>
              <button onClick={() => setShowRagPanel(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/70 text-sm mb-4 font-mono">本次创作共检索到 {ragCalls.length} 条参考</p>
            <div className="space-y-3">
              {ragCalls.map((call, i) => (
                <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={
                      call.type === "novel_style" ? "text-amber-400 text-xs font-mono" :
                      call.type === "material" ? "text-green-400 text-xs font-mono" :
                      "text-blue-400 text-xs font-mono"
                    }>
                      {call.type === "novel_style" ? "原作风格" :
                       call.type === "material" ? "投喂素材" : "关键词检索"}
                    </span>
                    {call.score !== undefined && (
                      <span className="text-white/40 text-xs font-mono">相似度: {(call.score * 100).toFixed(1)}%</span>
                    )}
                    {call.sourceTitle && (
                      <span className="text-white/60 text-xs font-mono ml-auto">
                        📎 {call.sourceTitle}
                        {call.chapterNumber !== undefined ? ` · 第${call.chapterNumber}章` : ""}
                        {call.chunkIndex !== undefined && call.totalChunks !== undefined ? ` · 片段 ${call.chunkIndex + 1}/${call.totalChunks}` : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-white/80 text-sm line-clamp-4">{call.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 保存为风格样本对话框 */}
      {showStyleSampleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1F2937] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-lg font-semibold">保存为风格样本</h3>
              <button onClick={() => setShowStyleSampleModal(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-white/60 text-sm mb-4">将本次生成内容保存到素材池，作为风格样本反哺后续生成。</p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs text-white/50 font-mono mb-1">角色标签（可选）</label>
                <select
                  value={styleSampleCharacterTag}
                  onChange={e => setStyleSampleCharacterTag(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[#FDFBF5] text-sm outline-none focus:border-amber-500"
                >
                  <option value="">通用</option>
                  {characters?.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/50 font-mono mb-1">场景标签（可选）</label>
                <select
                  value={styleSampleSceneTag}
                  onChange={e => setStyleSampleSceneTag(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[#FDFBF5] text-sm outline-none focus:border-amber-500"
                >
                  <option value="">通用</option>
                  <option value="战斗描写">战斗描写</option>
                  <option value="对话">对话</option>
                  <option value="心理活动">心理活动</option>
                  <option value="环境描写">环境描写</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowStyleSampleModal(false)}
                className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm"
              >取消</button>
              <button
                onClick={() => {
                  if (!selectedSeriesId) return
                  saveAsStyleSampleMutation.mutate({
                    content,
                    seriesId: selectedSeriesId,
                    characterTag: styleSampleCharacterTag || undefined,
                    sceneTag: styleSampleSceneTag || undefined,
                    sourceWorkId: generatedWorkId || undefined,
                  })
                }}
                disabled={saveAsStyleSampleMutation.isPending}
                className="px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-[#111827] text-sm font-medium"
              >
                {saveAsStyleSampleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "确认保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 参数滑块组件
function SliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  description,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  description: string
}) {
  const percentage = ((value - min) / (max - min)) * 100

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-white/70">{label}</span>
        <span className="font-mono text-xs text-amber-500">{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <div className="relative">
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
      <p className="text-white/50 text-xs mt-1">{description}</p>
    </div>
  )
}
