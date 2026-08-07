import { ref, readonly } from 'vue'
import type { Ref } from 'vue'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

const toasts: Ref<Toast[]> = ref([])
let nextId = 0

function showToast(message: string, type: 'success' | 'error' = 'success', duration = 3500) {
  const id = nextId++
  toasts.value.push({ id, message, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, duration)
}

export function useToast() {
  return { toasts: readonly(toasts), showToast }
}
