import { BlockModel, InlineModel, ListItemBlock } from "../types"
import { inlineParse } from "./parse"

export type BlockMatchResult =
  | { type: 'keep'; inline: InlineModel[] }
  | { type: 'transform'; to: BlockModel }


export function matchListItem(
  text: string,
  block: ListItemBlock
): BlockMatchResult {
  // 无序列表
  console.log(text)
  if (!block.style.ordered) {
    if (text.startsWith('• ')) {
      return {
        type: 'keep',
        inline: inlineParse(text.slice(2)).inline
      }
    }

    return {
      type: 'transform',
      to: {
        id: block.id,
        type: 'paragraph',
        inline: inlineParse(text.trimStart()).inline
      }
    }
  }

  // 有序列表
  if (block.style.ordered) {
    const match = text.match(/^(\d+)\.\s+/)
    if (match) {
      return {
        type: 'keep',
        inline: inlineParse(text.slice(match[0].length)).inline
      }
    }

    return {
      type: 'transform',
      to: {
        id: block.id,
        type: 'paragraph',
        inline: inlineParse(text.trimStart()).inline
      }
    }
  }

  return { type: 'keep', inline: block.inline ?? [] }
}
