import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

// ConfigEditorModal（012 UIUX v2：桌面 shell）— 開啟 / Esc / backdrop / dirty 確認 / focus trap
// 以 stub 取代 ConfigEditorContent，focus trap 測試以真實 button 進行。

const { confirmLeaveMock } = vi.hoisted(() => ({
  confirmLeaveMock: vi.fn(),
}))

vi.mock('../ConfigEditorContent.vue', () => ({
  default: {
    name: 'ConfigEditorContent',
    props: ['serviceName', 'readOnly', 'titleId', 'variant'],
    emits: ['close'],
    template: `
      <div class="content-stub">
        <h2 :id="titleId">{{ serviceName }}</h2>
        <button class="inside-btn">inside button</button>
        <button class="inside-btn2">second button</button>
      </div>
    `,
    methods: {
      confirmLeave: confirmLeaveMock,
    },
  },
}))

import ConfigEditorModal from '../ConfigEditorModal.vue'
import { useConfigEditorModal } from '../../composables/useConfigEditorModal'

async function openAndWait(service = 'nginx.service', readOnly = false) {
  useConfigEditorModal().openModal(service, { readOnly })
  await nextTick()
  await nextTick()
  await flushPromises()
}

function dialog() {
  return document.body.querySelector('.config-modal-dialog') as HTMLElement | null
}

function dispatchKeydown(el: HTMLElement, init: KeyboardEventInit) {
  el.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
    ...init,
  }))
}

describe('ConfigEditorModal — 桌面 shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmLeaveMock.mockReset()
    confirmLeaveMock.mockResolvedValue(true)
    useConfigEditorModal().closeModal()
  })

  afterEach(() => {
    useConfigEditorModal().closeModal()
    document.body.innerHTML = ''
  })

  it('開啟後渲染 role=dialog + aria-modal + aria-labelledby', async () => {
    mount(ConfigEditorModal)
    await openAndWait('nginx.service')

    const dlg = dialog()
    expect(dlg).toBeTruthy()
    expect(dlg!.getAttribute('role')).toBe('dialog')
    expect(dlg!.getAttribute('aria-modal')).toBe('true')
    expect(dlg!.getAttribute('aria-labelledby')).toBe('config-editor-modal-title')
    expect(useConfigEditorModal().open.value).toBe(true)
  })

  it('開啟時背景捲動鎖定 + 焦點進入 dialog', async () => {
    mount(ConfigEditorModal)
    await openAndWait('nginx.service')

    expect(document.body.style.overflow).toBe('hidden')
    const dlg = dialog()
    expect(dlg).toBeTruthy()
    // 焦點落在 dialog 內第一個可聚焦元素
    expect(dlg!.contains(document.activeElement as Node)).toBe(true)
  })

  it('Esc 關閉（clean）', async () => {
    mount(ConfigEditorModal)
    await openAndWait()

    dispatchKeydown(dialog()!, { key: 'Escape' })
    await flushPromises()
    expect(useConfigEditorModal().open.value).toBe(false)
    expect(confirmLeaveMock).toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('')
  })

  it('backdrop 點擊關閉（clean）', async () => {
    mount(ConfigEditorModal)
    await openAndWait()

    const overlay = document.body.querySelector('.config-modal-overlay') as HTMLElement
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(useConfigEditorModal().open.value).toBe(false)
    expect(confirmLeaveMock).toHaveBeenCalled()
  })

  it('dirty 時 Esc 先問 confirmLeave（Stay → 不關閉）', async () => {
    confirmLeaveMock.mockResolvedValueOnce(false)
    mount(ConfigEditorModal)
    await openAndWait()

    dispatchKeydown(dialog()!, { key: 'Escape' })
    await flushPromises()
    expect(useConfigEditorModal().open.value).toBe(true)
  })

  it('dirty 時 Esc → Discard 確認後關閉', async () => {
    confirmLeaveMock.mockResolvedValueOnce(true)
    mount(ConfigEditorModal)
    await openAndWait()

    dispatchKeydown(dialog()!, { key: 'Escape' })
    await flushPromises()
    expect(useConfigEditorModal().open.value).toBe(false)
  })

  it('focus trap：Shift+Tab 從第一個元素繞回最後一個', async () => {
    mount(ConfigEditorModal)
    await openAndWait()

    const dlg = dialog()!
    const first = dlg.querySelector('.inside-btn') as HTMLElement
    const last = dlg.querySelector('.inside-btn2') as HTMLElement
    expect(document.activeElement).toBe(first)

    dispatchKeydown(dlg, { key: 'Tab', shiftKey: true })
    await nextTick()
    expect(document.activeElement).toBe(last)
  })

  it('focus trap：Tab 從最後一個元素繞回第一個', async () => {
    mount(ConfigEditorModal)
    await openAndWait()

    const dlg = dialog()!
    const first = dlg.querySelector('.inside-btn') as HTMLElement
    const last = dlg.querySelector('.inside-btn2') as HTMLElement
    last.focus()
    expect(document.activeElement).toBe(last)

    dispatchKeydown(dlg, { key: 'Tab' })
    await nextTick()
    expect(document.activeElement).toBe(first)
  })
})
