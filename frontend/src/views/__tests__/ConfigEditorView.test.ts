import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

// F-VW / F-VL / F-SV / F-CN：ConfigEditorView 整合測試
// （docs/test-plans/012-service-config-editor測試計畫.md §3.4~3.7）

const { mockGetConfig, mockSaveConfig, mockValidateConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockValidateConfig: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  getServiceConfig: mockGetConfig,
  saveServiceConfig: mockSaveConfig,
  validateServiceConfig: mockValidateConfig,
}))

import ConfigEditorView from '../ConfigEditorView.vue'
import { useServiceStore } from '../../stores/service'
import { useToast } from '../../composables/useToast'

const CONTENT = '[Unit]\nDescription=nginx\n\n[Service]\nExecStart=/usr/sbin/nginx\n'
const CHECKSUM = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'nginx.service',
    fragmentPath: '/etc/systemd/system/nginx.service',
    config: CONTENT,
    size: CONTENT.length,
    checksum: CHECKSUM,
    ...overrides,
  }
}

// UnitFileEditor stub — textarea 模擬 v-model 雙向綁定
const editorMarksSpy = { setErrorMarks: vi.fn(), clearMarks: vi.fn() }
const UnitFileEditorStub = {
  name: 'UnitFileEditor',
  props: ['modelValue', 'readOnly'],
  emits: ['update:modelValue'],
  template: `
    <textarea
      class="cm-stub"
      :value="modelValue"
      :readonly="readOnly"
      data-testid="editor"
      @input="$emit('update:modelValue', $event.target.value)"
    ></textarea>
  `,
  methods: editorMarksSpy,
}

// i18n mock（完整 config 翻譯）
const tMap: Record<string, string> = {
  'config.loading': '載入設定檔中...',
  'config.validate': 'Validate',
  'config.save': 'Save',
  'config.cancel': 'Cancel',
  'config.close': 'Close',
  'config.saveTitle': '儲存設定檔變更',
  'config.saveChanges': 'Save Changes',
  'config.saveConfirm': '確定要將變更寫入 {path} 嗎？',
  'config.saveReloadNotice': '儲存後將自動執行 systemctl daemon-reload 使變更生效',
  'config.saveRisk': '⚠️ 錯誤的設定可能導致服務無法啟動。',
  'config.saveEmptyWarning': '⚠️ 設定檔內容為空。儲存空設定檔可能導致 systemd 無法解析。確定要繼續嗎？',
  'config.validatePass': '語法驗證通過 — 設定檔語法正確',
  'config.validateUnavailable': '無法執行語法驗證 — systemd-analyze 不可用或執行錯誤。您仍可直接儲存設定檔。',
  'config.validateEmpty': '設定檔內容為空，請先編輯或載入內容',
  'config.validateRequestError': '請求格式錯誤',
  'config.notFound': '設定檔不存在：{path}。請確認服務設定檔是否已被手動刪除。',
  'config.largeFile': '設定檔較大（{size}），編輯時可能有效能影響。',
  'config.discardTitle': '有未儲存的變更',
  'config.discardMessage': '有未儲存的變更，確定要離開嗎？未儲存的變更將會遺失。',
  'config.stay': 'Stay',
  'config.discardChanges': 'Discard Changes',
  'config.saved': '{name} 設定檔已儲存，daemon-reload 已執行',
  'config.saveFailed': '儲存失敗：{error}',
  'config.reloadFailed': '設定檔已儲存，但 daemon-reload 失敗：{error}。請手動執行 systemctl daemon-reload。備份檔：{backupPath}',
  'config.conflict': '設定檔已被其他使用者修改。請重新載入後再編輯。',
  'config.discarded': '已放棄未儲存的變更',
  'config.back': '返回',
  'config.retry': '重試',
  'config.errorPermission': '無法讀取設定檔：權限不足。請確認 LMS 執行使用者具備讀取權限。',
  'modal.cancel': '取消',
  'modal.confirm': '確認',
}

vi.mock('../../composables/useI18n', () => ({
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

async function mountView(overrides: { locked?: boolean; query?: Record<string, string> } = {}) {
  setActivePinia(createPinia())
  const store = useServiceStore()
  store.setServices([
    {
      name: 'nginx.service', load: 'loaded', active: 'active', sub: 'running',
      locked: overrides.locked ?? false, unitFileState: 'enabled',
      fragmentPath: overrides.locked ? '/usr/lib/systemd/system/nginx.service' : '/etc/systemd/system/nginx.service',
    },
  ])

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div>Dashboard</div>' } },
      {
        path: '/services/:name/config',
        name: 'config-editor',
        component: ConfigEditorView,
      },
    ],
  })
  await router.push(`/services/nginx.service/config${overrides.query ? `?${new URLSearchParams(overrides.query)}` : ''}`)
  await router.isReady()

  // 經由 <router-view> 渲染 ConfigEditorView，onBeforeRouteLeave 才會註冊生效
  const RouterHost = { template: '<router-view />' }
  const wrapper = mount(RouterHost, {
    global: {
      plugins: [router],
      stubs: {
        UnitFileEditor: UnitFileEditorStub,
        ConfirmModal: {
          props: ['show', 'title', 'message', 'details', 'cancelLabel', 'confirmLabel', 'confirmClass'],
          emits: ['confirm', 'cancel'],
          template: `
            <div v-if="show" class="lms-modal-overlay" data-testid="confirm-modal">
              <div class="lms-modal">
                <h3>{{ title }}</h3>
                <p v-if="message" class="modal-message">{{ message }}</p>
                <div v-if="details && details.length" class="modal-details">
                  <p v-for="(d, i) in details" :key="i" class="modal-detail-item">{{ d }}</p>
                </div>
                <div class="lms-modal-actions">
                  <button class="modal-cancel-btn" @click="$emit('cancel')">{{ cancelLabel }}</button>
                  <button class="modal-confirm-btn" @click="$emit('confirm')">{{ confirmLabel }}</button>
                </div>
              </div>
            </div>
          `,
        },
        ToastContainer: { template: '<div />' },
      },
    },
  })
  await flushPromises()
  return { wrapper, router, store }
}

function toasts() {
  const { toasts } = useToast()
  return toasts.value
}

describe('ConfigEditorView — 載入與顯示（F-VW）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockResolvedValue(makeConfig())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-VW-01: 載入中顯示 spinner + 文字', async () => {
    let resolveGet!: (v: unknown) => void
    mockGetConfig.mockReturnValue(new Promise((r) => { resolveGet = r }))
    const { wrapper } = await mountView()
    expect(wrapper.find('.config-loading').exists()).toBe(true)
    expect(wrapper.text()).toContain('載入設定檔中...')
    resolveGet(makeConfig())
    await flushPromises()
  })

  it('F-VW-02: 載入成功顯示服務名稱與 FragmentPath', async () => {
    const { wrapper } = await mountView()
    await flushPromises()
    expect(wrapper.find('.config-header h2').text()).toContain('nginx.service')
    expect(wrapper.text()).toContain('/etc/systemd/system/nginx.service')
  })

  it('F-VW-03: 底部 Validate / Save / Cancel；Save 初始 disabled', async () => {
    const { wrapper } = await mountView()
    await flushPromises()
    const buttons = wrapper.findAll('.config-footer button')
    expect(buttons.length).toBe(3)
    expect(buttons[0].text()).toContain('Validate')
    expect(buttons[1].text()).toContain('Save')
    expect(buttons[2].text()).toContain('Cancel')
    expect(buttons[1].attributes('disabled')).toBeDefined()
  })

  it('F-VW-04: 唯讀模式僅顯示 Close', async () => {
    const { wrapper } = await mountView({ locked: true })
    await flushPromises()
    const buttons = wrapper.findAll('.config-footer button')
    expect(buttons.length).toBe(1)
    expect(buttons[0].text()).toContain('Close')
    // 編輯器 readOnly
    const editor = wrapper.find('[data-testid="editor"]')
    expect(editor.attributes('readonly')).toBeDefined()
  })

  it('F-VW-05: 載入失敗顯示錯誤 + 返回/重試', async () => {
    mockGetConfig.mockRejectedValue({ response: { status: 500, data: { error: '無法讀取設定檔：permission denied' } } })
    const { wrapper } = await mountView()
    await flushPromises()
    expect(wrapper.find('.config-error-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('無法讀取設定檔')
    expect(wrapper.text()).toContain('返回')
    expect(wrapper.text()).toContain('重試')
  })

  it('F-VW-06: 重試重新載入', async () => {
    mockGetConfig.mockRejectedValueOnce({ response: { status: 500, data: { error: 'boom' } } })
    mockGetConfig.mockResolvedValueOnce(makeConfig())
    const { wrapper } = await mountView()
    await flushPromises()
    await wrapper.find('.config-retry-btn, .config-error-state button.primary').trigger('click')
    await flushPromises()
    expect(mockGetConfig).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.config-editor-page .cm-stub').exists()).toBe(true)
  })

  it('F-VW-07: 404 顯示空編輯器 + 黃色提示', async () => {
    mockGetConfig.mockRejectedValue({ response: { status: 404, data: { error: '設定檔不存在' } } })
    const { wrapper } = await mountView()
    await flushPromises()
    expect(wrapper.find('.config-notice.warning').exists()).toBe(true)
    expect(wrapper.text()).toContain('設定檔不存在')
    expect((wrapper.find('[data-testid="editor"]').element as HTMLTextAreaElement).value).toBe('')
  })

  it('F-VW-09: 超過 500KB 顯示效能提示', async () => {
    mockGetConfig.mockResolvedValue(makeConfig({ size: 600000 }))
    const { wrapper } = await mountView()
    await flushPromises()
    expect(wrapper.find('.config-notice.warning').exists()).toBe(true)
    expect(wrapper.text()).toContain('600000')
  })

  it('F-VW-11/12: 編輯後 Save 啟用 + dirty 指示', async () => {
    const { wrapper } = await mountView()
    await flushPromises()
    const editor = wrapper.find('[data-testid="editor"]')
    await editor.setValue(CONTENT + '\nEnvironment=FOO=bar')
    await nextTick()
    const saveBtn = wrapper.findAll('.config-footer button')[1]
    expect(saveBtn.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.dirty-dot').exists()).toBe(true)
  })
})

describe('ConfigEditorView — Validate 流程（F-VL）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockResolvedValue(makeConfig())
  })

  async function mountAndEdit(content: string) {
    const { wrapper } = await mountView()
    await flushPromises()
    await wrapper.find('[data-testid="editor"]').setValue(content)
    await nextTick()
    return wrapper
  }

  it('F-VL-01: 點擊 Validate 顯示 loading', async () => {
    let resolveV!: (v: unknown) => void
    mockValidateConfig.mockReturnValue(new Promise((r) => { resolveV = r }))
    const wrapper = await mountAndEdit(CONTENT)
    const validateBtn = wrapper.findAll('.config-footer button')[0]
    await validateBtn.trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('Verifying...')
    expect(validateBtn.attributes('disabled')).toBeDefined()
    resolveV({ valid: true, available: true, errors: [] })
    await flushPromises()
  })

  it('F-VL-02: 空內容前端攔截（不發 API 請求）', async () => {
    const wrapper = await mountAndEdit('')
    await wrapper.findAll('.config-footer button')[0].trigger('click')
    await flushPromises()
    expect(mockValidateConfig).not.toHaveBeenCalled()
    expect(toasts().some(t => t.message.includes('設定檔內容為空'))).toBe(true)
  })

  it('F-VL-03: 驗證通過綠色提示', async () => {
    mockValidateConfig.mockResolvedValue({ valid: true, available: true, errors: [] })
    const wrapper = await mountAndEdit(CONTENT)
    await wrapper.findAll('.config-footer button')[0].trigger('click')
    await flushPromises()
    const banner = wrapper.find('.validation-banner.success')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('語法驗證通過')
  })

  it('F-VL-04: 驗證失敗紅色面板逐條列出', async () => {
    mockValidateConfig.mockResolvedValue({
      valid: false, available: true,
      errors: [{ line: 12, message: "Unknown key 'ExecStartt'" }],
    })
    const wrapper = await mountAndEdit(CONTENT + '\nExecStartt=bad')
    await wrapper.findAll('.config-footer button')[0].trigger('click')
    await flushPromises()
    const panel = wrapper.find('.validation-banner.error')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain("Line 12: Unknown key 'ExecStartt'")
  })

  it('F-VL-05: 失敗時呼叫 setErrorMarks', async () => {
    mockValidateConfig.mockResolvedValue({
      valid: false, available: true,
      errors: [{ line: 12, message: 'bad' }],
    })
    const wrapper = await mountAndEdit(CONTENT + '\nExecStartt=bad')
    await wrapper.findAll('.config-footer button')[0].trigger('click')
    await flushPromises()
    expect(editorMarksSpy.setErrorMarks).toHaveBeenCalledWith([12])
  })

  it('F-VL-06: available=false 黃色警告且不阻塞', async () => {
    mockValidateConfig.mockResolvedValue({
      valid: false, available: false, errors: [], message: 'systemd-analyze 指令不存在',
    })
    const wrapper = await mountAndEdit(CONTENT)
    await wrapper.findAll('.config-footer button')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('.validation-banner.warning').exists()).toBe(true)
    expect(wrapper.find('[data-testid="editor"]').attributes('readonly')).toBeUndefined()
  })

  it('F-VL-08: 400 請求格式錯誤顯示錯誤', async () => {
    mockValidateConfig.mockRejectedValue({ response: { status: 400, data: { error: 'invalid request body' } } })
    const wrapper = await mountAndEdit(CONTENT)
    await wrapper.findAll('.config-footer button')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('.validation-banner.warning').exists()).toBe(true)
    expect(toasts().some(t => t.message.includes('請求格式錯誤'))).toBe(true)
  })

  it('F-VL-09: 內容變更自動清除舊驗證結果', async () => {
    mockValidateConfig.mockResolvedValue({
      valid: false, available: true,
      errors: [{ line: 12, message: 'bad' }],
    })
    const wrapper = await mountAndEdit(CONTENT + '\nExecStartt=bad')
    await wrapper.findAll('.config-footer button')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('.validation-banner.error').exists()).toBe(true)
    await wrapper.find('[data-testid="editor"]').setValue(CONTENT + '\nExecStartt=bad2')
    await nextTick()
    expect(wrapper.find('.validation-banner').exists()).toBe(false)
  })
})

describe('ConfigEditorView — Save 流程（F-SV）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockResolvedValue(makeConfig())
  })

  async function mountDirty() {
    const { wrapper, router } = await mountView()
    await flushPromises()
    await wrapper.find('[data-testid="editor"]').setValue(CONTENT + '\nEnvironment=FOO=bar')
    await nextTick()
    return { wrapper, router }
  }

  it('F-SV-01: dirty 點 Save 彈出 ConfirmModal（標題「儲存設定檔變更」）', async () => {
    const { wrapper } = await mountDirty()
    await wrapper.findAll('.config-footer button')[1].trigger('click')
    await nextTick()
    const modal = wrapper.find('[data-testid="confirm-modal"]')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('儲存設定檔變更')
  })

  it('F-SV-02: Modal 內容含路徑/reload 提示/風險警告', async () => {
    const { wrapper } = await mountDirty()
    await wrapper.findAll('.config-footer button')[1].trigger('click')
    await nextTick()
    const modal = wrapper.find('[data-testid="confirm-modal"]')
    expect(modal.text()).toContain('確定要將變更寫入 /etc/systemd/system/nginx.service 嗎？')
    expect(modal.text()).toContain('systemctl daemon-reload')
    expect(modal.text()).toContain('錯誤的設定可能導致服務無法啟動')
  })

  it('F-SV-03: Modal 按鈕 Cancel + Save Changes', async () => {
    const { wrapper } = await mountDirty()
    await wrapper.findAll('.config-footer button')[1].trigger('click')
    await nextTick()
    expect(wrapper.find('.modal-cancel-btn').text()).toContain('取消')
    expect(wrapper.find('.modal-confirm-btn').text()).toContain('Save Changes')
  })

  it('F-SV-04: Cancel 關閉 Modal 狀態不變', async () => {
    const { wrapper } = await mountDirty()
    await wrapper.findAll('.config-footer button')[1].trigger('click')
    await nextTick()
    await wrapper.find('.modal-cancel-btn').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(false)
    expect(wrapper.find('.dirty-dot').exists()).toBe(true)
  })

  it('F-SV-06: 儲存成功 Toast + 1.5s 後導航回 Dashboard', async () => {
    vi.useFakeTimers()
    try {
      mockSaveConfig.mockResolvedValue({ message: 'saved', backupPath: '/etc/systemd/system/nginx.service.bak.20260812T153045Z' })
      const { wrapper, router } = await mountDirty()
      await wrapper.findAll('.config-footer button')[1].trigger('click')
      await nextTick()
      await wrapper.find('.modal-confirm-btn').trigger('click')
      await flushPromises()
      expect(toasts().some(t => t.message.includes('設定檔已儲存'))).toBe(true)
      expect(wrapper.find('.dirty-dot').exists()).toBe(false)
      await vi.advanceTimersByTimeAsync(1600)
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/')
    } finally {
      vi.useRealTimers()
    }
  })

  it('F-SV-07: 儲存失敗紅色 Toast + 恢復可編輯 + 內容保留', async () => {
    mockSaveConfig.mockRejectedValue({ response: { status: 500, data: { error: '寫入失敗' } } })
    const { wrapper } = await mountDirty()
    await wrapper.findAll('.config-footer button')[1].trigger('click')
    await nextTick()
    await wrapper.find('.modal-confirm-btn').trigger('click')
    await flushPromises()
    expect(toasts().some(t => t.type === 'error' && t.message.includes('儲存失敗'))).toBe(true)
    const editor = wrapper.find('[data-testid="editor"]')
    expect(editor.attributes('readonly')).toBeUndefined()
    expect((editor.element as HTMLTextAreaElement).value).toContain('Environment=FOO=bar')
  })

  it('F-SV-08: daemon-reload 失敗半成功 Toast + backupPath', async () => {
    mockSaveConfig.mockRejectedValue({
      response: {
        status: 500,
        data: { error: 'daemon-reload 失敗: x', backupPath: '/etc/systemd/system/nginx.service.bak.20260812T153045Z' },
      },
    })
    const { wrapper } = await mountDirty()
    await wrapper.findAll('.config-footer button')[1].trigger('click')
    await nextTick()
    await wrapper.find('.modal-confirm-btn').trigger('click')
    await flushPromises()
    expect(toasts().some(t => t.message.includes('daemon-reload 失敗') && t.message.includes('.bak.'))).toBe(true)
  })

  it('F-SV-09: 409 衝突 Toast + 重新載入動作', async () => {
    const newChecksum = 'abc'.padEnd(64, 'd')
    mockSaveConfig.mockRejectedValue({
      response: {
        status: 409,
        data: { error: '設定檔已被其他使用者修改。請重新載入後再編輯。', currentChecksum: newChecksum },
      },
    })
    mockGetConfig.mockResolvedValueOnce(makeConfig({ checksum: newChecksum }))
    const { wrapper } = await mountDirty()
    await wrapper.findAll('.config-footer button')[1].trigger('click')
    await nextTick()
    await wrapper.find('.modal-confirm-btn').trigger('click')
    await flushPromises()
    expect(toasts().some(t => t.message.includes('已被其他使用者修改'))).toBe(true)
    // 提供重新載入動作 → 點擊後重新 GET 更新 baseChecksum
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="confirm-modal"]').text()).toContain('重新載入')
    await wrapper.find('.modal-confirm-btn').trigger('click')
    await flushPromises()
    expect(mockGetConfig).toHaveBeenCalledTimes(2)
  })

  it('F-SV-10: 空內容儲存額外警告', async () => {
    // 載入正常內容後清空 → dirty + Save enabled + 空內容警告
    const { wrapper } = await mountView()
    await flushPromises()
    await wrapper.find('[data-testid="editor"]').setValue('')
    await nextTick()
    const saveBtn = wrapper.findAll('.config-footer button')[1]
    expect(saveBtn.attributes('disabled')).toBeUndefined()
    await saveBtn.trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="confirm-modal"]').text()).toContain('設定檔內容為空')
  })
})

describe('ConfigEditorView — Cancel / dirty guard（F-CN）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockResolvedValue(makeConfig())
  })

  it('F-CN-01: clean 點 Cancel 直接返回（無確認框）', async () => {
    const { wrapper, router } = await mountView()
    await flushPromises()
    await wrapper.findAll('.config-footer button')[2].trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('F-CN-02: dirty 點 Cancel 彈出放棄確認', async () => {
    const { wrapper } = await mountView()
    await flushPromises()
    await wrapper.find('[data-testid="editor"]').setValue(CONTENT + 'x')
    await nextTick()
    await wrapper.findAll('.config-footer button')[2].trigger('click')
    await nextTick()
    const modal = wrapper.find('[data-testid="confirm-modal"]')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('有未儲存的變更')
    expect(modal.text()).toContain('Stay')
    expect(modal.text()).toContain('Discard Changes')
  })

  it('F-CN-03: Stay 回到編輯器狀態不變', async () => {
    const { wrapper } = await mountView()
    await flushPromises()
    await wrapper.find('[data-testid="editor"]').setValue(CONTENT + 'x')
    await nextTick()
    await wrapper.findAll('.config-footer button')[2].trigger('click')
    await nextTick()
    await wrapper.find('.modal-cancel-btn').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(false)
    expect(wrapper.find('.dirty-dot').exists()).toBe(true)
  })

  it('F-CN-04: Discard 返回 Dashboard + 灰色 Toast', async () => {
    const { wrapper, router } = await mountView()
    await flushPromises()
    await wrapper.find('[data-testid="editor"]').setValue(CONTENT + 'x')
    await nextTick()
    await wrapper.findAll('.config-footer button')[2].trigger('click')
    await nextTick()
    await wrapper.find('.modal-confirm-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(toasts().some(t => t.message.includes('已放棄未儲存的變更'))).toBe(true)
  })

  it('F-CN-05: 瀏覽器返回鍵觸發 dirty-check（route guard）', async () => {
    const { wrapper, router } = await mountView()
    await flushPromises()
    await wrapper.find('[data-testid="editor"]').setValue(CONTENT + 'x')
    await nextTick()
    const nav = router.push('/')
    // guard 應阻擋（彈出 modal），route 未變
    await flushPromises()
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(true)
    // 完成 Discard
    await wrapper.find('.modal-confirm-btn').trigger('click')
    await flushPromises()
    await nav
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('F-CN-07/08: beforeunload dirty 攔截 / clean 不攔截', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { wrapper } = await mountView()
    await flushPromises()
    const handler = addSpy.mock.calls.find(([ev]) => ev === 'beforeunload')?.[1] as ((e: BeforeUnloadEvent) => void) | undefined
    expect(handler).toBeTruthy()
    // clean
    const evtClean = { preventDefault: vi.fn(), returnValue: '' } as unknown as BeforeUnloadEvent
    handler!(evtClean)
    expect(evtClean.preventDefault).not.toHaveBeenCalled()
    // dirty
    await wrapper.find('[data-testid="editor"]').setValue(CONTENT + 'x')
    await nextTick()
    const evtDirty = { preventDefault: vi.fn(), returnValue: '' } as unknown as BeforeUnloadEvent
    handler!(evtDirty)
    expect(evtDirty.preventDefault).toHaveBeenCalled()
    addSpy.mockRestore()
  })

  it('F-CN-09: 儲存成功後導航放行（dirty 已清）', async () => {
    vi.useFakeTimers()
    try {
      mockSaveConfig.mockResolvedValue({ message: 'saved', backupPath: '/x.bak.20260812T153045Z' })
      const { wrapper, router } = await mountView()
      await flushPromises()
      await wrapper.find('[data-testid="editor"]').setValue(CONTENT + 'x')
      await nextTick()
      await wrapper.findAll('.config-footer button')[1].trigger('click')
      await nextTick()
      await wrapper.find('.modal-confirm-btn').trigger('click')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(1600)
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/')
    } finally {
      vi.useRealTimers()
    }
  })
})
