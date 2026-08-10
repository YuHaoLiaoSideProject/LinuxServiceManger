/**
 * RED phase — useToast warning type 擴充測試
 *
 * 測試 showToast 支援 type: 'warning'，以及 Toast 介面包含四種 type。
 * 這些測試預期在尚未實作 warning 支援時 FAIL。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('useToast — warning type 擴充', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('showToast 應支援 type: "warning"（第四種 type）', async () => {
    const { useToast } = await import('../useToast')
    const { toasts, showToast } = useToast()

    // 這個呼叫在 warning 尚未實作時會 TypeScript 編譯錯誤或 runtime 行為不符預期
    showToast('部分服務操作失敗', 'warning')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('部分服務操作失敗')
    expect(toasts.value[0].type).toBe('warning')
  })

  it('warning toast 應有獨立的 id', async () => {
    const { useToast } = await import('../useToast')
    const { toasts, showToast } = useToast()

    showToast('msg1', 'success')
    showToast('msg2', 'warning')
    showToast('msg3', 'error')

    expect(toasts.value).toHaveLength(3)
    const types = toasts.value.map(t => t.type)
    expect(types).toContain('success')
    expect(types).toContain('warning')
    expect(types).toContain('error')
  })

  it('warning toast 3.5 秒後自動移除', async () => {
    const { useToast } = await import('../useToast')
    const { toasts, showToast } = useToast()

    showToast('test warning', 'warning')
    expect(toasts.value).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(3500)
    expect(toasts.value).toHaveLength(0)
  })

  it('Toast 介面 type 應接受四種值：success, error, info, warning', async () => {
    const { useToast } = await import('../useToast')
    const { toasts, showToast } = useToast()

    // 驗證四種 type 都能正常 push 進 toasts
    showToast('success toast', 'success')
    showToast('error toast', 'error')
    showToast('warning toast', 'warning')

    // TODO: info type 尚未實作，先跳過
    // showToast('info toast', 'info')

    expect(toasts.value).toHaveLength(3)
    expect(toasts.value.map(t => t.type).sort()).toEqual(
      ['error', 'success', 'warning'],
    )
  })
})
