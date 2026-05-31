/**
 * Annotation / Highlight Router
 * Supports text selection highlighting with notes
 */

import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { annotations } from "@db/schema"
import { eq } from "drizzle-orm"

export const annotationRouter = createRouter({
  list: publicQuery
    .input(z.object({ chapterId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      return db
        .select()
        .from(annotations)
        .where(eq(annotations.chapterId, input.chapterId))
        .orderBy(annotations.createdAt)
    }),

  create: publicQuery
    .input(z.object({
      novelId: z.number(),
      chapterId: z.number(),
      paragraphIndex: z.number(),
      startOffset: z.number(),
      endOffset: z.number(),
      selectedText: z.string().min(1),
      note: z.string().optional(),
      color: z.enum(["yellow", "green", "blue", "pink", "purple"]).default("yellow"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [annotation] = await db.insert(annotations).values(input).returning()
      return annotation
    }),

  update: publicQuery
    .input(z.object({
      id: z.number(),
      note: z.string().optional(),
      color: z.enum(["yellow", "green", "blue", "pink", "purple"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const { id, ...data } = input
      const [annotation] = await db
        .update(annotations)
        .set(data)
        .where(eq(annotations.id, id))
        .returning()
      return annotation
    }),

  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      await db.delete(annotations).where(eq(annotations.id, input.id))
      return { success: true }
    }),

  listByNovel: publicQuery
    .input(z.object({ novelId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb()
      return db
        .select()
        .from(annotations)
        .where(eq(annotations.novelId, input.novelId))
        .orderBy(annotations.createdAt)
    }),
})
