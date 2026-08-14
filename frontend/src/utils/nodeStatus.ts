// ── 014 Multi-Node — 節點狀態燈共用語彙（WCAG 1.4.1：色彩 + 文字雙重傳達）──
import type { NodeStatus } from '../types/node'

/** 狀態 → 文字標籤（與 UIUX §2 決策 3 / §7 一致） */
export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  online: '線上',
  degraded: '延遲',
  offline: '離線',
  long_offline: '長期離線',
  warning: '警告',
}

/** 狀態 → SVG 圓點顏色（8px；沿用 --lms-* token） */
export const NODE_DOT_COLORS: Record<NodeStatus, string> = {
  online: 'var(--lms-success)',
  degraded: 'var(--lms-warning)',
  warning: 'var(--lms-warning)',
  offline: 'var(--lms-danger)',
  long_offline: 'var(--lms-muted)',
}

export function statusLabel(status: string): string {
  return NODE_STATUS_LABELS[status as NodeStatus] ?? status
}

export function dotColor(status: string): string {
  return NODE_DOT_COLORS[status as NodeStatus] ?? 'var(--lms-muted)'
}
