import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Toast } from '../composables/useToast'
import ToastContainer from '../components/ToastContainer.vue'

// Create a real reactive ref for toasts
const mockToasts = ref<Toast[]>([])

vi.mock('../composables/useToast', () => ({
  useToast: () => ({
    toasts: mockToasts,
    showToast: vi.fn(),
  }),
}))

describe('ToastContainer — 通知容器', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockToasts.value = []
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountContainer(toasts: Toast[]) {
    mockToasts.value = toasts
    return mount(ToastContainer)
  }

  it('無 toast 時不渲染', () => {
    mountContainer([])

    expect(document.body.querySelectorAll('.toast').length).toBe(0)
  })

  it('有 toast 時渲染通知', () => {
    mountContainer([
      { id: 1, message: 'nginx 已啟動', type: 'success' as const },
    ])

    const toastElements = document.body.querySelectorAll('.toast')
    expect(toastElements.length).toBe(1)
    expect(toastElements[0].textContent).toContain('nginx 已啟動')
  })

  it('success 使用綠色樣式 .toast-success', () => {
    mountContainer([
      { id: 1, message: '成功訊息', type: 'success' as const },
    ])

    const toastEl = document.body.querySelector('.toast')!
    expect(toastEl).toBeTruthy()
    expect(toastEl.classList.contains('toast-success')).toBe(true)
    expect(toastEl.textContent).toContain('✅')
    expect(toastEl.textContent).toContain('成功訊息')
  })

  it('error 使用紅色樣式 .toast-error', () => {
    mountContainer([
      { id: 1, message: '操作失敗', type: 'error' as const },
    ])

    const toastEl = document.body.querySelector('.toast')!
    expect(toastEl).toBeTruthy()
    expect(toastEl.classList.contains('toast-error')).toBe(true)
    expect(toastEl.textContent).toContain('❌')
    expect(toastEl.textContent).toContain('操作失敗')
  })

  it('多個 toast 都正確渲染', () => {
    mountContainer([
      { id: 1, message: 'nginx 已啟動', type: 'success' as const },
      { id: 2, message: 'ssh 操作失敗', type: 'error' as const },
      { id: 3, message: 'myapp 已重啟', type: 'success' as const },
    ])

    const toastElements = document.body.querySelectorAll('.toast')
    expect(toastElements.length).toBe(3)

    expect(toastElements[0].classList.contains('toast-success')).toBe(true)
    expect(toastElements[0].textContent).toContain('nginx 已啟動')

    expect(toastElements[1].classList.contains('toast-error')).toBe(true)
    expect(toastElements[1].textContent).toContain('ssh 操作失敗')

    expect(toastElements[2].classList.contains('toast-success')).toBe(true)
    expect(toastElements[2].textContent).toContain('myapp 已重啟')
  })

  it('toast 有 role="status" 無障礙屬性', () => {
    mountContainer([
      { id: 1, message: 'test', type: 'success' as const },
    ])

    expect(document.body.querySelector('[role="status"]')).toBeTruthy()
  })

  it('container 有 aria-live="polite"', () => {
    mountContainer([])

    const container = document.body.querySelector('#toast-container')
    expect(container).toBeTruthy()
    expect(container!.getAttribute('aria-live')).toBe('polite')
  })
})
