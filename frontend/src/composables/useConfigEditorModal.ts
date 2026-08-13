import { ref, readonly } from 'vue'

// useConfigEditorModal — 桌面 Config Editor Modal 開啟狀態（module-level）
// 012 UIUX v2：桌面 ≥768px 以 Modal 呈現編輯器（不換 route）；手機 ≤767px 走全頁路由。
// 使用 module-level composable 而非 Pinia store，避免 ServiceRow→ServiceTable→DashboardView
// 冗長 emit 鏈，且測試環境不需額外建立 Pinia instance。

const isOpen = ref(false)
const serviceName = ref('')
const readOnly = ref(false)

export function useConfigEditorModal() {
  function openModal(name: string, opts: { readOnly?: boolean } = {}) {
    serviceName.value = name
    readOnly.value = opts.readOnly ?? false
    isOpen.value = true
  }

  function closeModal() {
    isOpen.value = false
  }

  return {
    open: readonly(isOpen),
    serviceName: readonly(serviceName),
    readOnly: readonly(readOnly),
    openModal,
    closeModal,
  }
}

// 桌面判定：≥768px 視為桌面（Modal 呈現）。
// 安全預設：無 window / 無 matchMedia（部分測試/舊環境）時視為桌面，避免進入點失效。
export function isDesktopViewport(): boolean {
  if (typeof window === 'undefined') return true
  if (typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(min-width: 768px)').matches
}
