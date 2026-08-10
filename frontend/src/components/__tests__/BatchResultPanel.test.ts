/**
 * RED phase — BatchResultPanel.vue 元件測試
 *
 * 測試批次結果面板的 props、emits、條件顯示邏輯。
 * 元件尚未建立，因此 import 會失敗 → 整個 test file 為 RED。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BatchResultPanel from '../BatchResultPanel.vue'

// ── 型別定義（後續移至 types/service.ts，目前定義在此供測試使用）──
interface BatchResult {
  name: string
  action: string
  result: 'success' | 'failure'
  error?: string
}

function makeResults(): BatchResult[] {
  return [
    { name: 'nginx.service', action: 'start', result: 'success' },
    { name: 'docker.service', action: 'start', result: 'failure', error: 'exit code 1' },
    { name: 'cron.service', action: 'start', result: 'success' },
  ]
}

function makeAllSuccess(): BatchResult[] {
  return [
    { name: 'nginx.service', action: 'start', result: 'success' },
    { name: 'cron.service', action: 'start', result: 'success' },
  ]
}

function makeAllFailure(): BatchResult[] {
  return [
    { name: 'docker.service', action: 'stop', result: 'failure', error: 'timeout' },
    { name: 'cron.service', action: 'stop', result: 'failure', error: 'permission denied' },
  ]
}

describe('BatchResultPanel — 批次結果面板', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('results 為空陣列時仍可正常渲染空白面板', () => {
    const wrapper = mount(BatchResultPanel, {
      props: { results: [] },
    })
    expect(wrapper.find('.batch-result-panel').exists()).toBe(true)
  })

  it('應列出每個服務的 result 狀態（success / failure）', () => {
    const wrapper = mount(BatchResultPanel, {
      props: { results: makeResults() },
    })
    const items = wrapper.findAll('.result-item')
    expect(items.length).toBe(3)
    // 成功項有 result-ok class
    expect(items[0].find('.result-ok').exists()).toBe(true)
    // 失敗項有 result-fail class
    expect(items[1].find('.result-fail').exists()).toBe(true)
    expect(items[2].find('.result-ok').exists()).toBe(true)
  })

  it('失敗服務應顯示 error 原因', () => {
    const wrapper = mount(BatchResultPanel, {
      props: { results: makeResults() },
    })
    const errorEl = wrapper.find('.result-error')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toBe('exit code 1')
  })

  it('全部成功時不應顯示錯誤資訊', () => {
    const wrapper = mount(BatchResultPanel, {
      props: { results: makeAllSuccess() },
    })
    expect(wrapper.find('.result-fail').exists()).toBe(false)
    expect(wrapper.find('.result-error').exists()).toBe(false)
  })

  it('全部失敗時應列出所有服務的錯誤', () => {
    const wrapper = mount(BatchResultPanel, {
      props: { results: makeAllFailure() },
    })
    const errors = wrapper.findAll('.result-error')
    expect(errors.length).toBe(2)
    expect(errors[0].text()).toBe('timeout')
    expect(errors[1].text()).toBe('permission denied')
  })

  // ── Emits 測試 ──

  it('點擊失敗服務的「重試」按鈕應 emit retry (payload: 服務名稱)', async () => {
    const wrapper = mount(BatchResultPanel, {
      props: { results: makeResults() },
    })
    const retryBtns = wrapper.findAll('.btn-retry')
    expect(retryBtns.length).toBeGreaterThanOrEqual(1)
    await retryBtns[0].trigger('click')
    expect(wrapper.emitted('retry')).toBeTruthy()
    expect(wrapper.emitted('retry')![0]).toEqual(['docker.service'])
  })

  it('點擊關閉按鈕應 emit dismiss', async () => {
    const wrapper = mount(BatchResultPanel, {
      props: { results: makeResults() },
    })
    const dismissBtn = wrapper.find('.btn-dismiss')
    expect(dismissBtn.exists()).toBe(true)
    await dismissBtn.trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })

  // ── 服務名稱顯示 ──

  it('應正確顯示服務名稱', () => {
    const wrapper = mount(BatchResultPanel, {
      props: { results: makeResults() },
    })
    const names = wrapper.findAll('.result-name')
    expect(names.length).toBe(3)
    expect(names[0].text()).toBe('nginx.service')
    expect(names[1].text()).toBe('docker.service')
    expect(names[2].text()).toBe('cron.service')
  })
})
