import { describe, it, expect, vi, beforeEach } from 'vitest'

function createMockLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
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
    ls.getItem = vi.fn((key: string) => key === 'lms-lang' ? 'en' : null)
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
