<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { Node, NodePayload } from '../types/node'
import { createNode, updateNode, testConnection } from '../api/client'
import { useToast } from '../composables/useToast'

const props = defineProps<{ node: Node | null }>()  // null = 新增
const emit = defineEmits<{ close: []; saved: [] }>()

const { showToast } = useToast()
const overlayEl = ref<HTMLElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const form = reactive({
  name: props.node?.name ?? '',
  address: props.node?.address ?? '',
  tls_fingerprint: props.node?.tls_fingerprint ?? '',
  token: '',
  notes: props.node?.notes ?? '',
})
const errors = ref<Record<string, string>>({})
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const saving = ref(false)

/** 必填欄位驗證（BDD @validation）：名稱與位址空白 → 紅色標示且不發送 POST /api/v1/nodes */
function validate(): boolean {
  errors.value = {}
  if (!form.name.trim()) errors.value.name = '節點名稱為必填'
  if (!form.address.trim()) errors.value.address = 'Agent 位址為必填'
  return Object.keys(errors.value).length === 0
}

/** 測試連線（BDD @node-mgmt @smoke）：POST /nodes/test-connection → 成功綠色提示 / 失敗紅色提示（Modal 保持開啟） */
async function handleTest(): Promise<void> {
  if (!form.address.trim()) { errors.value.address = '請先填寫 Agent 位址'; return }
  testing.value = true
  testResult.value = null
  try {
    const r = await testConnection({ address: form.address, tls_fingerprint: form.tls_fingerprint, token: form.token })
    testResult.value = { ok: true, message: `連線成功 — Agent v${r.version} @ ${r.hostname} (${r.os})` }
  } catch (e: any) {
    testResult.value = { ok: false, message: `無法連線：${e?.response?.data?.error || e.message}` }
  } finally {
    testing.value = false
  }
}

/** Focus trap + Esc 關閉（UIUX §7 4.1.2 / §5.3）：Modal 內 Tab 循環；Esc 關閉 */
function onOverlayKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key !== 'Tab') return
  const overlay = overlayEl.value
  if (!overlay) return
  const focusables = Array.from(
    overlay.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter(el => !el.hasAttribute('disabled'))
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && (active === first || !overlay.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !overlay.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  nameInput.value?.focus()
  document.body.style.overflow = 'hidden' // 背景捲動鎖定
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})

/** 註冊 / 儲存（BDD @happy-path / @duplicate / @error-handling / @node-mgmt 編輯）：
 * 新增成功 → Toast「節點 X 已註冊並上線」；註冊後節點離線 → Toast「節點 X 已註冊但無法連線」（由後端在註冊時健康檢查判定）；
 * 編輯儲存 → Toast「節點設定已更新」（BDD 編輯 Scenario / F-NM-04 / E2E-33）；409 名稱重複 → Toast 且 Modal 保持開啟。 */
async function handleSave(): Promise<void> {
  if (!validate()) return
  saving.value = true
  const payload: NodePayload = { name: form.name.trim(), address: form.address.trim(), tls_fingerprint: form.tls_fingerprint, token: form.token, notes: form.notes }
  try {
    if (props.node) {
      await updateNode(props.node.id, payload)   // 編輯：PUT，token 留空表示不變更（決策 5）
      showToast('節點設定已更新', 'success')
    } else {
      const saved = await createNode(payload)
      if (saved.status === 'online') showToast(`節點 ${saved.name} 已註冊並上線`, 'success')
      else showToast(`節點 ${saved.name} 已註冊但無法連線`, 'warning')
    }
    emit('saved')
  } catch (e: any) {
    const msg = e?.response?.data?.error || e.message
    showToast(msg.includes('重複') ? '節點名稱重複，請使用不同名稱' : msg, 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div ref="overlayEl" class="modal-overlay" role="presentation" @click.self="$emit('close')" @keydown="onOverlayKeydown">
    <div class="lms-modal node-form-modal" role="dialog" aria-modal="true" aria-labelledby="node-form-title">
      <h3 id="node-form-title">{{ props.node ? '編輯節點' : '新增節點' }}</h3>
      <form @submit.prevent="handleSave">
        <label for="node-form-name">節點名稱 <span class="req">*</span></label>
        <input id="node-form-name" ref="nameInput" v-model="form.name" :class="{ 'field-error': errors.name }" data-testid="node-name" />
        <p v-if="errors.name" class="field-error-text">{{ errors.name }}</p>

        <label>Agent 位址（host:port）<span class="req">*</span></label>
        <input v-model="form.address" placeholder="10.0.0.5:8443" :class="{ 'field-error': errors.address }" data-testid="node-address" />
        <p v-if="errors.address" class="field-error-text">{{ errors.address }}</p>

        <label>TLS 憑證指紋（選填）</label>
        <input v-model="form.tls_fingerprint" placeholder="SHA-256" />
        <label>API Token（選填）</label>
        <input v-model="form.token" type="password" :placeholder="props.node ? '留空表示不變更' : 'lsm_node_…'" />
        <label>備註（選填）</label>
        <input v-model="form.notes" />

        <p
          v-if="testResult"
          class="test-result"
          :class="testResult.ok ? 'test-ok' : 'test-fail'"
          role="status"
          aria-live="polite"
        >
          <svg v-if="testResult.ok" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          <span>{{ testResult.message }}</span>
        </p>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" @click="$emit('close')">取消</button>
          <button type="button" class="btn btn-secondary" :disabled="testing" data-testid="test-connection" @click="handleTest">
            <span v-if="testing" class="spinner-sm" /> 測試連線
          </button>
          <button type="button" class="btn btn-primary" :disabled="saving" data-testid="node-save" @click="handleSave">
            <span v-if="saving" class="spinner-sm" /> {{ props.node ? '儲存' : '註冊' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
