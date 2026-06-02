import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { auditLogs, novels, chapters, materials, fanFictionWorks } from "@db/schema"
import { eq, desc } from "drizzle-orm"

/**
 * 记录审计日志
 * 各 router 在关键操作前调用
 */
export async function logAudit(params: {
  action: string
  entityType: string
  entityId: number
  snapshot: Record<string, unknown>
  description?: string
}) {
  const db = getDb()
  try {
    await db.insert(auditLogs).values({
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      snapshot: params.snapshot as unknown as Record<string, unknown>,
      description: params.description,
    })
  } catch {
    // 审计日志失败不影响主流程
  }
}

export const auditRouter = createRouter({
  list: publicQuery
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      const db = getDb()
      return db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(input.limit)
    }),

  undo: publicQuery
    .input(z.object({ logId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.id, input.logId))

      if (!log) throw new Error("操作记录不存在")

      const snapshot = log.snapshot as Record<string, unknown>

      switch (log.action) {
        case "novel_delete": {
          // 恢复小说记录
          const novelData = snapshot as {
            novel: Record<string, unknown>
            chapters: Array<Record<string, unknown>>
          }
          const [restored] = await db
            .insert(novels)
            .values(novelData.novel as typeof novels.$inferInsert)
            .returning()

          if (novelData.chapters?.length > 0) {
            for (const ch of novelData.chapters) {
              await db.insert(chapters).values({
                ...ch,
                novelId: restored.id,
              } as typeof chapters.$inferInsert)
            }
          }
          return { success: true, restoredId: restored.id, entityType: "novel" }
        }

        case "chapter_update": {
          const chapterData = snapshot as Record<string, unknown>
          await db
            .update(chapters)
            .set({
              contentTranslated: chapterData.contentTranslated as string | undefined,
              title: chapterData.title as string | undefined,
            })
            .where(eq(chapters.id, log.entityId))
          return { success: true, restoredId: log.entityId, entityType: "chapter" }
        }

        case "material_delete": {
          const materialData = snapshot as Record<string, unknown>
          const [restored] = await db
            .insert(materials)
            .values(materialData as typeof materials.$inferInsert)
            .returning()
          return { success: true, restoredId: restored.id, entityType: "material" }
        }

        case "fanfiction_delete": {
          const workData = snapshot as Record<string, unknown>
          const [restored] = await db
            .insert(fanFictionWorks)
            .values(workData as typeof fanFictionWorks.$inferInsert)
            .returning()
          return { success: true, restoredId: restored.id, entityType: "fanfiction" }
        }

        default:
          throw new Error(`暂不支持的撤销操作: ${log.action}`)
      }
    }),
})
