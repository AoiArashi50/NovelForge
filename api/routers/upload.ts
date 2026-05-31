/**
 * 文件上传处理器（Hono 路由，不走 tRPC）
 * 支持 txt/docx/pdf 上传，自动解析为章节
 */

import { Hono } from "hono"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { getDb } from "../queries/connection"
import { novels, chapters } from "@db/schema"
import { eq } from "drizzle-orm"
import { parseDocument } from "../services/parser"

const uploadApp = new Hono()

uploadApp.post("/", async (c) => {
  try {
    const body = await c.req.formData()

    const fileEntry = body.get("file")
    const title = (body.get("title") as string) || ""
    const author = (body.get("author") as string) || ""
    const originalLanguage = (body.get("originalLanguage") as string) || ""
    const novelIdStr = body.get("novelId") as string | null

    if (!fileEntry || typeof fileEntry === "string") {
      return c.json({ error: "No file provided" }, 400)
    }

    const file = fileEntry as unknown as { name: string; arrayBuffer(): Promise<ArrayBuffer> }

    // Ensure uploads directory exists
    const uploadsDir = join(process.cwd(), "uploads")
    mkdirSync(uploadsDir, { recursive: true })

    // Save file
    const fileName = `${Date.now()}_${file.name}`
    const filePath = join(uploadsDir, fileName)
    const buffer = Buffer.from(await file.arrayBuffer())
    writeFileSync(filePath, buffer)

    // Parse document
    const { chapters: parsedChapters } = await parseDocument(filePath)

    const db = getDb()
    let novelId: number

    if (novelIdStr) {
      // Append to existing novel
      novelId = parseInt(novelIdStr, 10)
      const existingChapters = await db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, novelId))

      const startNumber = existingChapters.length + 1

      for (let i = 0; i < parsedChapters.length; i++) {
        await db.insert(chapters).values({
          novelId,
          chapterNumber: startNumber + i,
          title: parsedChapters[i].title,
          contentOriginal: parsedChapters[i].content,
        })
      }
    } else {
      // Create new novel
      const [novel] = await db
        .insert(novels)
        .values({
          title: title || file.name.replace(/\.[^/.]+$/, ""),
          author: author || null,
          originalLanguage: originalLanguage || null,
          status: "unread",
          filePath,
        })
        .returning()

      novelId = novel.id

      for (const ch of parsedChapters) {
        await db.insert(chapters).values({
          novelId,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          contentOriginal: ch.content,
        })
      }
    }

    return c.json({
      novelId,
      chapterCount: parsedChapters.length,
      success: true,
    })
  } catch (error) {
    console.error("Upload error:", error)
    return c.json({ error: "Upload failed", detail: String(error) }, 500)
  }
})

export default uploadApp
