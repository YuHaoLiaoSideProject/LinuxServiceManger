/**
 * RED phase — ChannelForm.vue 元件測試（F-CF-01 ~ F-CF-14）
 * 對應 docs/test-plans/013-webhook-notification測試計畫.md §3.2。
 * ChannelForm.vue 尚未建立 → import 失敗即為 RED。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

import ChannelForm from '../ChannelForm.vue'
import { useServiceStore } from '../../stores/service'
import type { Channel } from '../../types/notify'

function seedServices() {
  const store = useServiceStore()
  store.setServices([
    { name: 'nginx.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '' },
    { name: 'postgresql.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '' },
    { name: 'docker.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '' },
  ] as any)
}

async function mountForm(channel: Channel | null = null) {
  const wrapper = mount(ChannelForm, { props: { channel } })
  await flushPromises()
  return wrapper
}

async function selectType(wrapper: ReturnType<typeof mount>, value: string) {
  const select = wrapper.find('[data-testid="channel-type"]')
  await select.setValue(value)
}

describe('ChannelForm — 4 類型動態欄位（F-CF-01 ~ F-CF-05）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedServices()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-CF-01: Slack 顯示 Webhook URL 欄位，無 token/method/headers', async () => {
    const wrapper = await mountForm()
    await selectType(wrapper, 'slack')

    expect(wrapper.find('input[placeholder*="hooks.slack.com"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Bot Token')
    expect(wrapper.find('[data-testid="channel-method"]').exists()).toBe(false)
    expect(wrapper.find('.headers-editor').exists()).toBe(false)
  })

  it('F-CF-02: Discord 顯示 Webhook URL 欄位', async () => {
    const wrapper = await mountForm()
    await selectType(wrapper, 'discord')

    expect(wrapper.find('input[placeholder*="discord.com"]').exists()).toBe(true)
  })

  it('F-CF-03: Telegram 顯示 Bot Token + Chat ID，無 URL 欄位', async () => {
    const wrapper = await mountForm()
    await selectType(wrapper, 'telegram')

    expect(wrapper.text()).toContain('Bot Token')
    expect(wrapper.text()).toContain('Chat ID')
    expect(wrapper.find('input[placeholder*="hooks.slack.com"]').exists()).toBe(false)
  })

  it('F-CF-04: 自訂 Webhook 顯示 URL + Method 下拉 + headers 編輯器', async () => {
    const wrapper = await mountForm()
    await selectType(wrapper, 'custom')

    expect(wrapper.find('input[placeholder*="https://"]').exists()).toBe(true)
    const method = wrapper.find('[data-testid="channel-method"]')
    expect(method.exists()).toBe(true)
    expect(method.text()).toContain('POST')
    expect(method.text()).toContain('PUT')
    expect(wrapper.find('.headers-editor').exists()).toBe(true)
  })

  it('F-CF-05: 類型切換即時切換欄位', async () => {
    const wrapper = await mountForm()
    await selectType(wrapper, 'slack')
    expect(wrapper.find('input[placeholder*="hooks.slack.com"]').exists()).toBe(true)

    await selectType(wrapper, 'telegram')
    expect(wrapper.find('input[placeholder*="hooks.slack.com"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Bot Token')
  })
})

describe('ChannelForm — 驗證攔截（F-CF-06/07/10）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedServices()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-CF-06: 必填欄位空白攔截，不 emit save', async () => {
    const wrapper = await mountForm()
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(mockToast).toHaveBeenCalledWith('請填寫必要欄位')
  })

  it('F-CF-07: 未勾選觸發事件攔截', async () => {
    const wrapper = await mountForm()
    await selectType(wrapper, 'slack')
    await wrapper.find('input[placeholder*="hooks.slack.com"]').setValue('https://hooks.slack.com/services/x')
    await wrapper.find('input[placeholder*="Channel"]').setValue('名稱') // 名稱欄位（placeholder 可能不同）

    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('至少勾選一個觸發事件'))
  })

  it('F-CF-10: headers 超過 10 組拒絕', async () => {
    const wrapper = await mountForm()
    await selectType(wrapper, 'custom')
    await wrapper.find('input[placeholder*="https://"]').setValue('https://example.com/hook')
    // 加入 11 組 headers（點擊新增按鈕）
    const addBtn = wrapper.find('button[type="button"]')
    // 預設 1 行，加到 11 行
    for (let i = 0; i < 10; i++) {
      await addBtn.trigger('click')
    }

    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('最多 10 組'))
  })
})

describe('ChannelForm — 服務範圍（F-CF-08/09）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedServices()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-CF-09: 全部服務 radio 預設選中', async () => {
    const wrapper = await mountForm()
    const allRadio = wrapper.findAll('input[type="radio"]').find(r => (r.element as HTMLInputElement).value === 'true')
    expect(allRadio).toBeTruthy()
    expect((allRadio!.element as HTMLInputElement).checked).toBe(true)
  })

  it('F-CF-08: 指定服務範圍顯示搜尋與多選清單', async () => {
    const wrapper = await mountForm()
    const specificRadio = wrapper.findAll('input[type="radio"]').find(r => (r.element as HTMLInputElement).value === 'false')
    await specificRadio!.setValue()

    expect(wrapper.find('input[placeholder*="搜尋"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('nginx.service')
    expect(wrapper.text()).toContain('postgresql.service')
  })
})

describe('ChannelForm — 編輯預填與送出（F-CF-11/13）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedServices()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-CF-13: 編輯模式預填', async () => {
    const ch: Channel = {
      id: 'c1', type: 'slack', name: '團隊 Slack', url: 'https://hooks.slack.com/services/x',
      events: ['failed', 'started'], all_services: true, enabled: true,
      created_at: 'x', updated_at: 'x',
    }
    const wrapper = await mountForm(ch)

    expect((wrapper.find('input[placeholder*="hooks.slack.com"]').element as HTMLInputElement).value).toBe('https://hooks.slack.com/services/x')
    expect(wrapper.text()).toContain('團隊 Slack')
  })

  it('F-CF-11: 合法送出 emit save（payload 含型別與通用欄位）', async () => {
    const wrapper = await mountForm()
    await selectType(wrapper, 'slack')
    await wrapper.find('input[placeholder*="hooks.slack.com"]').setValue('https://hooks.slack.com/services/x')
    // 勾選第一個觸發事件
    const firstEvent = wrapper.find('input[type="checkbox"]')
    await firstEvent.setValue(true)

    await wrapper.find('form').trigger('submit')

    const emitted = wrapper.emitted('save')
    expect(emitted).toBeTruthy()
    const payload = emitted![0][0] as any
    expect(payload.type).toBe('slack')
    expect(payload.url).toBe('https://hooks.slack.com/services/x')
    expect(payload.events.length).toBeGreaterThanOrEqual(1)
  })
})
