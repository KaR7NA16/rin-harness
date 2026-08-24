/**
 * OS 级系统通知助手。
 *
 * 只在两件事同时满足时才真正发通知：
 *  1. WebView 窗口当前未聚焦（document.hasFocus() === false）
 *  2. 运行在 Tauri 桌面环境（否则 Tauri core call 安静失败）
 *
 * 失焦时弹 OS 通知是本轮 P0 需求的核心：用户切到别的窗口干活，
 * 却能第一时间知道后台的权限请求 / 回合完成 / 错误等事件。
 */

import { isTauriRuntime } from './desktopRuntime'
import { invoke } from './tauriCore'

let lastDedupKey = ''
let lastDedupAt = 0

/** 相同 key 在去重窗口内的内容会被丢弃，避免权限请求反复触发多条通知。 */
const DEDUP_WINDOW_MS = 2_000

/**
 * 窗口失焦时展示一条 OS 通知；聚焦时什么都不做。
 * @param title 通知标题（需为已翻译文案）
 * @param body 可选正文
 * @param dedupKey 可选去重键，防止同一事件在去重窗口内重复弹
 */
export async function notifyWhenUnfocused(
  title: string,
  body?: string,
  dedupKey?: string,
): Promise<void> {
  // 窗口保持聚焦时不需要 OS 通知 —— 用户正盯着 App。
  if (typeof document === 'undefined' || document.hasFocus() || !isTauriRuntime()) return

  if (dedupKey) {
    const now = Date.now()
    if (dedupKey === lastDedupKey && now - lastDedupAt < DEDUP_WINDOW_MS) return
    lastDedupKey = dedupKey
    lastDedupAt = now
  }

  try {
    // 用 Tauri core call 避开非 Tauri 环境（纯浏览器调试 / 单元测试）的硬依赖。
    await invoke('show_notification', { title, body: body ?? null })
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[osNotifications] show_notification failed:', err)
    }
  }
}