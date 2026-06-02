/**
 * 风格指纹提取服务
 * 从已有译文中提取量化风格特征，用于指导翻译风格一致性
 * 纯本地计算，零 API 额外成本
 */

import { getDb } from "../queries/connection"
import { chapters, novels, series } from "@db/schema"
import { eq, sql } from "drizzle-orm"

export interface StyleFingerprint {
  avgSentenceLength: number
  dialogueRatio: number
  commaDensity: number
  rhetoricPatterns: {
    parallel: number
    metaphor: number
    exaggeration: number
  }
  sampleChapters: number
  extractedAt: string
}

/**
 * 从指定小说的已翻译章节中提取风格指纹
 */
export async function extractStyleFingerprint(novelId: number): Promise<StyleFingerprint | null> {
  const db = getDb()

  const chapterList = await db
    .select({ contentTranslated: chapters.contentTranslated })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .limit(10)

  const allText = chapterList
    .map(c => c.contentTranslated)
    .filter((t): t is string => !!t && t.length > 0)
    .join("\n")

  if (allText.length < 500) return null

  return computeStyleFingerprint(allText, chapterList.length)
}

/**
 * 从文本中本地计算风格指纹（零 API 调用）
 */
export function computeStyleFingerprint(text: string, sampleChapters: number): StyleFingerprint {
  // 1. 句子分割（中文优先）
  const sentences = text
    .split(/[。！？.?!]\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0)

  const sentenceLengths = sentences.map(s => s.length)
  const avgSentenceLength = sentenceLengths.length > 0
    ? Math.round(sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length)
    : 0

  // 2. 对话占比（匹配中文引号、西文引号）
  const dialogueMatches = text.match(/[""''「『"'].+?[""''」』"']/g) || []
  const dialogueText = dialogueMatches.join("")
  const dialogueRatio = text.length > 0
    ? Math.round((dialogueText.length / text.length) * 100) / 100
    : 0

  // 3. 逗号密度
  const commaCount = (text.match(/，/g) || []).length
  const commaDensity = text.length > 0
    ? Math.round((commaCount / text.length) * 100) / 100
    : 0

  // 4. 修辞模式检测
  const rhetoricPatterns = {
    parallel: (text.match(/(?:不仅|不但|不只|不单).*?(?:而且|还|也|又)/g) || []).length,
    metaphor: (text.match(/(?:如同|仿佛|犹如|宛如|似若|好像|好比|就像)/g) || []).length,
    exaggeration: (text.match(/(?:千万|亿万|无数|永远|绝对|彻底|完全|极度|无比)/g) || []).length,
  }

  return {
    avgSentenceLength,
    dialogueRatio,
    commaDensity,
    rhetoricPatterns,
    sampleChapters,
    extractedAt: new Date().toISOString(),
  }
}

/**
 * 将风格指纹格式化为 prompt 指令文本
 */
export function buildStyleFingerprintInstruction(fp: StyleFingerprint): string {
  const parts: string[] = []
  parts.push("【原作风格参考】基于已有译文分析：")
  parts.push(`- 平均句长约 ${fp.avgSentenceLength} 字`)
  parts.push(`- 对话占比约 ${Math.round(fp.dialogueRatio * 100)}%`)

  if (fp.rhetoricPatterns.parallel > 5) {
    parts.push("- 善用递进句式（不仅……而且……）")
  }
  if (fp.rhetoricPatterns.metaphor > 10) {
    parts.push("- 善用比喻修辞")
  }
  if (fp.commaDensity > 0.05) {
    parts.push("- 句式舒缓，逗号使用较频繁")
  } else if (fp.commaDensity < 0.02) {
    parts.push("- 句式紧凑，短句为主")
  }

  return parts.join("\n")
}

/**
 * 更新系列的 styleFingerprint（异步，不阻塞主流程）
 */
export async function updateSeriesStyleFingerprint(seriesId: number): Promise<void> {
  const db = getDb()

  try {
    // 获取该系列下所有已翻译小说的最近一个
    const novelList = await db
      .select({ id: novels.id })
      .from(novels)
      .where(sql`${novels.seriesId} = ${seriesId} AND ${novels.status} = 'translated'`)
      .limit(1)

    if (novelList.length === 0) return

    const fingerprint = await extractStyleFingerprint(novelList[0].id)
    if (!fingerprint) return

    await db
      .update(series)
      .set({ styleFingerprint: fingerprint as unknown as Record<string, unknown> })
      .where(eq(series.id, seriesId))
  } catch {
    // 风格指纹更新失败不影响主流程
  }
}

/**
 * 基于原文和译文特征自动分类翻译风格
 * - literal: 译文长度 ≈ 原文，句法结构接近
 * - literary: 成语密度高、修辞多
 * - fluent: 默认
 */
export function autoClassifyTranslationStyle(
  sourceText: string,
  translatedText: string
): "literal" | "fluent" | "literary" {
  const sLen = sourceText.length
  const tLen = translatedText.length

  // 直译特征：译文长度 ≈ 原文长度
  const lengthRatio = sLen > 0 ? tLen / sLen : 1
  if (lengthRatio > 0.9 && lengthRatio < 1.2) {
    return "literal"
  }

  // 文学性特征：四字成语密度高、修辞多
  const idiomMatches = translatedText.match(/[一二三四五六七八九十百千万]+/g) || []
  const idiomDensity = tLen > 0 ? idiomMatches.length / tLen : 0
  const rhetoricMatches = (translatedText.match(/(?:如同|仿佛|犹如|宛如|似若|好比)/g) || []).length
  if (idiomDensity > 0.02 || rhetoricMatches > 3) {
    return "literary"
  }

  return "fluent"
}
