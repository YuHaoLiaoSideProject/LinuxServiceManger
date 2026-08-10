/**
 * RED phase — ConfirmModal details prop 擴充測試
 *
 * 測試 ConfirmModal.vue 新增的 optional details prop，
 * 用於批次確認對話框顯示受影響服務清單。
 *
 * 這些測試與既有的 src/__tests__/ConfirmModal.spec.ts 互補，
 * 專門測試批次相關的擴充功能。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ConfirmModal from '../ConfirmModal.vue'

// Mock i18n — 擴充 tMap 包含批次相關 key
vi.mock('../../composables/useI18n', () => ({
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

describe('ConfirmModal — details prop 擴充（批次操作）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountModal(props: { show: boolean; message: string; details?: string[] }) {
    return mount(ConfirmModal, { props })
  }

  // ── details prop 顯示測試 ──

  it('無 details prop 時不顯示 .modal-details 元素', () => {
    mountModal({
      show: true,
      message: '確定要停止 nginx.service 嗎？',
      // 不傳 details
    })

    const modal = document.body.querySelector('.lms-modal')
    expect(modal).toBeTruthy()
    const detailsEl = modal!.querySelector('.modal-details')
    // 尚未傳入 details 時，不應渲染 modal-details
    expect(detailsEl).toBeNull()
  })

  it('有 details prop 時顯示服務清單', () => {
    mountModal({
      show: true,
      message: '確定要啟動 3 個服務？',
      details: ['nginx.service', 'docker.service', 'cron.service'],
    })

    const modal = document.body.querySelector('.lms-modal')
    expect(modal).toBeTruthy()
    const detailsEl = modal!.querySelector('.modal-details')
    expect(detailsEl).toBeTruthy()
    expect(detailsEl!.textContent).toContain('nginx.service')
    expect(detailsEl!.textContent).toContain('docker.service')
    expect(detailsEl!.textContent).toContain('cron.service')
  })

  it('details 超過 5 個時顯示「...及其他 M 個」（由父層處理截斷）', () => {
    const names = [
      'nginx.service',
      'docker.service',
      'cron.service',
      'sshd.service',
      'redis.service',
      '...及其他 2 個',
    ]

    mountModal({
      show: true,
      message: `確定要重啟 7 個服務？`,
      details: names,
    })

    const modal = document.body.querySelector('.lms-modal')
    const detailsEl = modal!.querySelector('.modal-details')
    expect(detailsEl).toBeTruthy()
    expect(detailsEl!.textContent).toContain('...及其他 2 個')
    expect(detailsEl!.textContent).toContain('nginx.service')
    expect(detailsEl!.textContent).toContain('redis.service')
  })

  // ── 原有功能仍正常 ──

  it('有 details prop 時 message 仍正常顯示', () => {
    mountModal({
      show: true,
      message: '確定要停止 2 個服務？',
      details: ['nginx.service', 'docker.service'],
    })

    const modal = document.body.querySelector('.lms-modal')
    expect(modal!.querySelector('p')!.textContent).toContain('確定要停止 2 個服務')
  })

  it('有 details prop 時 confirm/cancel emits 仍正常運作', async () => {
    const wrapper = mountModal({
      show: true,
      message: '確定要停止 2 個服務？',
      details: ['nginx.service', 'docker.service'],
    })

    const confirmBtn = document.body.querySelector('.btn-danger') as HTMLButtonElement
    expect(confirmBtn).toBeTruthy()
    confirmBtn.click()
    expect(wrapper.emitted('confirm')).toBeTruthy()

    const cancelBtn = document.body.querySelector('.lms-modal button:not(.btn-danger)') as HTMLButtonElement
    cancelBtn.click()
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  // ── Restart action 中斷警告 ──

  it('Restart action 時應顯示中斷警告（透過 message prop 的 \\n 換行）', () => {
    const message = '確定要重啟 2 個服務？\n重啟會造成服務短暫中斷'

    mountModal({
      show: true,
      message,
      details: ['nginx.service', 'docker.service'],
    })

    const modal = document.body.querySelector('.lms-modal')
    // message 應包含中斷警告（透過 white-space: pre-line 換行顯示）
    expect(modal!.textContent).toContain('重啟會造成服務短暫中斷')
  })

  // ── visible=false 測試 ──

  it('show=false 時即使有 details 也不渲染', () => {
    mountModal({
      show: false,
      message: '確定要停止 2 個服務？',
      details: ['nginx.service', 'docker.service'],
    })

    expect(document.body.querySelector('.lms-modal-overlay')).toBeNull()
  })
})
