import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('useToast — 通知', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('showToast("msg") 新增 success toast', async () => {
    const { useToast } = await import('../composables/useToast')
    const { toasts, showToast } = useToast()

    showToast('nginx 已啟動')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('nginx 已啟動')
    expect(toasts.value[0].type).toBe('success')
  })

  it('showToast("msg", "error") 新增 error toast', async () => {
    const { useToast } = await import('../composables/useToast')
    const { toasts, showToast } = useToast()

    showToast('操作失敗', 'error')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('操作失敗')
    expect(toasts.value[0].type).toBe('error')
  })

  it('每個 toast 有唯一 id', async () => {
    const { useToast } = await import('../composables/useToast')
    const { toasts, showToast } = useToast()

    showToast('msg1')
    showToast('msg2')
    showToast('msg3')

    expect(toasts.value).toHaveLength(3)
    const ids = toasts.value.map(t => t.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)
  })

  it('3.5 秒後 toast 自動移除 (使用 vi.useFakeTimers)', async () => {
    const { useToast } = await import('../composables/useToast')
    const { toasts, showToast } = useToast()

    showToast('msg1')
    showToast('msg2', 'error')

    expect(toasts.value).toHaveLength(2)

    // Advance time by 3500ms - both should be removed (same 3500ms timeout)
    await vi.advanceTimersByTimeAsync(3500)

    expect(toasts.value).toHaveLength(0)
  })

  it('多個 toast 各自在 3.5 秒後獨立移除', async () => {
    const { useToast } = await import('../composables/useToast')
    const { toasts, showToast } = useToast()

    showToast('first')
    
    // Advance 1 second, then add another toast
    await vi.advanceTimersByTimeAsync(1000)
    showToast('second')

    expect(toasts.value).toHaveLength(2)

    // After another 2.5s, first should be gone (total 3.5s for first)
    await vi.advanceTimersByTimeAsync(2500)

    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('second')

    // After another 1s, second should be gone (total 3.5s for second)
    await vi.advanceTimersByTimeAsync(1000)

    expect(toasts.value).toHaveLength(0)
  })
})
