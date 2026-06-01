import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { vectorChunks, chapters, novels, ragFeedback } from "@db/schema"
import { eq } from "drizzle-orm"
import { indexNovel, searchSimilar } from "../services/embedder"

export const ragRouter = createRouter({
  search: publicQuery
    .input(z.object({
      query: z.string().min(1),
      novelId: z.number().optional(),
      seriesId: z.number().optional(),
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const results = await searchSimilar(input.query, {
        novelId: input.novelId,
        seriesId: input.seriesId,
        limit: input.limit,
      })
      return results
    }),

  indexNovel: publicQuery
    .input(z.object({
      novelId: z.number(),
      seriesId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const chapterList = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))

      const fullText = chapterList
        .map(ch => ch.contentOriginal)
        .filter(Boolean)
        .join("\n\n")

      if (!fullText) {
        return { chunkCount: 0 }
      }

      // 先删除旧索引
      await db
        .delete(vectorChunks)
        .where(eq(vectorChunks.novelId, input.novelId))

      // 获取小说标题
      const [novelInfo] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.novelId))

      // 创建新索引
      const result = await indexNovel(
        input.novelId,
        fullText,
        {
          seriesId: input.seriesId,
          sourceType: "reference",
          sourceTitle: novelInfo?.title || `novel_${input.novelId}`,
        }
      )

      return result
    }),

  // RAG 效果反馈闭环 — 用户评分
  feedback: publicQuery
    .input(z.object({
      generationId: z.number(),
      wasHelpful: z.boolean(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      // 找到该 generation 对应的所有 ragFeedback 记录，更新 wasHelpful
      await db.update(ragFeedback)
        .set({ wasHelpful: input.wasHelpful })
        .where(eq(ragFeedback.generationId, input.generationId))
      return { success: true }
    }),
})
