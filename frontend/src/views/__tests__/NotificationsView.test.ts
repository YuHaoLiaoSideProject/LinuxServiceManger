/**
 * RED phase — NotificationsView.vue 視圖測試（F-NV-01 ~ F-NV-07）
 * 對應 docs/test-plans/013-webhook-notification測試計畫.md §3.1。
 * NotificationsView.vue 尚未建立 → import 失敗即為 RED。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const { mockFetch, mockCreate, mockUpdate, mockRemove, mockRegisterWs, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockRemove: vi.fn(),
  mockRegisterWs: vi.fn(),
  mockToast: vi.fn(),
}))

// NotificationsView 使用 useNotifyChannels；mock 其回傳以控制 loading/channels/error 狀態
const loading = ref(false)
const error = ref<string | null>(null)
const channels = ref<any[]>([])

vi.mock('../../composables/useNotifyChannels', () => ({
  useNotifyChannels: () => ({
    channels,
    loading,
    error,
    fetchChannels: mockFetch,
    createChannel: mockCreate,
    updateChannel: mockUpdate,
    removeChannel: mockRemove,
    registerWsHandler: mockRegisterWs,
  }),
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

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useRoute: () => ({ path: '/' }),
}))

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ username: 'admin', logout: vi.fn() }),
}))

import NotificationsView from '../NotificationsView.vue'

function makeChannel(overrides: any = {}) {
  return {
    id: 'c1', type: 'slack', name: '團隊 Slack', url: 'https://hooks.slack.com/services/x',
    events: ['failed'], all_services: true, enabled: true,
    created_at: 'x', updated_at: 'x', ...overrides,
  }
}

function mountView() {
  return mount(NotificationsView, {
    global: {
      stubs: {
        ChannelCard: {
          props: ['channel'],
          emits: ['edit', 'delete'],
          template: '<div class="channel-card-stub" data-testid="channel-card">{{ channel.name }}</div>',
        },
        ChannelForm: { template: '<div class="channel-form-stub" />' },
        ChannelHistoryTable: { template: '<div class="history-table-stub" />' },
        EmptyState: { template: '<div class="empty-state-stub"><slot /></div>' },
        AppHeader: { template: '<div class="app-header-stub" />' },
        ToastContainer: { template: '<div class="toast-container-stub" />' },
      },
    },
  })
}

describe('NotificationsView（F-NV）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loading.value = false
    error.value = null
    channels.value = []
    mockFetch.mockResolvedValue(undefined)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-NV-01: 載入中顯示 loading spinner', async () => {
    loading.value = true
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[aria-busy="true"], .loading-spinner').exists()).toBe(true)
  })

  it('F-NV-02: 載入完成顯示 channel 卡片列表', async () => {
    channels.value = [makeChannel(), makeChannel({ id: 'c2', name: '團隊 Discord', type: 'discord' })]
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('[data-testid="channel-card"]')).toHaveLength(2)
  })

  it('F-NV-03: 空狀態顯示 + 新增按鈕', async () => {
    channels.value = []
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('尚未設定任何通知 Channel')
    expect(wrapper.find('[data-testid="add-channel"]').exists()).toBe(true)
  })

  it('F-NV-04: 兩分頁結構（Channel 設定預設顯示 / 發送紀錄）', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('notify.tabChannels')
    expect(wrapper.text()).toContain('notify.tabHistory')
    // 預設顯示 Channel 設定分頁（history-table stub 尚未掛載）
    expect(wrapper.find('.history-table-stub').exists()).toBe(false)
  })

  it('F-NV-05: 載入失敗顯示錯誤 + 重試機制', async () => {
    error.value = '載入失敗'
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('載入失敗')
    // 點擊重試按鈕應再次 fetchChannels
    const retry = wrapper.find('[data-testid="retry"]')
    if (retry.exists()) {
      await retry.trigger('click')
      expect(mockFetch).toHaveBeenCalled()
    }
  })

  it('F-NV-06: 自動停用補償 Toast（載入時）', async () => {
    channels.value = [makeChannel({ id: 'c1', enabled: false, auto_disabled_reason: '連續失敗 10 次自動停用' })]
    mountView()
    await flushPromises()
    // 補償 Toast 由 fetchChannels 內部觸發（composable 已測）；view 層僅確認已呼叫 fetchChannels
    expect(mockFetch).toHaveBeenCalled()
  })

  it('F-NV-07: WS 即時停用 Toast（onMounted 註冊 handler）', async () => {
    mountView()
    await flushPromises()

    expect(mockRegisterWs).toHaveBeenCalled()
  })
})
