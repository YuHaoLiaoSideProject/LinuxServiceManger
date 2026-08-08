import { describe, it, expect, vi, beforeEach } from 'vitest'

function createMockLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string): string | null => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
  }
}

function createMockMatchMedia(matches: boolean) {
  return vi.fn((_query: string) => ({
    matches,
    media: _query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('useTheme — 主題切換', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', createMockLocalStorage())
    // Mock document.documentElement
    const docEl = document.documentElement
    docEl.setAttribute = vi.fn()
  })

  it('toggleTheme() 在 dark ↔ light 之間切換', async () => {
    window.matchMedia = createMockMatchMedia(false) // prefers light
    const { useTheme } = await import('../composables/useTheme')
    const { theme, toggleTheme } = useTheme()

    expect(theme.value).toBe('light')

    toggleTheme()
    expect(theme.value).toBe('dark')

    toggleTheme()
    expect(theme.value).toBe('light')
  })

  it('setTheme("dark") 設定 document.documentElement data-theme 屬性', async () => {
    window.matchMedia = createMockMatchMedia(false)
    const { useTheme } = await import('../composables/useTheme')
    const { theme, setTheme } = useTheme()

    setTheme('dark')
    expect(theme.value).toBe('dark')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark')
  })

  it('setTheme("light") 設定 document.documentElement data-theme="light"', async () => {
    window.matchMedia = createMockMatchMedia(true)
    const { useTheme } = await import('../composables/useTheme')
    const { theme, setTheme } = useTheme()

    setTheme('light')
    expect(theme.value).toBe('light')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light')
  })

  it('localStorage 儲存主題偏好', async () => {
    window.matchMedia = createMockMatchMedia(false)
    const { useTheme } = await import('../composables/useTheme')
    const { toggleTheme } = useTheme()

    toggleTheme() // light → dark
    expect(localStorage.setItem).toHaveBeenCalledWith('lms-theme', 'dark')

    toggleTheme() // dark → light
    expect(localStorage.setItem).toHaveBeenCalledWith('lms-theme', 'light')
  })

  it('無 localStorage 時依 window.matchMedia 決定', async () => {
    // System prefers dark
    window.matchMedia = createMockMatchMedia(true)
    const { useTheme: useThemeDark } = await import('../composables/useTheme')
    const { theme: themeDark } = useThemeDark()
    expect(themeDark.value).toBe('dark')

    // Reset and test light preference
    vi.resetModules()
    vi.stubGlobal('localStorage', createMockLocalStorage())
    window.matchMedia = createMockMatchMedia(false)
    const { useTheme: useThemeLight } = await import('../composables/useTheme')
    const { theme: themeLight } = useThemeLight()
    expect(themeLight.value).toBe('light')
  })

  it('有 localStorage 時優先使用 localStorage', async () => {
    // localStorage says 'dark', but system prefers light
    const ls = createMockLocalStorage()
    ls.getItem = vi.fn((key: string): string | null => key === 'lms-theme' ? 'dark' : null)
    vi.stubGlobal('localStorage', ls)
    window.matchMedia = createMockMatchMedia(false) // system prefers light

    const { useTheme } = await import('../composables/useTheme')
    const { theme } = useTheme()
    expect(theme.value).toBe('dark') // localStorage wins
  })
})
