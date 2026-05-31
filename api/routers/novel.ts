import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { novels, chapters, novelTags, tags, materials } from "@db/schema"
import { eq, desc, like } from "drizzle-orm"

export const novelRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb()
    return db.select().from(novels).orderBy(desc(novels.createdAt))
  }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [novel] = await db
        .select()
        .from(novels)
        .where(eq(novels.id, input.id))
      return novel || null
    }),

  create: publicQuery
    .input(z.object({
      title: z.string().min(1),
      author: z.string().optional(),
      originalLanguage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [novel] = await db
        .insert(novels)
        .values(input)
        .returning()
      return novel
    }),

  update: publicQuery
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      author: z.string().optional(),
      status: z.enum(["unread", "reading", "translated", "completed"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const { id, ...data } = input
      const [novel] = await db
        .update(novels)
        .set(data)
        .where(eq(novels.id, id))
        .returning()
      return novel
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      // 先删除关联章节
      await db.delete(chapters).where(eq(chapters.novelId, input.id))
      await db.delete(novelTags).where(eq(novelTags.novelId, input.id))
      await db.delete(novels).where(eq(novels.id, input.id))
      return { success: true }
    }),

  search: publicQuery
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const db = getDb()
      return db
        .select()
        .from(novels)
        .where(like(novels.title, `%${input.query}%`))
    }),

  importFromMaterial: publicQuery
    .input(z.object({ materialId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [material] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, input.materialId))

      if (!material) throw new Error("素材不存在")
      if (!material.content) throw new Error("素材内容为空")

      // 创建小说记录
      const [novel] = await db
        .insert(novels)
        .values({
          title: material.title,
          status: "unread",
          metadata: { importedFromMaterialId: material.id },
        })
        .returning()

      // 按章节分割内容（每章约 8000 字，优先按段落边界分割）
      const content = material.content
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
      const chapterInputs: Array<{ chapterNumber: number; title: string; contentOriginal: string }> = []
      let currentChunk = ""
      let chapterNum = 1
      const targetSize = 8000

      for (const para of paragraphs) {
        if (currentChunk.length + para.length > targetSize && currentChunk.length > 0) {
          chapterInputs.push({
            chapterNumber: chapterNum++,
            title: `第${chapterNum - 1}章`,
            contentOriginal: currentChunk.trim(),
          })
          currentChunk = para
        } else {
          currentChunk += (currentChunk ? "\n\n" : "") + para
        }
      }
      if (currentChunk.trim().length > 0) {
        chapterInputs.push({
          chapterNumber: chapterNum++,
          title: `第${chapterNum - 1}章`,
          contentOriginal: currentChunk.trim(),
        })
      }

      // 如果内容很短（不足一章），仍然创建一章
      if (chapterInputs.length === 0 && content.trim().length > 0) {
        chapterInputs.push({
          chapterNumber: 1,
          title: "第1章",
          contentOriginal: content.trim(),
        })
      }

      for (const ch of chapterInputs) {
        await db.insert(chapters).values({
          novelId: novel.id,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          contentOriginal: ch.contentOriginal,
        })
      }

      return { novelId: novel.id, chapterCount: chapterInputs.length }
    }),

  // 批量导入素材为小说
  importMaterials: publicQuery
    .input(z.object({ materialIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const results: Array<{ materialId: number; novelId: number; chapterCount: number }> = []

      for (const materialId of input.materialIds) {
        const [material] = await db
          .select()
          .from(materials)
          .where(eq(materials.id, materialId))

        if (!material || !material.content) continue

        // 创建小说记录
        const [novel] = await db
          .insert(novels)
          .values({
            title: material.title,
            status: "unread",
            metadata: { importedFromMaterialId: material.id },
          })
          .returning()

        // 按章节分割内容
        const content = material.content
        const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
        const chapterInputs: Array<{ chapterNumber: number; title: string; contentOriginal: string }> = []
        let currentChunk = ""
        let chapterNum = 1
        const targetSize = 8000

        for (const para of paragraphs) {
          if (currentChunk.length + para.length > targetSize && currentChunk.length > 0) {
            chapterInputs.push({
              chapterNumber: chapterNum++,
              title: `第${chapterNum - 1}章`,
              contentOriginal: currentChunk.trim(),
            })
            currentChunk = para
          } else {
            currentChunk += (currentChunk ? "\n\n" : "") + para
          }
        }
        if (currentChunk.trim().length > 0) {
          chapterInputs.push({
            chapterNumber: chapterNum++,
            title: `第${chapterNum - 1}章`,
            contentOriginal: currentChunk.trim(),
          })
        }
        if (chapterInputs.length === 0 && content.trim().length > 0) {
          chapterInputs.push({
            chapterNumber: 1,
            title: "第1章",
            contentOriginal: content.trim(),
          })
        }

        for (const ch of chapterInputs) {
          await db.insert(chapters).values({
            novelId: novel.id,
            chapterNumber: ch.chapterNumber,
            title: ch.title,
            contentOriginal: ch.contentOriginal,
          })
        }

        results.push({ materialId, novelId: novel.id, chapterCount: chapterInputs.length })
      }

      return { imported: results.length, results }
    }),

  // Tag operations
  tags: publicQuery
    .input(z.object({ novelId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      return db
        .select({
          tagId: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(novelTags)
        .innerJoin(tags, eq(tags.id, novelTags.tagId))
        .where(eq(novelTags.novelId, input.novelId))
    }),

  tagMap: publicQuery.query(async () => {
    const db = getDb()
    return db.select().from(novelTags)
  }),
})
