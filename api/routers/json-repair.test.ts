import { describe, it, expect } from "vitest"
import { tryFixTruncatedJson } from "../lib/json-utils"

describe("tryFixTruncatedJson", () => {
  it("完整 JSON 直接通过", () => {
    const json = '{"name": "萧炎", "age": "15岁"}'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe(json)
  })

  it("去除 markdown 代码块", () => {
    const json = '```json\n{"name": "萧炎"}\n```'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe('{"name": "萧炎"}')
  })

  it("去除多余文本保留 JSON", () => {
    const json = '这里是一些说明文字{"name": "萧炎", "age": "15岁"}更多说明'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe('{"name": "萧炎", "age": "15岁"}')
  })

  it("补全缺失的右花括号", () => {
    const json = '{"name": "萧炎", "age": "15岁"'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe('{"name": "萧炎", "age": "15岁"}')
  })

  it("补全嵌套对象缺失的括号", () => {
    const json = '{"name": "萧炎", "info": {"age": "15岁"'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe('{"name": "萧炎", "info": {"age": "15岁"}}')
  })

  it("补全数组缺失的右方括号", () => {
    const json = '{"names": ["萧炎", "萧薰儿"'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe('{"names": ["萧炎", "萧薰儿"]}')
  })

  it("去掉尾部逗号", () => {
    const json = '{"name": "萧炎",}'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe('{"name": "萧炎"}')
  })

  it("去掉数组尾部逗号", () => {
    const json = '{"names": ["萧炎", "萧薰儿",]}'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe('{"names": ["萧炎", "萧薰儿"]}')
  })

  it("未闭合字符串无法修复时返回 null", () => {
    const json = '{"name": "萧炎", "description": "这是一个很长的描述文字'
    const result = tryFixTruncatedJson(json)
    expect(result).toBeNull()
  })

  it("未闭合 key 无法修复时返回 null", () => {
    const json = '{"name": "萧炎", "desc'
    const result = tryFixTruncatedJson(json)
    expect(result).toBeNull()
  })

  it("复杂截断（未闭合字符串）返回 null", () => {
    const json = '{"characters": [{"name": "萧炎", "aliases": ["炎帝"], "coreMotivations": "成为最强者，保护家人'
    const result = tryFixTruncatedJson(json)
    expect(result).toBeNull()
  })

  it("完全无法修复返回 null", () => {
    const json = "这不是 JSON 格式"
    const result = tryFixTruncatedJson(json)
    expect(result).toBeNull()
  })

  it("空字符串返回 null", () => {
    const result = tryFixTruncatedJson("")
    expect(result).toBeNull()
  })

  it("只有左花括号修复为空对象", () => {
    const result = tryFixTruncatedJson("{")
    expect(result).toBe("{}")
  })

  it("多层嵌套截断（未闭合字符串）返回 null", () => {
    const json = '{"a": {"b": {"c": [1, 2, {"d": "value"'
    const result = tryFixTruncatedJson(json)
    expect(result).toBeNull()
  })

  it("多层嵌套缺失括号可修复", () => {
    const json = '{"a": {"b": {"c": [1, 2, 3]'
    const result = tryFixTruncatedJson(json)
    expect(result).toBe('{"a": {"b": {"c": [1, 2, 3]}}}')
  })
})
