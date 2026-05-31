import { z } from "zod"
import { createRouter, publicQuery } from "../middleware"
import { getDb } from "../queries/connection"
import { series, characterCards, worldBibles, seriesCanon, materials } from "@db/schema"
import { eq, asc, inArray } from "drizzle-orm"
import { chatCompletion } from "../services/deepseek"

export const loreRouter = createRouter({
  // Series
  series: createRouter({
    list: publicQuery.query(async () => {
      const db = getDb()
      return db.select().from(series).orderBy(series.createdAt)
    }),

    create: publicQuery
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        universeName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [s] = await db.insert(series).values(input).returning()
        return s
      }),

    update: publicQuery
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        universeName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const { id, ...data } = input
        const [s] = await db.update(series).set(data).where(eq(series.id, id)).returning()
        return s
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb()
        await db.delete(series).where(eq(series.id, input.id))
        return { success: true }
      }),
  }),

  // Characters
  character: createRouter({
    list: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        return db
          .select()
          .from(characterCards)
          .where(eq(characterCards.seriesId, input.seriesId))
      }),

    create: publicQuery
      .input(z.object({
        seriesId: z.number(),
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        age: z.string().optional(),
        appearanceTags: z.array(z.string()).default([]),
        personalityTraits: z.array(z.string()).default([]),
        coreMotivations: z.string().optional(),
        relationships: z.record(z.any()).default({}),
        speechPatterns: z.string().optional(),
        taboos: z.array(z.string()).default([]),
        canonicalArcSummary: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [char] = await db.insert(characterCards).values(input).returning()
        return char
      }),

    update: publicQuery
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        age: z.string().optional(),
        appearanceTags: z.array(z.string()).optional(),
        personalityTraits: z.array(z.string()).optional(),
        coreMotivations: z.string().optional(),
        relationships: z.record(z.any()).optional(),
        speechPatterns: z.string().optional(),
        taboos: z.array(z.string()).optional(),
        canonicalArcSummary: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const { id, ...data } = input
        const [char] = await db
          .update(characterCards)
          .set(data)
          .where(eq(characterCards.id, id))
          .returning()
        return char
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb()
        await db.delete(characterCards).where(eq(characterCards.id, input.id))
        return { success: true }
      }),
  }),

  // World Bible
  worldBible: createRouter({
    get: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        const [wb] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, input.seriesId))
        return wb || null
      }),

    createOrUpdate: publicQuery
      .input(z.object({
        seriesId: z.number(),
        geography: z.string().optional(),
        magicSystem: z.string().optional(),
        technologyLevel: z.string().optional(),
        factions: z.array(z.any()).optional(),
        timelineEvents: z.array(z.any()).optional(),
        culturalCustoms: z.string().optional(),
        linguisticNotes: z.string().optional(),
        aspects: z.array(z.object({
          id: z.string(),
          name: z.string(),
          content: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const { seriesId, ...data } = input

        const [existing] = await db
          .select()
          .from(worldBibles)
          .where(eq(worldBibles.seriesId, seriesId))

        if (existing) {
          const [wb] = await db
            .update(worldBibles)
            .set(data)
            .where(eq(worldBibles.id, existing.id))
            .returning()
          return wb
        } else {
          const [wb] = await db
            .insert(worldBibles)
            .values({ seriesId, ...data })
            .returning()
          return wb
        }
      }),

    // 从素材中提取世界观
    extract: publicQuery
      .input(z.object({
        seriesId: z.number(),
        materialIds: z.array(z.number()).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()

        // 1. 获取素材内容
        let matRows: Array<typeof materials.$inferSelect> = []
        if (input.materialIds && input.materialIds.length > 0) {
          matRows = await db
            .select()
            .from(materials)
            .where(inArray(materials.id, input.materialIds))
        } else {
          matRows = await db
            .select()
            .from(materials)
            .where(eq(materials.seriesId, input.seriesId))
        }

        if (matRows.length === 0) {
          throw new Error("该系列暂无素材，请先上传素材")
        }

        // 2. 拼接素材（截断到约 15000 字符以留足 prompt 空间）
        const combined = matRows.map(m => `【${m.title}】\n${m.content}`).join("\n\n---\n\n")
        const truncated = combined.length > 15000 ? combined.slice(0, 15000) + "\n\n[素材已截断...]" : combined

        const systemPrompt = `你是一位资深的世界观分析专家。你的任务是从提供的素材中，自然地发现并提取这个世界观的设定。

重要原则：
1. 不要套用固定模板。从素材中"自然发现"值得记录的维度——每个世界的设定重点都不同。
2. 维度名称用中文，要具体、贴切。比如"斗气体系"比"力量体系"更好，"迦南学院制度"比"教育机构"更好。
3. 只提取素材中明确提及的内容，不要脑补。
4. 如果某个维度在素材中只有零星提及，可以标注"素材提及较少"。
5. 通常一个世界会有 5-10 个值得记录的维度，不要硬凑也不要遗漏。

必须返回严格的 JSON 格式，不要包含 markdown 代码块标记。`

        const userPrompt = `请从以下素材中提取世界观设定：

${truncated}

请返回以下 JSON 格式：
{
  "aspects": [
    { "name": "维度名称", "content": "详细描述" }
  ],
  "factions": [{"name": "势力名", "description": "描述"}],
  "timelineEvents": [{"order": 1, "description": "事件描述"}]
}`

        const response = await chatCompletion({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          maxTokens: 4000,
        })

        let jsonText = response.trim()
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim()
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(jsonText)
        } catch {
          const braceMatch = jsonText.match(/\{[\s\S]*\}/)
          if (braceMatch) {
            parsed = JSON.parse(braceMatch[0])
          } else {
            throw new Error("AI 返回的内容无法解析为 JSON")
          }
        }

        const resultSchema = z.object({
          aspects: z.array(z.object({
            name: z.string(),
            content: z.string(),
          })).default([]),
          factions: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
          timelineEvents: z.array(z.object({ order: z.number(), description: z.string() })).default([]),
        })

        const validated = resultSchema.parse(parsed)
        // 为每个 aspect 生成唯一 id
        const aspectsWithId = validated.aspects.map((a, i) => ({
          id: `aspect_${Date.now()}_${i}`,
          name: a.name,
          content: a.content,
        }))

        return {
          aspects: aspectsWithId,
          factions: validated.factions,
          timelineEvents: validated.timelineEvents,
        }
      }),
  }),

  // 从角色卡总结世界观
  summarizeWorld: publicQuery
    .input(z.object({
      characterIds: z.array(z.number()).min(1),
      seriesId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb()

      const chars = await db
        .select()
        .from(characterCards)
        .where(inArray(characterCards.id, input.characterIds))

      if (chars.length === 0) throw new Error("未找到角色")

      const [seriesInfo] = await db
        .select()
        .from(series)
        .where(eq(series.id, input.seriesId))

      const characterDescriptions = chars.map(c => {
        const parts: string[] = []
        parts.push(`姓名: ${c.name}`)
        if (c.aliases && (c.aliases as string[]).length > 0) parts.push(`别名: ${(c.aliases as string[]).join(", ")}`)
        if (c.age) parts.push(`年龄: ${c.age}`)
        if (c.appearanceTags && (c.appearanceTags as string[]).length > 0) parts.push(`外貌: ${(c.appearanceTags as string[]).join(", ")}`)
        if (c.personalityTraits && (c.personalityTraits as string[]).length > 0) parts.push(`性格: ${(c.personalityTraits as string[]).join(", ")}`)
        if (c.coreMotivations) parts.push(`核心动机: ${c.coreMotivations}`)
        if (c.speechPatterns) parts.push(`语言风格: ${c.speechPatterns}`)
        if (c.taboos && (c.taboos as string[]).length > 0) parts.push(`禁忌: ${(c.taboos as string[]).join(", ")}`)
        if (c.canonicalArcSummary) parts.push(`故事线: ${c.canonicalArcSummary}`)
        if (c.relationships && Object.keys(c.relationships as Record<string, unknown>).length > 0) {
          parts.push(`人际关系: ${JSON.stringify(c.relationships)}`)
        }
        return parts.join("\n")
      }).join("\n\n---\n\n")

      const systemPrompt = `你是一位资深的世界观架构师。你的任务是根据提供的角色卡信息，反向推导并总结出完整的世界观设定。

请从以下维度进行推理：
1. 地理环境：根据角色的活动范围、出身地、旅行路线等推断世界地理
2. 力量体系：根据角色的能力、修炼方式、战斗风格等推断力量/魔法体系
3. 科技水平：根据角色使用的工具、交通方式、生活方式等推断科技/文明水平
4. 文化习俗：根据角色的礼仪、节日、饮食习惯、婚丧嫁娶等推断文化
5. 语言/命名规则：根据角色姓名、地名、术语等推断语言体系
6. 派系势力：根据角色的归属、敌对关系、阵营等推断主要势力
7. 时间线事件：根据角色的经历推断世界历史上的重大事件

必须返回严格的 JSON 格式，不要包含 markdown 代码块标记。`

      const userPrompt = `请根据以下角色卡信息总结世界观设定：

系列名称: ${seriesInfo?.name || "未知系列"}
世界观名: ${seriesInfo?.universeName || ""}

角色卡信息：
${characterDescriptions}

请返回以下 JSON 格式：
{
  "geography": "地理环境描述",
  "magicSystem": "力量体系描述",
  "technologyLevel": "科技水平描述",
  "culturalCustoms": "文化习俗描述",
  "linguisticNotes": "语言/命名规则描述",
  "factions": [{"name": "派系名", "description": "描述"}],
  "timelineEvents": [{"order": 1, "description": "事件描述"}]
`

      const response = await chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        maxTokens: 4000,
      })

      let jsonText = response.trim()
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim()
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        const braceMatch = jsonText.match(/\{[\s\S]*\}/)
        if (braceMatch) {
          parsed = JSON.parse(braceMatch[0])
        } else {
          throw new Error("AI 返回的内容无法解析为 JSON")
        }
      }

      const resultSchema = z.object({
        geography: z.string().optional(),
        magicSystem: z.string().optional(),
        technologyLevel: z.string().optional(),
        culturalCustoms: z.string().optional(),
        linguisticNotes: z.string().optional(),
        factions: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
        timelineEvents: z.array(z.object({ order: z.number(), description: z.string() })).default([]),
      })

      const validated = resultSchema.parse(parsed)
      return validated
    }),

  // Canon
  canon: createRouter({
    list: publicQuery
      .input(z.object({ seriesId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb()
        return db
          .select()
          .from(seriesCanon)
          .where(eq(seriesCanon.seriesId, input.seriesId))
          .orderBy(asc(seriesCanon.eventOrder))
      }),

    create: publicQuery
      .input(z.object({
        seriesId: z.number(),
        eventOrder: z.number(),
        description: z.string().min(1),
        isImmutable: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const db = getDb()
        const [canon] = await db.insert(seriesCanon).values(input).returning()
        return canon
      }),

    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb()
        await db.delete(seriesCanon).where(eq(seriesCanon.id, input.id))
        return { success: true }
      }),
  }),
})
