import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Toolbar from '../components/Toolbar.vue'

// Mock i18n
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'search.placeholder': '搜尋服務名稱...',
        'search.aria': '搜尋服務',
        'search.clear.aria': '清除搜尋',
        'search.clear.title': '清除',
        'search.regex.title': '切換正則搜尋',
        'filter.all': '全部',
        'filter.running': '執行中',
        'filter.failed': '失敗',
        'filter.inactive': '未啟用',
        'filter.count.shown': '顯示',
        'filter.count.total': '/ 共',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

const defaultProps = {
  statusFilter: 'all' as const,
  searchText: '',
  regexMode: false,
  regexError: null,
  filteredCount: 0,
  loading: false,
}

describe('Toolbar — 工具列', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('搜尋欄輸入 emit update:searchText 事件', async () => {
    const wrapper = mount(Toolbar, { props: defaultProps })

    const input = wrapper.find('input[type="search"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toBe('搜尋服務名稱...')

    await input.setValue('nginx')

    const emitted = wrapper.emitted('update:searchText')
    expect(emitted).toBeTruthy()
    expect(emitted![emitted!.length - 1]).toEqual(['nginx'])
  })

  it('搜尋後點擊清除按鈕清空搜尋並 emit clear-search', async () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, searchText: 'nginx' },
    })

    // Clear button should be visible
    const clearBtn = wrapper.find('.search-clear')
    expect(clearBtn.exists()).toBe(true)

    await clearBtn.trigger('click')

    const emitted = wrapper.emitted('clear-search')
    expect(emitted).toBeTruthy()
    expect(emitted!.length).toBe(1)
  })

  it('搜尋為空時不顯示清除按鈕', () => {
    const wrapper = mount(Toolbar, { props: defaultProps })

    // v-show hides via display:none; element still in DOM
    const el = wrapper.find('.search-clear').element as HTMLElement
    expect(el.style.display).toBe('none')
  })

  it('搜尋關鍵字後清除按鈕可見', () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, searchText: 'test' },
    })

    expect(wrapper.find('.search-clear.visible').exists()).toBe(true)
  })

  it('顯示四個狀態過濾按鈕', () => {
    const wrapper = mount(Toolbar, { props: defaultProps })

    const statusBtns = wrapper.findAll('.btn-status')
    expect(statusBtns.length).toBe(4)
    expect(statusBtns[0].text()).toContain('全部')
    expect(statusBtns[1].text()).toContain('執行中')
    expect(statusBtns[2].text()).toContain('失敗')
    expect(statusBtns[3].text()).toContain('未啟用')
  })

  it('當前 active 狀態按鈕有 .active class', () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, statusFilter: 'running' },
    })

    const statusBtns = wrapper.findAll('.btn-status')
    expect(statusBtns[1].classes()).toContain('active')
    expect(statusBtns[0].classes()).not.toContain('active')
    expect(statusBtns[2].classes()).not.toContain('active')
    expect(statusBtns[3].classes()).not.toContain('active')
  })

  it('點擊狀態按鈕 emit set-status-filter', async () => {
    const wrapper = mount(Toolbar, { props: defaultProps })

    const statusBtns = wrapper.findAll('.btn-status')
    await statusBtns[1].trigger('click') // Running

    const emitted = wrapper.emitted('set-status-filter')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['running'])
  })

  it('loading 時狀態按鈕 disabled', () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, loading: true },
    })

    const statusBtns = wrapper.findAll('.btn-status')
    for (const btn of statusBtns) {
      expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('loading 時 regex 按鈕 disabled', () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, loading: true },
    })

    const regexBtn = wrapper.find('.btn-regex')
    expect((regexBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('regexMode 為 true 時 regex 按鈕有 .active class', () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, regexMode: true },
    })

    expect(wrapper.find('.btn-regex.active').exists()).toBe(true)
  })

  it('regexMode 為 true 時 placeholder 變為正則提示', () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, regexMode: true },
    })

    const input = wrapper.find('input[type="search"]')
    expect(input.attributes('placeholder')).toBe('正則搜尋，例如：nginx-.*')
  })

  it('regexError 不為 null 時顯示錯誤訊息', () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, regexError: 'Invalid regex: unmatched [' },
    })

    expect(wrapper.find('.regex-error').exists()).toBe(true)
    expect(wrapper.find('.regex-error').text()).toContain('Invalid regex')
  })

  it('regexError 為 null 時不顯示錯誤訊息', () => {
    const wrapper = mount(Toolbar, { props: defaultProps })

    expect(wrapper.find('.regex-error').exists()).toBe(false)
  })

  it('點擊 regex 按鈕 emit toggle-regex', async () => {
    const wrapper = mount(Toolbar, { props: defaultProps })

    await wrapper.find('.btn-regex').trigger('click')

    expect(wrapper.emitted('toggle-regex')).toBeTruthy()
  })

  it('顯示過濾後的服務數量（顯示 X / 共 Y）', () => {
    const wrapper = mount(Toolbar, {
      props: { ...defaultProps, filteredCount: 5, totalCount: 34 },
    })

    const text = wrapper.find('.filtered-count').text().replace(/\s+/g, ' ').trim()
    expect(text).toBe('顯示 5 / 共 34')
    expect(wrapper.find('.filtered-count b').text()).toBe('5')
  })

  it('狀態 pill 顯示計數 badge', () => {
    const wrapper = mount(Toolbar, {
      props: {
        ...defaultProps,
        counts: { all: 34, running: 12, failed: 2, inactive: 20 },
      },
    })

    const statusBtns = wrapper.findAll('.btn-status')
    expect(statusBtns[0].text()).toContain('34')
    expect(statusBtns[1].text()).toContain('12')
    expect(statusBtns[2].text()).toContain('2')
    expect(statusBtns[3].text()).toContain('20')
  })

  it('狀態 pill 使用 CSS 圓點而非 emoji 圖示', () => {
    const wrapper = mount(Toolbar, { props: defaultProps })

    const statusBtns = wrapper.findAll('.btn-status')
    for (const btn of statusBtns) {
      expect(btn.find('.dotp').exists()).toBe(true)
      expect(btn.text()).not.toContain('🟢')
      expect(btn.text()).not.toContain('🔴')
      expect(btn.text()).not.toContain('⚪')
    }
  })
})
