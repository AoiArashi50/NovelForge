/**
 * 智能修复不完整的 JSON 字符串
 * AI 可能因 maxTokens 截断导致 JSON 未闭合，尝试补全
 */
export function tryFixTruncatedJson(text: string): string | null {
  let fixed = text.trim()

  // 1. 去除 markdown 代码块标记
  const codeBlockMatch = fixed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) fixed = codeBlockMatch[1].trim()

  // 2. 找到第一个 { 和最后一个 } 的包裹范围
  const firstBrace = fixed.indexOf("{")
  const lastBrace = fixed.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    fixed = fixed.slice(firstBrace, lastBrace + 1)
  }

  // 3. 尝试直接解析，成功则返回
  try {
    JSON.parse(fixed)
    return fixed
  } catch {
    // 继续修复
  }

  // 4. 统计未闭合的括号，尝试补全
  const openBraces = (fixed.match(/\{/g) || []).length
  const closeBraces = (fixed.match(/\}/g) || []).length
  const openBrackets = (fixed.match(/\[/g) || []).length
  const closeBrackets = (fixed.match(/\]/g) || []).length

  // 去掉尾部不完整的字符串（如果最后一个字符是引号内的内容）
  let result = fixed

  // 如果结尾在字符串中，回退到字符串开始之前
  const lastQuote = result.lastIndexOf('"')
  if (lastQuote !== -1) {
    const afterQuote = result.slice(lastQuote + 1).trim()
    // 如果引号后面没有 : 或 , 或 ] 或 }，说明字符串可能没结束
    if (afterQuote && !afterQuote.match(/^[\s:,\}\]]/)) {
      // 回退到这个引号之前
      result = result.slice(0, lastQuote)
      // 去掉尾部可能是 key 的部分
      const lastColon = result.lastIndexOf(":")
      if (lastColon !== -1) {
        const between = result.slice(lastColon + 1).trim()
        if (between === "" || between === "{") {
          // 保留
        } else {
          result = result.slice(0, lastColon)
        }
      }
    }
  }

  // 去掉尾部逗号（包括 ,} 和 ,] 前面的逗号）
  result = result.replace(/,(\s*[}\]])/g, "$1")
  result = result.replace(/,\s*$/, "")

  // 如果最后是一个 key:，去掉它
  const lastColon = result.lastIndexOf(":")
  if (lastColon !== -1) {
    const afterColon = result.slice(lastColon + 1).trim()
    if (afterColon === "" || (!afterColon.startsWith("{") && !afterColon.startsWith("[") && !afterColon.startsWith('"'))) {
      result = result.slice(0, lastColon)
      result = result.replace(/,\s*$/, "")
    }
  }

  // 补全缺失的 ] 和 }（顺序很重要：先闭合内层括号）
  const missingBrackets = openBrackets - closeBrackets
  const missingBraces = openBraces - closeBraces

  if (missingBrackets > 0) {
    result += "]".repeat(missingBrackets)
  }
  if (missingBraces > 0) {
    result += "}".repeat(missingBraces)
  }

  // 5. 最终尝试
  try {
    JSON.parse(result)
    return result
  } catch {
    return null
  }
}
