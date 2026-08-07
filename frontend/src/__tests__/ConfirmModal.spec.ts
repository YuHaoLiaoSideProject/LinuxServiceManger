import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ConfirmModal from '../components/ConfirmModal.vue'

// Mock i18n
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'modal.title': '⚠️ 確認操作',
        'modal.cancel': '取消',
        'modal.confirm': '確認',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

describe('ConfirmModal — 確認對話框', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    // Clean up teleported content
    document.body.innerHTML = ''
  })

  function mountModal(show: boolean, message: string) {
    return mount(ConfirmModal, {
      props: { show, message },
    })
  }

  it('顯示 Stop 確認訊息「確定要停止 {name} 嗎？」', () => {
    const stopMessage = '確定要停止 nginx.service 嗎？'
    mountModal(true, stopMessage)

    // Teleported to document.body
    const modal = document.body.querySelector('.lms-modal')
    expect(modal).toBeTruthy()
    expect(modal!.querySelector('h3')!.textContent).toBe('⚠️ 確認操作')
    expect(modal!.querySelector('p')!.textContent).toBe(stopMessage)
    expect(modal!.textContent).toContain('取消')
    expect(modal!.textContent).toContain('確認')
  })

  it('顯示 Restart 確認訊息「確定要重啟 {name} 嗎？」', () => {
    const restartMessage = '確定要重啟 nginx.service 嗎？'
    mountModal(true, restartMessage)

    const modal = document.body.querySelector('.lms-modal')
    expect(modal).toBeTruthy()
    expect(modal!.querySelector('p')!.textContent).toBe(restartMessage)
  })

  it('點擊取消 emit cancel', async () => {
    const wrapper = mountModal(true, '確定要停止 nginx.service 嗎？')

    // Query from document.body since it's teleported
    const cancelBtn = document.body.querySelector('.lms-modal button:not(.btn-danger)') as HTMLButtonElement
    expect(cancelBtn).toBeTruthy()
    expect(cancelBtn.textContent).toBe('取消')

    cancelBtn.click()
    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(wrapper.emitted('cancel')?.length).toBe(1)
  })

  it('點擊確認 emit confirm', async () => {
    const wrapper = mountModal(true, '確定要重啟 nginx.service 嗎？')

    const confirmBtn = document.body.querySelector('.btn-danger') as HTMLButtonElement
    expect(confirmBtn).toBeTruthy()
    expect(confirmBtn.textContent).toBe('確認')

    confirmBtn.click()
    expect(wrapper.emitted('confirm')).toBeTruthy()
    expect(wrapper.emitted('confirm')?.length).toBe(1)
  })

  it('visible=false 時不渲染', () => {
    mountModal(false, '確定要停止 nginx.service 嗎？')

    expect(document.body.querySelector('.lms-modal-overlay')).toBeNull()
    expect(document.body.querySelector('.lms-modal')).toBeNull()
  })

  it('點擊 overlay 背景 emit cancel', async () => {
    const wrapper = mountModal(true, '確定要停止 nginx.service 嗎？')

    const overlay = document.body.querySelector('.lms-modal-overlay') as HTMLDivElement
    expect(overlay).toBeTruthy()

    overlay.click()
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })
})
