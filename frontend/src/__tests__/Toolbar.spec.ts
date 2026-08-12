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

  it('工具列沒有狀態過濾 pills（已移至 StatsBar 卡片）', () => {
    const wrapper = mount(Toolbar, { props: defaultProps })

    expect(wrapper.find('.status-filters').exists()).toBe(false)
    expect(wrapper.findAll('.btn-status').length).toBe(0)
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
})
