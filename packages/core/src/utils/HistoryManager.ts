import { BlockModel } from '../types'

/**
 * 光标位置信息，用于 Undo/Redo 后恢复光标
 */
export interface CursorInfo {
  /** 光标所在的 block ID */
  blockId: string
  /** 偏移量 */
  offset: number
  /** 是否为展开模式下的 raw offset（包含标记符） */
  isRawOffset: boolean
}

/**
 * 历史快照：记录某一时刻所有 blocks 的状态
 * 使用 JSON 深拷贝实现不可变快照
 */
export interface HistorySnapshot {
  /** blocks 的序列化快照（Map 转为 [id, block][] 数组） */
  blocks: [string, BlockModel][]
  /** 快照时间戳 */
  timestamp: number
  /** 光标位置信息 */
  cursor: CursorInfo | null
}

/**
 * 编辑器历史管理器
 * 支持 Undo / Redo 操作
 * 
 * 设计思路：
 * - 每次编辑操作前，保存当前 blocks 状态的深拷贝快照
 * - Undo: 从 undoStack 弹出上一个快照，将当前状态压入 redoStack，恢复快照
 * - Redo: 从 redoStack 弹出下一个快照，将当前状态压入 undoStack，恢复快照
 * - 新的编辑操作会清空 redoStack（分支历史不保留）
 */
export class HistoryManager {
  private undoStack: HistorySnapshot[] = []
  private redoStack: HistorySnapshot[] = []
  private maxStackSize: number

  constructor(maxStackSize: number = 100) {
    this.maxStackSize = maxStackSize
  }

  /**
   * 保存当前状态快照（在每次编辑操作前调用）
   * @param blocks 当前 blocks 状态
   * @param cursor 当前光标位置信息
   */
  pushSnapshot(blocks: Map<string, BlockModel>, cursor?: CursorInfo | null): void {
    const snapshot = this.createSnapshot(blocks, cursor ?? null)
    this.undoStack.push(snapshot)

    // 限制栈大小，防止内存泄漏
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift()
    }

    // 新的编辑操作清空 redo 栈
    this.redoStack = []
  }

  /**
   * 执行 Undo 操作
   * @param currentBlocks 当前 blocks 状态
   * @param currentCursor 当前光标位置
   * @returns 恢复后的快照（包含 blocks 和 cursor），或 null（无可撤销操作）
   */
  undo(currentBlocks: Map<string, BlockModel>, currentCursor?: CursorInfo | null): HistorySnapshot | null {
    if (this.undoStack.length === 0) return null

    // 将当前状态压入 redo 栈
    const currentSnapshot = this.createSnapshot(currentBlocks, currentCursor ?? null)
    this.redoStack.push(currentSnapshot)

    // 弹出上一个快照
    return this.undoStack.pop()!
  }

  /**
   * 执行 Redo 操作
   * @param currentBlocks 当前 blocks 状态
   * @param currentCursor 当前光标位置
   * @returns 恢复后的快照（包含 blocks 和 cursor），或 null（无可重做操作）
   */
  redo(currentBlocks: Map<string, BlockModel>, currentCursor?: CursorInfo | null): HistorySnapshot | null {
    if (this.redoStack.length === 0) return null

    // 将当前状态压入 undo 栈
    const currentSnapshot = this.createSnapshot(currentBlocks, currentCursor ?? null)
    this.undoStack.push(currentSnapshot)

    // 弹出下一个快照
    return this.redoStack.pop()!
  }

  /**
   * 是否可以撤销
   */
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /**
   * 是否可以重做
   */
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * 创建 blocks 的深拷贝快照
   */
  private createSnapshot(blocks: Map<string, BlockModel>, cursor: CursorInfo | null): HistorySnapshot {
    const entries: [string, BlockModel][] = []
    blocks.forEach((block, id) => {
      entries.push([id, JSON.parse(JSON.stringify(block))])
    })
    return {
      blocks: entries,
      timestamp: Date.now(),
      cursor
    }
  }
}
