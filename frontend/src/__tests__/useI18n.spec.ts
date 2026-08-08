import { describe, it, expect, vi, beforeEach } from 'vitest'

function createMockLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string): string | null => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k] }),
  }
}

function setNavigatorLanguage(lang: string) {
  Object.defineProperty(window.navigator, 'language', {
    value: lang,
    writable: true,
    configurable: true,
  })
}

describe('useI18n — 多語言', () => {
  beforeEach(() => {
    vi.resetModules()
    // Default navigator
    setNavigatorLanguage('en-US')
    // Fresh localStorage
    vi.stubGlobal('localStorage', createMockLocalStorage())
  })

  it('t() 回傳 zh-TW 翻譯', async () => {
    setNavigatorLanguage('zh-TW')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()
    expect(t('stats.total')).toBe('總服務數')
    expect(t('stats.running')).toBe('執行中')
    expect(t('search.placeholder')).toBe('搜尋服務名稱...')
    expect(t('action.start')).toBe('Start')
  })

  it('t() 回傳 en 翻譯', async () => {
    setNavigatorLanguage('en-US')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()
    expect(t('stats.total')).toBe('Total Services')
    expect(t('stats.running')).toBe('Running')
    expect(t('search.placeholder')).toBe('Search services...')
    expect(t('action.start')).toBe('Start')
  })

  it('t() 支援參數替換 {name}', async () => {
    setNavigatorLanguage('zh-TW')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()
    expect(t('modal.stop', { name: 'nginx.service' })).toBe('確定要停止 nginx.service 嗎？')
    expect(t('modal.restart', { name: 'myapp.service' })).toBe('確定要重啟 myapp.service 嗎？')
    expect(t('search.empty', { term: 'test' })).toBe('沒有符合「test」的服務')
  })

  it('setLang("en") 切換語言並存入 localStorage', async () => {
    setNavigatorLanguage('zh-TW')
    const { useI18n } = await import('../composables/useI18n')
    const { t, setLang } = useI18n()

    expect(t('stats.total')).toBe('總服務數')

    setLang('en')
    expect(t('stats.total')).toBe('Total Services')
    expect(localStorage.setItem).toHaveBeenCalledWith('lms-lang', 'en')
  })

  it('toggleLang() 在 zh-TW ↔ en 之間切換', async () => {
    setNavigatorLanguage('zh-TW')
    const { useI18n } = await import('../composables/useI18n')
    const { t, toggleLang } = useI18n()

    expect(t('stats.total')).toBe('總服務數')

    toggleLang()
    expect(t('stats.total')).toBe('Total Services')

    toggleLang()
    expect(t('stats.total')).toBe('總服務數')
  })

  it('瀏覽器語言為 zh-* 時預設 zh-TW', async () => {
    setNavigatorLanguage('zh-CN')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()
    expect(t('stats.total')).toBe('總服務數')
  })

  it('瀏覽器語言為其他時預設 en', async () => {
    setNavigatorLanguage('ja-JP')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()
    expect(t('stats.total')).toBe('Total Services')
  })

  it('localStorage 有值時優先使用', async () => {
    const ls = createMockLocalStorage()
    ls.getItem = vi.fn((key: string): string | null => key === 'lms-lang' ? 'en' : null)
    vi.stubGlobal('localStorage', ls)
    setNavigatorLanguage('zh-TW')

    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()

    // localStorage says 'en', should override zh-TW navigator
    expect(t('stats.total')).toBe('Total Services')
    expect(t('login.title')).toBe('Linux Service Manager')
  })

  it('不存在 key 時回傳 key 本身', async () => {
    setNavigatorLanguage('zh-TW')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })
})

describe('列表相關語系 keys', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', createMockLocalStorage())
  })

  it('zh-TW：列表相關翻譯', async () => {
    setNavigatorLanguage('zh-TW')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()

    // 狀態統計
    expect(t('stats.total')).toBe('總服務數')
    expect(t('stats.running')).toBe('執行中')
    expect(t('stats.failed')).toBe('失敗')

    // 搜尋
    expect(t('search.placeholder')).toBe('搜尋服務名稱...')
    expect(t('search.empty', { term: 'test' })).toBe('沒有符合「test」的服務')

    // 空狀態
    expect(t('empty.state')).toBe('找不到任何服務，或無法連線至 systemd。')

    // 操作按鈕
    expect(t('action.start')).toBe('Start')
    expect(t('action.stop')).toBe('Stop')
    expect(t('action.restart')).toBe('Restart')

    // 鎖定相關
    expect(t('locked.badge')).toBe('🔒 已鎖定')
    expect(t('locked.tooltip')).toBe('此服務受保護，無法直接操作。設定 UNLOCKED_SERVICES 環境變數解鎖。')

    // 頁籤
    expect(t('tab.my')).toBe('我的服務')
    expect(t('tab.system')).toBe('系統服務')

    // 標頭
    expect(t('header.refresh')).toBe('🔄 重新整理')
    expect(t('header.logout')).toBe('🚪 登出')

    // 表格欄位標頭
    expect(t('col.name')).toBe('名稱')
    expect(t('col.load')).toBe('載入狀態')
    expect(t('col.active')).toBe('啟用狀態')
    expect(t('col.sub')).toBe('執行狀態')
    expect(t('col.autoStart')).toBe('開機啟動')
    expect(t('col.actions')).toBe('操作')
  })

  it('en：列表相關翻譯', async () => {
    setNavigatorLanguage('en-US')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()

    // Stats
    expect(t('stats.total')).toBe('Total Services')
    expect(t('stats.running')).toBe('Running')
    expect(t('stats.failed')).toBe('Failed')

    // Search
    expect(t('search.placeholder')).toBe('Search services...')
    expect(t('search.empty', { term: 'test' })).toBe('No services matching "test"')

    // Empty state
    expect(t('empty.state')).toBe('No services found or unable to connect to systemd.')

    // Action buttons
    expect(t('action.start')).toBe('Start')
    expect(t('action.stop')).toBe('Stop')
    expect(t('action.restart')).toBe('Restart')

    // Locked
    expect(t('locked.badge')).toBe('🔒 Locked')
    expect(t('locked.tooltip')).toBe('This service is protected. Set the UNLOCKED_SERVICES environment variable to unlock.')

    // Tabs
    expect(t('tab.my')).toBe('My Services')
    expect(t('tab.system')).toBe('System Services')

    // Header
    expect(t('header.refresh')).toBe('🔄 Refresh')
    expect(t('header.logout')).toBe('🚪 Logout')

    // Column headers
    expect(t('col.name')).toBe('Name')
    expect(t('col.load')).toBe('Load')
    expect(t('col.active')).toBe('Active')
    expect(t('col.sub')).toBe('Sub')
    expect(t('col.autoStart')).toBe('Auto-start')
    expect(t('col.actions')).toBe('Actions')
  })

  it('語系切換後列表翻譯也跟著切換', async () => {
    setNavigatorLanguage('zh-TW')
    const { useI18n } = await import('../composables/useI18n')
    const { t, setLang } = useI18n()

    // 初始 zh-TW
    expect(t('empty.state')).toBe('找不到任何服務，或無法連線至 systemd。')
    expect(t('locked.badge')).toBe('🔒 已鎖定')
    expect(t('tab.my')).toBe('我的服務')
    expect(t('action.stop')).toBe('Stop')

    // 切到 en
    setLang('en')
    expect(t('empty.state')).toBe('No services found or unable to connect to systemd.')
    expect(t('locked.badge')).toBe('🔒 Locked')
    expect(t('tab.my')).toBe('My Services')
    expect(t('action.stop')).toBe('Stop')

    // 切回 zh-TW
    setLang('zh-TW')
    expect(t('empty.state')).toBe('找不到任何服務，或無法連線至 systemd。')
    expect(t('locked.badge')).toBe('🔒 已鎖定')
    expect(t('tab.my')).toBe('我的服務')
  })
})

describe('所有 component 用到的 key 皆存在於翻譯檔（不存在 = 紅燈）', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', createMockLocalStorage())
  })

  // 這個清單是 component 裡所有 t('xxx') 呼叫的 key
  // 如果有 key 不在翻譯檔中，t() 會回傳 key 字串本身 ≠ 預期翻譯 → 測試紅燈
  const allKeys = [
    // 狀態統計
    'stats.total', 'stats.running', 'stats.failed',
    // 搜尋
    'search.placeholder', 'search.empty', 'search.aria', 'search.clear.aria', 'search.clear.title',
    // 空狀態
    'empty.state',
    // 操作按鈕
    'action.start', 'action.stop', 'action.restart',
    'action.start.aria', 'action.stop.aria', 'action.restart.aria',
    // 鎖定
    'locked.badge', 'locked.tooltip',
    // 頁籤
    'tab.my', 'tab.system',
    // 標頭
    'header.refresh', 'header.logout',
    'header.refresh.aria', 'header.logout.aria',
    // 語言 / 主題切換
    'lang.toggle.title', 'theme.toggle', 'theme.toggle.title',
    // 表格欄位
    'col.name', 'col.load', 'col.active', 'col.sub', 'col.autoStart', 'col.actions',
    // 表格 caption
    'caption.title', 'caption.sub',
    // Modal
    'modal.title', 'modal.cancel', 'modal.confirm', 'modal.stop', 'modal.restart', 'modal.disable',
    // Toast
    'toast.started', 'toast.stopped', 'toast.restarted',
    'toast.enabled', 'toast.disabled', 'toast.error',
    // 登入
    'login.title', 'login.subtitle', 'login.username', 'login.password', 'login.submit', 'login.error',
    // Systemd 狀態值翻譯
    'status.load.loaded', 'status.load.not-found', 'status.load.bad-setting', 'status.load.error', 'status.load.masked', 'status.load.stub',
    'status.active.active', 'status.active.inactive', 'status.active.failed', 'status.active.activating', 'status.active.deactivating', 'status.active.reloading',
    'status.sub.running', 'status.sub.dead', 'status.sub.exited', 'status.sub.failed', 'status.sub.auto-restart', 'status.sub.plugged', 'status.sub.mounted', 'status.sub.waiting', 'status.sub.listening',
    // Auto-start toggle
    'autoStart.na', 'autoStart.on', 'autoStart.off', 'autoStart.enableAria', 'autoStart.disableAria',
  ]

  const expectedZhTW: Record<string, string> = {
    'stats.total': '總服務數',
    'stats.running': '執行中',
    'stats.failed': '失敗',
    'search.placeholder': '搜尋服務名稱...',
    'search.empty': '沒有符合「{term}」的服務',
    'search.aria': '搜尋服務',
    'search.clear.aria': '清除搜尋內容',
    'search.clear.title': '清除搜尋',
    'empty.state': '找不到任何服務，或無法連線至 systemd。',
    'action.start': 'Start',
    'action.stop': 'Stop',
    'action.restart': 'Restart',
    'action.start.aria': '啟動 {name}',
    'action.stop.aria': '停止 {name}',
    'action.restart.aria': '重啟 {name}',
    'locked.badge': '🔒 已鎖定',
    'locked.tooltip': '此服務受保護，無法直接操作。設定 UNLOCKED_SERVICES 環境變數解鎖。',
    'tab.my': '我的服務',
    'tab.system': '系統服務',
    'header.refresh': '🔄 重新整理',
    'header.logout': '🚪 登出',
    'header.refresh.aria': '重新整理',
    'header.logout.aria': '登出',
    'lang.toggle.title': '切換語言',
    'theme.toggle': '切換主題',
    'theme.toggle.title': '切換深色/淺色主題',
    'col.name': '名稱',
    'col.load': '載入狀態',
    'col.active': '啟用狀態',
    'col.sub': '執行狀態',
    'col.autoStart': '開機啟動',
    'col.actions': '操作',
    'caption.title': '系統服務列表',
    'caption.sub': '— 點擊操作按鈕管理服務',
    'modal.title': '⚠️ 確認操作',
    'modal.cancel': '取消',
    'modal.confirm': '確認',
    'modal.stop': '確定要停止 {name} 嗎？',
    'modal.restart': '確定要重啟 {name} 嗎？',
    'modal.disable': '確定要停用 {name} 的開機自動啟動嗎？此服務下次重開機後將不會自動啟動。',
    'toast.started': '{name} 已啟動',
    'toast.stopped': '{name} 已停止',
    'toast.restarted': '{name} 已重啟',
    'toast.enabled': '{name} 已設為開機自動啟動',
    'toast.disabled': '{name} 已取消開機自動啟動',
    'toast.error': '{name} 操作失敗',
    'login.title': 'Linux Service Manager',
    'login.subtitle': '請登入以管理系統服務',
    'login.username': '帳號',
    'login.password': '密碼',
    'login.submit': '登入',
    'login.error': '帳號或密碼錯誤',
    'status.load.loaded': '已載入',
    'status.load.not-found': '未找到',
    'status.load.bad-setting': '設定錯誤',
    'status.load.error': '錯誤',
    'status.load.masked': '已遮蔽',
    'status.load.stub': '存根',
    'status.active.active': '啟用中',
    'status.active.inactive': '未啟用',
    'status.active.failed': '失敗',
    'status.active.activating': '啟用中',
    'status.active.deactivating': '停用中',
    'status.active.reloading': '重載中',
    'status.sub.running': '執行中',
    'status.sub.dead': '已停止',
    'status.sub.exited': '已退出',
    'status.sub.failed': '失敗',
    'status.sub.auto-restart': '自動重啟',
    'status.sub.plugged': '已插入',
    'status.sub.mounted': '已掛載',
    'status.sub.waiting': '等待中',
    'status.sub.listening': '監聽中',
    'autoStart.na': '不適用',
    'autoStart.on': 'ON',
    'autoStart.off': 'OFF',
    'autoStart.enableAria': '開啟 {name} 的自動啟動',
    'autoStart.disableAria': '關閉 {name} 的自動啟動',
  }

  const expectedEn: Record<string, string> = {
    'stats.total': 'Total Services',
    'stats.running': 'Running',
    'stats.failed': 'Failed',
    'search.placeholder': 'Search services...',
    'search.empty': 'No services matching "{term}"',
    'search.aria': 'Search services',
    'search.clear.aria': 'Clear search',
    'search.clear.title': 'Clear search',
    'empty.state': 'No services found or unable to connect to systemd.',
    'action.start': 'Start',
    'action.stop': 'Stop',
    'action.restart': 'Restart',
    'action.start.aria': 'Start {name}',
    'action.stop.aria': 'Stop {name}',
    'action.restart.aria': 'Restart {name}',
    'locked.badge': '🔒 Locked',
    'locked.tooltip': 'This service is protected. Set the UNLOCKED_SERVICES environment variable to unlock.',
    'tab.my': 'My Services',
    'tab.system': 'System Services',
    'header.refresh': '🔄 Refresh',
    'header.logout': '🚪 Logout',
    'header.refresh.aria': 'Refresh',
    'header.logout.aria': 'Logout',
    'lang.toggle.title': 'Switch language',
    'theme.toggle': 'Toggle theme',
    'theme.toggle.title': 'Toggle dark/light theme',
    'col.name': 'Name',
    'col.load': 'Load',
    'col.active': 'Active',
    'col.sub': 'Sub',
    'col.autoStart': 'Auto-start',
    'col.actions': 'Actions',
    'caption.title': 'Service List',
    'caption.sub': '— Click action buttons to manage services',
    'modal.title': '⚠️ Confirm Action',
    'modal.cancel': 'Cancel',
    'modal.confirm': 'Confirm',
    'modal.stop': 'Are you sure you want to stop {name}?',
    'modal.restart': 'Are you sure you want to restart {name}?',
    'modal.disable': 'Are you sure you want to disable auto-start for {name}? This service will not start automatically on next boot.',
    'toast.started': '{name} started',
    'toast.stopped': '{name} stopped',
    'toast.restarted': '{name} restarted',
    'toast.enabled': '{name} enabled for auto-start',
    'toast.disabled': '{name} disabled for auto-start',
    'toast.error': '{name} operation failed',
    'login.title': 'Linux Service Manager',
    'login.subtitle': 'Sign in to manage system services',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign In',
    'login.error': 'Invalid username or password',
    'status.load.loaded': 'Loaded',
    'status.load.not-found': 'Not Found',
    'status.load.bad-setting': 'Bad Setting',
    'status.load.error': 'Error',
    'status.load.masked': 'Masked',
    'status.load.stub': 'Stub',
    'status.active.active': 'Active',
    'status.active.inactive': 'Inactive',
    'status.active.failed': 'Failed',
    'status.active.activating': 'Activating',
    'status.active.deactivating': 'Deactivating',
    'status.active.reloading': 'Reloading',
    'status.sub.running': 'Running',
    'status.sub.dead': 'Dead',
    'status.sub.exited': 'Exited',
    'status.sub.failed': 'Failed',
    'status.sub.auto-restart': 'Auto-restart',
    'status.sub.plugged': 'Plugged',
    'status.sub.mounted': 'Mounted',
    'status.sub.waiting': 'Waiting',
    'status.sub.listening': 'Listening',
    'autoStart.na': 'N/A',
    'autoStart.on': 'ON',
    'autoStart.off': 'OFF',
    'autoStart.enableAria': 'Enable auto-start for {name}',
    'autoStart.disableAria': 'Disable auto-start for {name}',
  }

  it('所有 key 都有 zh-TW 翻譯', async () => {
    setNavigatorLanguage('zh-TW')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()

    for (const key of allKeys) {
      const expected = expectedZhTW[key]
      if (expected === undefined) {
        throw new Error(`測試資料缺少 ${key} 的預期值`)
      }
      expect(t(key), `key "${key}" 的 zh-TW 翻譯不符`).toBe(expected)
    }
  })

  it('所有 key 都有 en 翻譯', async () => {
    setNavigatorLanguage('en-US')
    const { useI18n } = await import('../composables/useI18n')
    const { t } = useI18n()

    for (const key of allKeys) {
      const expected = expectedEn[key]
      if (expected === undefined) {
        throw new Error(`測試資料缺少 ${key} 的預期值`)
      }
      expect(t(key), `key "${key}" 的 en 翻譯不符`).toBe(expected)
    }
  })

  it('所有 key 在 en 和 zh-TW 都有定義且不為空字串', async () => {
    // 每個 key 在兩個語系下都不該回傳 key 本身（那代表翻譯不存在）
    setNavigatorLanguage('zh-TW')
    const { useI18n: useI18nZH } = await import('../composables/useI18n')
    const { t: tZH, setLang } = useI18nZH()

    for (const key of allKeys) {
      const zh = tZH(key)
      expect(zh, `zh-TW: key "${key}" 不存在翻譯，回傳了 key 本身`).not.toBe(key)
    }

    setLang('en')
    for (const key of allKeys) {
      const en = tZH(key)
      expect(en, `en: key "${key}" 不存在翻譯，回傳了 key 本身`).not.toBe(key)
    }
  })
})
