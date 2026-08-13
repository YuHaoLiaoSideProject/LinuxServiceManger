/**
 * ChannelForm.vue 元件測試（F-CF-01 ~ F-CF-17）
 * 對應 docs/test-plans/013-webhook-notification測試計畫.md §3.2。
 *
 * ChannelForm 以 <Teleport to="body"> 渲染 Modal（§4.2），
 * 故測試一律透過 document.body 查詢 teleported DOM（同 ConfirmModal 測試慣例）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
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
    { name: 'systemd-journald.service', load: 'loaded', active: 'active', sub: 'running', locked: true, unitFileState: 'static', fragmentPath: '/usr/lib/systemd/system/systemd-journald.service' },
  ] as any)
}

// ── DOM 輔助（Teleport to body → 查詢 document.body）──
function q<T extends Element = Element>(sel: string): T {
  const el = document.body.querySelector<T>(sel)
  if (!el) throw new Error(`querySelector("${sel}") returned null`)
  return el
}

function qAll<T extends Element = Element>(sel: string): T[] {
  return Array.from(document.body.querySelectorAll<T>(sel))
}

async function selectType(value: string): Promise<void> {
  const select = q<HTMLSelectElement>('[data-testid="channel-type"]')
  select.value = value
  select.dispatchEvent(new Event('change'))
  await nextTick()
}

async function setValue(sel: string, value: string): Promise<void> {
  const el = q<HTMLInputElement | HTMLSelectElement>(sel)
  el.value = value
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'))
  await nextTick()
}

async function setChecked(sel: string, checked: boolean): Promise<void> {
  const el = q<HTMLInputElement>(sel)
  el.checked = checked
  el.dispatchEvent(new Event('change'))
  await nextTick()
}

async function setRadio(value: string): Promise<void> {
  const radio = qAll<HTMLInputElement>('input[type="radio"]').find(r => r.value === value)
  if (!radio) throw new Error(`radio[value="${value}"] not found`)
  radio.checked = true
  radio.dispatchEvent(new Event('change'))
  await nextTick()
}

async function submitForm(): Promise<void> {
  const form = q<HTMLFormElement>('form')
  form.dispatchEvent(new Event('submit', { cancelable: true }))
  await nextTick()
}

// 記錄所有已 mount 的 wrapper，統一在 afterEach unmount：
// ChannelForm 會在 document 上掛 keydown 監聽器，若不卸載會跨測試殘留，
// 導致 Escape 測試（dispatch 到 document）觸發前一個測試的元件。
const mountedWrappers: Array<{ unmount: () => void }> = []

async function mountForm(channel: Channel | null = null) {
  const wrapper = mount(ChannelForm, { props: { channel } })
  mountedWrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

afterEach(() => {
  mountedWrappers.splice(0).forEach(w => w.unmount())
  document.body.innerHTML = ''
})

describe('ChannelForm — 4 類型動態欄位（F-CF-01 ~ F-CF-05）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedServices()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-CF-01: Slack 顯示 Webhook URL 欄位，無 token/method/headers', async () => {
    await mountForm()
    await selectType('slack')

    expect(document.body.querySelector('input[placeholder*="hooks.slack.com"]')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Bot Token')
    expect(document.body.querySelector('[data-testid="channel-method"]')).toBeNull()
    expect(document.body.querySelector('.headers-editor')).toBeNull()
  })

  it('F-CF-02: Discord 顯示 Webhook URL 欄位', async () => {
    await mountForm()
    await selectType('discord')

    expect(document.body.querySelector('input[placeholder*="discord.com"]')).toBeTruthy()
  })

  it('F-CF-03: Telegram 顯示 Bot Token + Chat ID，無 URL 欄位', async () => {
    await mountForm()
    await selectType('telegram')

    expect(document.body.textContent).toContain('Bot Token')
    expect(document.body.textContent).toContain('Chat ID')
    expect(document.body.querySelector('input[placeholder*="hooks.slack.com"]')).toBeNull()
  })

  it('F-CF-04: 自訂 Webhook 顯示 URL + Method 下拉 + headers 編輯器', async () => {
    await mountForm()
    await selectType('custom')

    expect(document.body.querySelector('input[placeholder*="https://"]')).toBeTruthy()
    const method = document.body.querySelector('[data-testid="channel-method"]')
    expect(method).toBeTruthy()
    expect(method!.textContent).toContain('POST')
    expect(method!.textContent).toContain('PUT')
    expect(document.body.querySelector('.headers-editor')).toBeTruthy()
  })

  it('F-CF-05: 類型切換即時切換欄位', async () => {
    await mountForm()
    await selectType('slack')
    expect(document.body.querySelector('input[placeholder*="hooks.slack.com"]')).toBeTruthy()

    await selectType('telegram')
    expect(document.body.querySelector('input[placeholder*="hooks.slack.com"]')).toBeNull()
    expect(document.body.textContent).toContain('Bot Token')
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
    await submitForm()

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(mockToast).toHaveBeenCalledWith('請填寫必要欄位')
  })

  it('F-CF-07: 未勾選觸發事件攔截', async () => {
    const wrapper = await mountForm()
    await selectType('slack')
    await setValue('input[placeholder*="hooks.slack.com"]', 'https://hooks.slack.com/services/x')
    await setValue('input[placeholder*="Channel"]', '名稱')

    await submitForm()

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('至少勾選一個觸發事件'))
  })

  it('F-CF-10: headers 超過 10 組拒絕', async () => {
    const wrapper = await mountForm()
    await selectType('custom')
    await setValue('input[placeholder*="https://"]', 'https://example.com/hook')
    // 預設 1 行，加到 11 行
    const addBtn = q<HTMLButtonElement>('[data-testid="header-add"]')
    for (let i = 0; i < 10; i++) addBtn.click()
    await nextTick()

    await submitForm()

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
    await mountForm()
    const allRadio = qAll<HTMLInputElement>('input[type="radio"]').find(r => r.value === 'true')
    expect(allRadio).toBeTruthy()
    expect(allRadio!.checked).toBe(true)
  })

  it('F-CF-08: 指定服務範圍顯示搜尋與多選清單', async () => {
    await mountForm()
    await setRadio('false')

    expect(document.body.querySelector('input[placeholder*="搜尋"]')).toBeTruthy()
    expect(document.body.textContent).toContain('nginx.service')
    expect(document.body.textContent).toContain('postgresql.service')
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
    await mountForm(ch)

    expect((q<HTMLInputElement>('input[placeholder*="hooks.slack.com"]')).value).toBe('https://hooks.slack.com/services/x')
    expect(document.body.textContent).toContain('團隊 Slack')
  })

  it('F-CF-11: 合法送出 emit save（payload 含型別與通用欄位）', async () => {
    const wrapper = await mountForm()
    await selectType('slack')
    await setValue('input[placeholder*="hooks.slack.com"]', 'https://hooks.slack.com/services/x')
    // 勾選第一個觸發事件
    await setChecked('input[type="checkbox"]', true)

    await submitForm()

    const emitted = wrapper.emitted('save')
    expect(emitted).toBeTruthy()
    const payload = emitted![0][0] as any
    expect(payload.type).toBe('slack')
    expect(payload.url).toBe('https://hooks.slack.com/services/x')
    expect(payload.events.length).toBeGreaterThanOrEqual(1)
  })

  it('F-CF-17: 編輯 Telegram 不預填 masked token，留空即保留原值', async () => {
    const ch: Channel = {
      id: 'c1', type: 'telegram', name: 'TG 通知', token: '****ABCD', chat_id: '123456789',
      events: ['failed'], all_services: true, enabled: true,
      created_at: 'x', updated_at: 'x',
    }
    const wrapper = await mountForm(ch)

    // token 欄位不得回填 masked 值
    expect((q<HTMLInputElement>('#channel-token')).value).toBe('')
    expect((q<HTMLInputElement>('#channel-token')).placeholder).toContain('保留原')

    // 留空 token + 已預填 chatId 可直接送出
    await setChecked('input[type="checkbox"]', true)
    await submitForm()

    const emitted = wrapper.emitted('save')
    expect(emitted).toBeTruthy()
    const payload = emitted![0][0] as any
    expect(payload.token).toBe('')
    expect(payload.chat_id).toBe('123456789')
  })
})

describe('ChannelForm — Telegram 子 Chat ID（sub_chat_id）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedServices()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-CF-15: Telegram 顯示選填「子 Chat ID」欄位並納入 payload', async () => {
    const wrapper = await mountForm()
    await selectType('telegram')

    const subChatInput = document.body.querySelector('[data-testid="channel-sub-chatid"]')
    expect(subChatInput).toBeTruthy()

    await setValue('#channel-token', '123456789:AA...')
    await setValue('#channel-chatid', '123456789')
    await setValue('[data-testid="channel-sub-chatid"]', '42')
    await setChecked('input[type="checkbox"]', true)

    await submitForm()

    const emitted = wrapper.emitted('save')
    expect(emitted).toBeTruthy()
    const payload = emitted![0][0] as any
    expect(payload.sub_chat_id).toBe('42')
  })

  it('F-CF-16: 未填子 Chat ID 時 payload.sub_chat_id 為空（選填）', async () => {
    const wrapper = await mountForm()
    await selectType('telegram')

    await setValue('#channel-token', '123456789:AA...')
    await setValue('#channel-chatid', '123456789')
    await setChecked('input[type="checkbox"]', true)

    await submitForm()

    const payload = wrapper.emitted('save')![0][0] as any
    expect(payload.sub_chat_id).toBe('')
  })
})

describe('ChannelForm — 服務分組（我的服務 / 系統服務）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedServices()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  async function openSpecificScope(): Promise<void> {
    await setRadio('false')
  }

  it('我的服務預設展開、系統服務收合只顯示數量', async () => {
    await mountForm()
    await openSpecificScope()

    expect(document.body.textContent).toContain('我的服務')
    expect(document.body.textContent).toContain('nginx.service')
    expect(document.body.textContent).toContain('系統服務')
    // 收合狀態：系統服務名稱不應出現在 DOM
    expect(document.body.textContent).not.toContain('systemd-journald.service')
  })

  it('點擊「系統服務」展開後顯示系統服務選項', async () => {
    await mountForm()
    await openSpecificScope()

    q<HTMLButtonElement>('.service-group-toggle').click()
    await nextTick()

    expect(document.body.textContent).toContain('systemd-journald.service')
  })

  it('輸入關鍵字時自動展開系統服務並過濾', async () => {
    await mountForm()
    await openSpecificScope()

    await setValue('.service-search', 'journald')

    expect(document.body.textContent).toContain('systemd-journald.service')
    expect(document.body.textContent).not.toContain('nginx.service')
  })

  it('勾選服務後顯示已選計數', async () => {
    await mountForm()
    await openSpecificScope()

    await setChecked('input[value="nginx.service"]', true)

    expect(document.body.textContent).toContain('已選 1 個服務')
  })
})

describe('ChannelForm — 表單有輸入時關閉先確認（決策 4 / §5.2）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    seedServices()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function clickButtonByText(text: string): void {
    const btn = qAll<HTMLButtonElement>('button').find(b => b.textContent?.trim() === text)
    if (!btn) throw new Error(`button with text "${text}" not found`)
    btn.click()
  }

  it('有輸入時點「取消」先跳出 ConfirmModal，點「繼續編輯」留在表單不 emit close', async () => {
    const wrapper = await mountForm()
    await setValue('input[placeholder*="Channel"]', '新名稱')

    clickButtonByText('取消')
    await nextTick()

    const modal = document.body.querySelector('.lms-modal')
    expect(modal).toBeTruthy()
    expect(modal!.textContent).toContain('捨棄')
    expect(wrapper.emitted('close')).toBeUndefined()

    clickButtonByText('繼續編輯')
    await nextTick()

    expect(document.body.querySelector('.lms-modal')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('有輸入時點「捨棄變更」確認後 emit close', async () => {
    const wrapper = await mountForm()
    await setValue('input[placeholder*="Channel"]', '新名稱')

    clickButtonByText('取消')
    await nextTick()
    expect(document.body.querySelector('.lms-modal')).toBeTruthy()

    clickButtonByText('捨棄變更')
    await nextTick()

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('未輸入任何內容直接點「取消」→ 直接 emit close，不彈 ConfirmModal', async () => {
    const wrapper = await mountForm()

    clickButtonByText('取消')
    await nextTick()

    expect(document.body.querySelector('.lms-modal')).toBeNull()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('有輸入時按 Esc 跳出 ConfirmModal，再按 Esc 僅關閉 ConfirmModal 不關閉表單', async () => {
    const wrapper = await mountForm()
    await setValue('input[placeholder*="Channel"]', '新名稱')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.body.querySelector('.lms-modal')).toBeTruthy()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(document.body.querySelector('.lms-modal')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
