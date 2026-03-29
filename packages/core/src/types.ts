export const enum INLINE_FLAG {
  BOLD = 1 << 0,
  ITALIC = 1 << 1,
  HIGHLIGHT = 1 << 2,
  STRIKE = 1 << 3,
  CODE = 1 << 4
}

export const enum BlockVisualState {
  active = 1 << 0,
  dirty = 1 << 2
}

export type RawLine = {
	id: string,
	raw: string,
	leading: string,
}

export type InlineModel =
  | TextInline
  | LinkInline

export type TextInline = {
  type: 'text'
  text: string
  marks: number
  offset: number
  dirty: boolean
}

export type LinkInline = {
  type: 'link'
  children: InlineModel[]
  href: string
  marks: number
  offset: number
  dirty: boolean
}

export type BlockModel = {
  id: string
  type: 'paragraph' | 'list-item' | 'heading' | 'table' | 'image' | 'card' | 'blank'
  nesting?: number     // 缩进/嵌套
  inline?: InlineModel[]     // 对应文字内容
  children?: BlockModel[]     // 嵌套元素，例如表格行、列表子项
  meta?: any        // 图片 URL / 卡片数据 / 表格属性
}

export interface HeadingBlock extends BlockModel {
  id: string
  type: 'heading'
  headingDepth: number
}

export interface ListItemBlock extends BlockModel {
  id: string
  type: 'list-item'
  style: {
    ordered: true,
    order: string
  } | {
    ordered: false
  }
}

export interface DivideUnit {
  node: Node
  offset: number
  type?: string
}