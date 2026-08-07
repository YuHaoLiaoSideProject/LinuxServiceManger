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
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

describe('Toolbar — 工具列', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('搜尋欄輸入 emit search 事件', async () => {
    const wrapper = mount(Toolbar)

    const input = wrapper.find('input[type="search"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toBe('搜尋服務名稱...')

    await input.setValue('nginx')

    const emitted = wrapper.emitted('search')
    expect(emitted).toBeTruthy()
    expect(emitted![emitted!.length - 1]).toEqual(['nginx'])
  })

  it('搜尋後點擊清除按鈕清空搜尋並 emit search("")', async () => {
    const wrapper = mount(Toolbar)

    const input = wrapper.find('input[type="search"]')
    await input.setValue('nginx')

    // Clear button should be visible
    const clearBtn = wrapper.find('.search-clear')
    expect(clearBtn.exists()).toBe(true)

    await clearBtn.trigger('click')

    expect((input.element as HTMLInputElement).value).toBe('')
    const emitted = wrapper.emitted('search')
    expect(emitted![emitted!.length - 1]).toEqual([''])
  })

  it('搜尋為空時不顯示清除按鈕', () => {
    const wrapper = mount(Toolbar)

    // v-show hides via display:none; element still in DOM
    const el = wrapper.find('.search-clear').element as HTMLElement
    expect(el.style.display).toBe('none')
  })

  it('搜尋關鍵字後清除按鈕可見', async () => {
    const wrapper = mount(Toolbar)

    const input = wrapper.find('input[type="search"]')
    await input.setValue('test')

    expect(wrapper.find('.search-clear.visible').exists()).toBe(true)
  })
})
