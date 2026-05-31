import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { tags, novelTags } from "@db/schema"
import { eq, and } from "drizzle-orm"

export const tagRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb()
    return db.select().from(tags)
  }),

  create: publicQuery
    .input(z.object({
      name: z.string().min(1),
      parentId: z.number().optional(),
      color: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [tag] = await db.insert(tags).values(input).returning()
      return tag
    }),

  assign: publicQuery
    .input(z.object({
      novelId: z.number(),
      tagId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      const [nt] = await db.insert(novelTags).values(input).returning()
      return nt
    }),

  remove: publicQuery
    .input(z.object({
      novelId: z.number(),
      tagId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()
      await db
        .delete(novelTags)
        .where(and(eq(novelTags.novelId, input.novelId), eq(novelTags.tagId, input.tagId)))
      return { success: true }
    }),
})
