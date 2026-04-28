// src/utils/tokenize
import { RawLine } from '../types';

export const uid = () => crypto.randomUUID();

export function tokenizeByLine(raw: string, oldId?: string): RawLine {  
  const leading = raw.match(/^[ \t]*/)?.[0] ?? '';

  return {
    id: oldId ?? uid(),
    raw,
    leading
  }
} 

/**
 * 检测一行是否是围栏代码块的起止标记（``` 或 ~~~）
 * 返回语言标注（仅对开启行有效），或 null 表示不是围栏标记
 */
function matchCodeFence(line: string): { marker: string; language: string } | null {
  const match = line.match(/^(`{3,}|~{3,})\s*(.*)$/)
  if (!match) return null
  return { marker: match[1], language: match[2].trim() }
}

export function initialTokenize(content: string): RawLine[] {
  const raws = content.split('\n')
  const result: RawLine[] = []

  let i = 0
  while (i < raws.length) {
    const fence = matchCodeFence(raws[i])
    if (fence) {
      // 找到围栏代码块开启标记，搜索对应的关闭标记
      const openMarkerChar = fence.marker[0]
      const openMarkerLen = fence.marker.length
      const language = fence.language
      const codeLines: string[] = []
      let j = i + 1
      let closed = false

      while (j < raws.length) {
        const closeFence = matchCodeFence(raws[j])
        if (closeFence && closeFence.marker[0] === openMarkerChar && closeFence.marker.length >= openMarkerLen && closeFence.language === '') {
          // 找到匹配的关闭标记
          closed = true
          j++
          break
        }
        codeLines.push(raws[j])
        j++
      }

      if (closed) {
        // 将整个围栏代码块合并为一个特殊的 RawLine
        // raw 格式：```language\ncode_line1\ncode_line2\n```
        const fullRaw = raws[i] + '\n' + codeLines.join('\n') + '\n' + raws[j - 1]
        result.push({ id: uid(), raw: fullRaw, leading: '' })
        i = j
      } else {
        // 没有找到关闭标记，当作普通行处理
        result.push(tokenizeByLine(raws[i]))
        i++
      }
    } else {
      result.push(tokenizeByLine(raws[i]))
      i++
    }
  }

  return result
}
