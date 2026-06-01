import { describe, it, expect } from "vitest"
import { splitIntoSemanticChunks, splitIntoFixedChunks } from "../lib/chunk-utils"

describe("splitIntoSemanticChunks", () => {
  it("短文本直接作为一个 chunk", () => {
    // 提供超过50字符的文本，避免被过滤器剔除
    const text = "这是一个短段落。它描述了一个角色的基本情况。角色名叫萧炎，是一个年轻的斗者。他有着坚定的意志和不屈的精神。"
    const chunks = splitIntoSemanticChunks(text, { sourceId: 1, sourceTitle: "测试" })
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toBe(text.trim())
    expect(chunks[0].chunkIndex).toBe(0)
    expect(chunks[0].totalChunks).toBe(1)
  })

  it("按章节分隔符拆分场景", () => {
    // 注意：分隔符匹配 `第X章` 后紧跟换行，标题文字需在下一行
    const text = `前言\n\n第一章\n萧炎缓缓睁开双眼。他感受到体内斗气流转。这是一个非常重要的时刻，标志着他修炼之路的开始。他站起身来，望向远方的山脉，心中充满了期待和决心。\n\n第二章\n他开始运转功法，吸收天地灵气。这是一个漫长而艰辛的过程，需要极大的耐心和毅力。每一次呼吸都让他感受到体内力量的增长，虽然微弱但确实在进步。\n`
    const chunks = splitIntoSemanticChunks(text, { sourceId: 1, sourceTitle: "测试" })
    expect(chunks.length).toBe(2)
    expect(chunks[0].content).toContain("萧炎")
    expect(chunks[1].content).toContain("功法")
    expect(chunks[0].chunkIndex).toBe(0)
    expect(chunks[1].chunkIndex).toBe(1)
  })

  it("长场景按句子边界切分", () => {
    // 构造一个超过 1500 字符的段落（每个句子约30字符，需要50+个句子）
    const sentences = Array.from({ length: 60 }, (_, i) => `这是第${i + 1}个句子，描述了故事情节的详细发展和人物关系的变化过程。`)
    const text = sentences.join("")
    expect(text.length).toBeGreaterThan(1500)

    const chunks = splitIntoSemanticChunks(text, { sourceId: 1, sourceTitle: "测试" })
    expect(chunks.length).toBeGreaterThan(1)

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThanOrEqual(50)
      expect(chunk.content.length).toBeLessThanOrEqual(1500)
    }
  })

  it("回填上下文", () => {
    const text = `
第一章
这是第一个场景的内容。它有一些描述，详细说明了故事的开端和主要人物的出场情况。这是一个非常重要的开篇，奠定了整个故事的基础。

第二章
这是第二个场景的内容。它有一些不同的描述，展示了情节的发展和冲突的产生。人物之间的关系开始变得复杂，故事进入了高潮前的铺垫阶段。

第三章
这是第三个场景的内容。它有一些更多的描述，揭示了最终的真相和结局。所有的伏笔都得到了回收，故事画上了一个圆满的句号。
`
    const chunks = splitIntoSemanticChunks(text, { sourceId: 1, sourceTitle: "测试" })
    expect(chunks.length).toBeGreaterThanOrEqual(2)

    expect(chunks[0].contextBefore).toBe("")
    expect(chunks[0].contextAfter).toBeTruthy()

    if (chunks.length >= 3) {
      expect(chunks[1].contextBefore).toBeTruthy()
      expect(chunks[1].contextAfter).toBeTruthy()
    }

    const last = chunks[chunks.length - 1]
    expect(last.contextAfter).toBe("")
  })

  it("忽略过短片段（<50字符）", () => {
    const text = `
第一章
这是一个足够长的场景描述，有很多内容和细节，远远超过五十个字符的过滤阈值，确保不会被错误过滤掉。

x

第二章
这是另一个足够长的场景描述，同样包含了非常丰富的内容和细节信息，字数肯定远远超过五十个字符的限制要求。
`
    const chunks = splitIntoSemanticChunks(text, { sourceId: 1, sourceTitle: "测试" })
    expect(chunks.length).toBe(2)
  })

  it("metadata 正确传递", () => {
    const text = "测试内容。这是一个足够长的描述，超过五十个字符以确保不会被过滤掉。这里再补充一些文字使其更加充实饱满，完全满足过滤条件。"
    const chunks = splitIntoSemanticChunks(text, {
      sourceId: 42,
      sourceTitle: "斗破苍穹",
      chapterNumber: 3,
    })
    expect(chunks[0].sourceId).toBe(42)
    expect(chunks[0].sourceTitle).toBe("斗破苍穹")
    expect(chunks[0].chapterNumber).toBe(3)
  })
})

describe("splitIntoFixedChunks", () => {
  it("基本切分", () => {
    const text = "a".repeat(1000)
    const chunks = splitIntoFixedChunks(text, 300, 50)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].length).toBe(300)
  })

  it("最后一块可能不足 chunkSize", () => {
    const text = "hello world"
    const chunks = splitIntoFixedChunks(text, 100, 20)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBe(text)
  })

  it("overlap 正确", () => {
    const text = "abcdefghijklmnopqrstuvwxyz"
    const chunks = splitIntoFixedChunks(text, 10, 5)
    expect(chunks[0]).toBe("abcdefghijklmnopqrstuvwxyz".slice(0, 10))
    expect(chunks[1]).toBe("abcdefghijklmnopqrstuvwxyz".slice(5, 15))
  })

  it("overlap >= chunkSize 时返回整个文本", () => {
    const text = "abc"
    const chunks = splitIntoFixedChunks(text, 10, 10)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBe("abc")
  })
})
