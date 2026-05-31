import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { chapters, bookmarks } from "@db/schema"
import { eq, asc } from "drizzle-orm"

export const chapterRouter = createRouter({
  list: publicQuery
    .input(z.object({ novelId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      return db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, input.novelId))
        .orderBy(asc(chapters.chapterNumber))
    }),

  getById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      const [chapter] = await db
        .select()
        .from(chapters)
        .where(eq(chapters.id, input.id))
      return chapter || null
    }),

  create: publicQuery
    .input(z.object({
      novelId: z.number(),
      chapters: z.array(z.object({
        chapterNumber: z.number(),
        title: z.string(),
        contentOriginal: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const created: typeof chapters.$inferSelect[] = []
      for (const ch of input.chapters) {
        const [createdChapter] = await db
          .insert(chapters)
          .values({
            novelId: input.novelId,
            chapterNumber: ch.chapterNumber,
            title: ch.title,
            contentOriginal: ch.contentOriginal,
          })
          .returning()
        created.push(createdChapter)
      }
      return created
    }),

  update: publicQuery
    .input(z.object({
      id: z.number(),
      contentTranslated: z.string().optional(),
      title: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const { id, ...data } = input
      const [chapter] = await db
        .update(chapters)
        .set(data)
        .where(eq(chapters.id, id))
        .returning()
      return chapter
    }),

  // Bookmarks
  bookmark: createRouter({
    list: publicQuery
      .input(z.object({ novelId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        return db
          .select()
          .from(bookmarks)
          .where(eq(bookmarks.novelId, input.novelId))
          .orderBy(asc(bookmarks.createdAt))
      }),

    create: publicQuery
      .input(z.object({
        novelId: z.number(),
        chapterId: z.number(),
        note: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [bm] = await db.insert(bookmarks).values(input).returning()
        return bm
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb()
        await db.delete(bookmarks).where(eq(bookmarks.id, input.id))
        return { success: true }
      }),
  }),
})
