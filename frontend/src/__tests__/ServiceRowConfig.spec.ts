import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ServiceRow from '../components/ServiceRow.vue'
import { useConfigEditorModal } from '../composables/useConfigEditorModal'
import type { Service } from '../types/service'

// F-SR-01 ~ F-SR-04：ServiceRow「Edit Config / View Config」進入點按鈕
// （docs/test-plans/012-service-config-editor測試計畫.md §3.1）
// 012 UIUX v2：桌面 ≥768px 開 Modal（不導航）；手機 ≤767px 導航全頁路由。

const tMap: Record<string, string> = {
  'action.start': '啟動',
  'action.stop': '停止',
  'action.restart': '重啟',
  'action.logs': '日誌',
  'action.config.edit': 'Edit Config',
  'action.config.view': 'View Config',
  'action.config.edit.aria': '編輯 {name} 設定檔',
  'action.config.view.aria': '檢視 {name} 設定檔',
  'locked.badge': '🔒 已鎖定',
  'col.actions': '操作',
}

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      let text = tMap[key] || key
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, v)
        })
      }
      return text
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    name: 'nginx.service',
    load: 'loaded',
    active: 'active',
    sub: 'running',
    locked: false,
    unitFileState: 'enabled',
    fragmentPath: '/etc/systemd/system/nginx.service',
    ...overrides,
  }
}

function mountRow(service: Service) {
  const push = vi.fn()
  const wrapper = mount(ServiceRow, {
    props: { service },
    global: {
      mocks: { $router: { push } },
      stubs: {
        Teleport: true,
      },
    },
  })
  return { wrapper, push }
}

// ── viewport / matchMedia mock（測試環境為 happy-dom，預設 innerWidth 1024 視為桌面）──
const originalMatchMedia = window.matchMedia
function setViewport(desktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: desktop,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

describe('ServiceRow — Edit/View Config 進入點（F-SR）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConfigEditorModal().closeModal()
    setViewport(true) // 預設桌面
  })

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    })
  })

  it('F-SR-01: 解鎖服務顯示「Edit Config」按鈕（與其他操作按鈕同列、outline secondary）', () => {
    const svc = makeService({ locked: false, fragmentPath: '/etc/systemd/system/nginx.service' })
    const { wrapper } = mountRow(svc)

    const btn = wrapper.find('button.btn-act-config.btn-edit-config')
    expect(btn.exists()).toBe(true)
    // 樣式一致
    expect(btn.classes()).toContain('outline')
    expect(btn.classes()).toContain('secondary')
    // 在 Actions 區域
    expect(wrapper.find('.actions').find('button.btn-act-config').exists()).toBe(true)
    // aria-label / tooltip 呈現 BDD 語意
    expect(btn.attributes('aria-label')).toContain('編輯')
    expect(btn.attributes('aria-label')).toContain('nginx.service')
  })

  it('F-SR-01b: 手機點擊 Edit Config 導航至 /services/{name}/config', async () => {
    setViewport(false)
    const svc = makeService({ locked: false, fragmentPath: '/etc/systemd/system/nginx.service' })
    const { wrapper, push } = mountRow(svc)
    await wrapper.find('button.btn-act-config.btn-edit-config').trigger('click')
    expect(push).toHaveBeenCalled()
    const arg = push.mock.calls[0][0]
    expect(arg.name).toBe('config-editor')
    expect(arg.params.name).toBe('nginx.service')
    expect(arg.query).toBeUndefined()
  })

  it('F-SR-01c: 桌面點擊 Edit Config 開啟 Modal（不導航）', async () => {
    const svc = makeService({ locked: false, fragmentPath: '/etc/systemd/system/nginx.service' })
    const { wrapper, push } = mountRow(svc)
    await wrapper.find('button.btn-act-config.btn-edit-config').trigger('click')

    const { open, serviceName, readOnly } = useConfigEditorModal()
    expect(open.value).toBe(true)
    expect(serviceName.value).toBe('nginx.service')
    expect(readOnly.value).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('F-SR-02: 鎖定服務顯示「View Config」按鈕而非「Edit Config」', () => {
    const svc = makeService({ locked: true, fragmentPath: '/usr/lib/systemd/system/systemd-journald.service' })
    const { wrapper } = mountRow(svc)

    const viewBtn = wrapper.find('button.btn-act-config.btn-view-config')
    expect(viewBtn.exists()).toBe(true)
    expect(viewBtn.attributes('aria-label')).toContain('檢視')
    // 不顯示 Edit
    expect(wrapper.find('button.btn-act-config.btn-edit-config').exists()).toBe(false)
  })

  it('F-SR-02b: 手機 View Config 導航帶 ?readonly=1', async () => {
    setViewport(false)
    const svc = makeService({ locked: true, fragmentPath: '/usr/lib/systemd/system/x.service' })
    const { wrapper, push } = mountRow(svc)
    await wrapper.find('button.btn-act-config.btn-view-config').trigger('click')
    expect(push).toHaveBeenCalled()
    const arg = push.mock.calls[0][0]
    expect(arg.query).toEqual({ readonly: '1' })
  })

  it('F-SR-02c: 桌面點擊 View Config 開啟唯讀 Modal（不導航）', async () => {
    const svc = makeService({ name: 'x.service', locked: true, fragmentPath: '/usr/lib/systemd/system/x.service' })
    const { wrapper, push } = mountRow(svc)
    await wrapper.find('button.btn-act-config.btn-view-config').trigger('click')

    const { open, serviceName, readOnly } = useConfigEditorModal()
    expect(open.value).toBe(true)
    expect(serviceName.value).toBe('x.service')
    expect(readOnly.value).toBe(true)
    expect(push).not.toHaveBeenCalled()
  })

  it('F-SR-03: fragmentPath 為空時不顯示 Edit/View Config 按鈕', () => {
    const svc = makeService({ locked: false, fragmentPath: '' })
    const { wrapper } = mountRow(svc)
    expect(wrapper.find('button.btn-act-config').exists()).toBe(false)
  })

  it('F-SR-04: 三服務混合（nginx 可編輯、systemd-journald/httpd 唯讀）', () => {
    const cases: Array<{ svc: Partial<Service>; edit: boolean; view: boolean }> = [
      { svc: { name: 'nginx.service', locked: false, fragmentPath: '/etc/systemd/system/nginx.service' }, edit: true, view: false },
      { svc: { name: 'systemd-journald.service', locked: true, fragmentPath: '/usr/lib/systemd/system/systemd-journald.service' }, edit: false, view: true },
      { svc: { name: 'httpd.service', locked: true, fragmentPath: '/run/systemd/system/httpd.service' }, edit: false, view: true },
    ]
    for (const c of cases) {
      const { wrapper } = mountRow(makeService(c.svc))
      expect(wrapper.find('button.btn-act-config.btn-edit-config').exists()).toBe(c.edit)
      expect(wrapper.find('button.btn-act-config.btn-view-config').exists()).toBe(c.view)
    }
  })
})
