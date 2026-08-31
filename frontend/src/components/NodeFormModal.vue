<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { ManagedNode, NodeFormInput, TestConnectionResult } from '../types/node'
import { createNode, updateNode, testConnection } from '../api/nodeApi'
import { useToast } from '../composables/useToast'

const props = defineProps<{
  mode: 'create' | 'edit'
  initialData?: ManagedNode
}>()

const emit = defineEmits<{
  close: []
  created: [node: ManagedNode]
  updated: [node: ManagedNode]
}>()

const { showToast } = useToast()

const name = ref('')
const address = ref('')
const tlsFingerprint = ref('')
const token = ref('')
const note = ref('')

const nameError = ref('')
const addressError = ref('')
const formError = ref('')

const testing = ref(false)
const testResult = ref<TestConnectionResult | null>(null)
const submitting = ref(false)

const nameInput = ref<HTMLInputElement>()
const addressInput = ref<HTMLInputElement>()

watch(() => props.initialData, (data) => {
  if (data && props.mode === 'edit') {
    name.value = data.name
    address.value = data.address
    tlsFingerprint.value = data.tls_fingerprint || ''
    note.value = data.note || ''
    token.value = ''
  }
}, { immediate: true })

function validate(): boolean {
  let valid = true
  nameError.value = ''
  addressError.value = ''
  formError.value = ''

  if (!name.value.trim()) {
    nameError.value = '請輸入節點名稱'
    valid = false
  } else if (name.value.includes('/')) {
    nameError.value = '節點名稱不可含 /'
    valid = false
  }

  if (!address.value.trim()) {
    addressError.value = '請輸入 Agent 位址 (host:port)'
    valid = false
  }

  if (!valid) {
    nextTick(() => {
      if (nameError.value && nameInput.value) {
        nameInput.value.focus()
      } else if (addressError.value && addressInput.value) {
        addressInput.value.focus()
      }
    })
  }

  return valid
}

async function onTestConnection() {
  if (!address.value.trim()) {
    addressError.value = '請先輸入 Agent 位址'
    return
  }
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await testConnection({
      address: address.value.trim(),
      tls_fingerprint: tlsFingerprint.value.trim() || undefined,
      token: token.value.trim() || undefined,
    })
  } catch (err: any) {
    testResult.value = { ok: false, error: err.response?.data?.error || '連線失敗' }
  } finally {
    testing.value = false
  }
}

async function onSubmit() {
  if (!validate()) return

  submitting.value = true
  formError.value = ''

  const body: NodeFormInput = {
    name: name.value.trim(),
    address: address.value.trim(),
    tls_fingerprint: tlsFingerprint.value.trim() || undefined,
    note: note.value.trim() || undefined,
  }

  if (props.mode === 'create') {
    body.token = token.value.trim() || undefined
  }

  try {
    if (props.mode === 'create') {
      const node = await createNode(body)
      showToast('節點已建立', 'success')
      emit('created', node)
    } else {
      const node = await updateNode(props.initialData!.id, body)
      showToast('節點已更新', 'success')
      emit('updated', node)
    }
  } catch (err: any) {
    if (err.response?.status === 409) {
      showToast('節點名稱重複', 'error')
      nameError.value = '節點名稱重複'
    } else {
      formError.value = err.response?.data?.error || '操作失敗'
    }
  } finally {
    submitting.value = false
  }
}

function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('nm-modal-overlay')) {
    emit('close')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="nm-modal-overlay" @click="onOverlayClick" @keydown="onKeydown">
      <div class="nm-modal nm-modal--form" role="dialog" aria-modal="true" :aria-label="mode === 'create' ? '新增節點' : `編輯節點 — ${initialData?.name || ''}`">
        <div class="nm-modal__head">
          <h3>{{ mode === 'create' ? '新增節點' : `編輯節點 — ${initialData?.name || ''}` }}</h3>
          <button class="nm-modal__close" @click="emit('close')" aria-label="關閉">&times;</button>
        </div>

        <form class="nm-modal__body" @submit.prevent="onSubmit">
          <!-- 節點 ID (edit mode only) -->
          <div v-if="mode === 'edit' && initialData" class="nm-form-group">
            <label class="nm-form-label">節點 ID</label>
            <input class="nm-form-input nm-form-input--readonly" :value="initialData.id" readonly tabindex="-1" />
            <div class="nm-form-hint">系統自動產生，不可編輯</div>
          </div>

          <!-- 節點名稱 -->
          <div class="nm-form-group" :class="{ 'has-error': !!nameError }">
            <label class="nm-form-label" for="nm-name">節點名稱 <span class="nm-form-req">*</span></label>
            <input
              id="nm-name"
              ref="nameInput"
              v-model="name"
              class="nm-form-input"
              :class="{ error: !!nameError }"
              type="text"
              placeholder="web-server-02"
              aria-describedby="nm-name-error"
            />
            <div class="nm-form-hint">1–64 字元，不可含 <code>/</code></div>
            <div v-if="nameError" id="nm-name-error" class="nm-form-error" role="alert">{{ nameError }}</div>
          </div>

          <!-- Agent 位址 -->
          <div class="nm-form-group" :class="{ 'has-error': !!addressError }">
            <label class="nm-form-label" for="nm-address">Agent 位址 <span class="nm-form-req">*</span></label>
            <input
              id="nm-address"
              ref="addressInput"
              v-model="address"
              class="nm-form-input"
              :class="{ error: !!addressError }"
              type="text"
              placeholder="192.168.1.100:8443"
              aria-describedby="nm-address-hint nm-address-error"
            />
            <div id="nm-address-hint" class="nm-form-hint">host:port 格式</div>
            <div v-if="addressError" id="nm-address-error" class="nm-form-error" role="alert">{{ addressError }}</div>
          </div>

          <!-- TLS 憑證指紋 -->
          <div class="nm-form-group">
            <label class="nm-form-label" for="nm-tls">TLS 憑證指紋</label>
            <input
              id="nm-tls"
              v-model="tlsFingerprint"
              class="nm-form-input"
              type="text"
              placeholder="選填，mTLS 時填入 SHA256 指紋"
            />
            <div class="nm-form-hint">選填。用於 mTLS 雙向驗證</div>
          </div>

          <!-- API Token -->
          <div v-if="mode === 'create'" class="nm-form-group">
            <label class="nm-form-label" for="nm-token">API Token</label>
            <input
              id="nm-token"
              v-model="token"
              class="nm-form-input"
              type="password"
              placeholder="選填"
            />
            <div class="nm-form-hint">選填。用於驗證 Manager 連線</div>
          </div>

          <!-- 備註 -->
          <div class="nm-form-group">
            <label class="nm-form-label" for="nm-note">備註</label>
            <textarea
              id="nm-note"
              v-model="note"
              class="nm-form-textarea"
              rows="2"
              placeholder="選填，最多 200 字"
            ></textarea>
          </div>

          <!-- 測試連線結果 -->
          <div v-if="testResult" class="nm-test-result" :class="testResult.ok ? 'nm-test-result--ok' : 'nm-test-result--error'" :role="testResult.ok ? 'status' : 'alert'" :aria-live="testResult.ok ? 'polite' : 'assertive'">
            <span class="nm-test-result__icon">{{ testResult.ok ? '✅' : '❌' }}</span>
            <div>
              <strong>{{ testResult.ok ? '連線成功' : '無法連線' }}</strong>
              <div class="nm-test-result__detail">
                <template v-if="testResult.ok">
                  Agent {{ testResult.version || '未知' }} · {{ testResult.hostname || '未知' }}<span v-if="testResult.os"> · {{ testResult.os }}</span>
                </template>
                <template v-else>
                  {{ testResult.error || '未知錯誤' }}
                </template>
              </div>
            </div>
          </div>

          <!-- 表單錯誤 -->
          <div v-if="formError" class="nm-form-form-error" role="alert">{{ formError }}</div>
        </form>

        <div class="nm-modal__foot">
          <button type="button" class="nm-btn nm-btn--secondary" :disabled="testing" @click="onTestConnection">
            <svg v-if="testing" class="nm-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke-dasharray="50" stroke-dashoffset="15"/></svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            {{ testing ? '測試中…' : '測試連線' }}
          </button>
          <div style="flex:1"></div>
          <button type="button" class="nm-btn nm-btn--ghost" @click="emit('close')">取消</button>
          <button type="submit" class="nm-btn nm-btn--primary" :disabled="submitting" @click="onSubmit">
            {{ submitting ? '提交中...' : (mode === 'create' ? '註冊' : '儲存') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ═══════════ Modal ═══════════ */
.nm-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.75rem;
}

.nm-modal {
  background: var(--lms-surface);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.nm-modal--form {
  max-width: 520px;
}

.nm-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--lms-border);
}

.nm-modal__head h3 {
  margin: 0;
  font-size: 1rem;
}

.nm-modal__close {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: var(--lms-muted);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  transition: all var(--lms-transition);
  line-height: 1;
}

.nm-modal__close:hover {
  color: var(--lms-text);
  background: var(--lms-surface-2);
}

.nm-modal__body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1;
}

.nm-modal__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--lms-border);
}

/* ═══════════ Form ═══════════ */
.nm-form-group {
  margin-bottom: 1rem;
}

.nm-form-group:last-child {
  margin-bottom: 0;
}

.nm-form-label {
  display: block;
  font-size: 0.82rem;
  font-weight: 600;
  margin-bottom: 0.3rem;
  color: var(--lms-text);
}

.nm-form-req {
  color: var(--lms-danger);
  margin-left: 2px;
}

.nm-form-input {
  width: 100%;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  height: var(--lms-h, 36px);
  padding: 0 0.7rem;
  font-size: 0.875rem;
  font: inherit;
  background: var(--lms-surface);
  color: var(--lms-text);
  transition: border-color var(--lms-transition), box-shadow var(--lms-transition);
}

.nm-form-input:focus {
  outline: none;
  border-color: var(--lms-accent);
  box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.5);
}

.nm-form-input.error {
  border-color: var(--lms-danger);
}

.nm-form-input.error:focus {
  box-shadow: 0 0 0 3px rgba(197, 34, 31, 0.3);
}

.nm-form-input--readonly {
  background: var(--lms-surface-2);
  color: var(--lms-muted);
  cursor: not-allowed;
}

.nm-form-textarea {
  width: 100%;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  min-height: 64px;
  padding: 0.5rem 0.7rem;
  font-size: 0.875rem;
  font: inherit;
  background: var(--lms-surface);
  color: var(--lms-text);
  resize: vertical;
  transition: border-color var(--lms-transition);
}

.nm-form-textarea:focus {
  outline: none;
  border-color: var(--lms-accent);
  box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.5);
}

.nm-form-hint {
  font-size: 0.75rem;
  color: var(--lms-muted);
  margin-top: 0.25rem;
}

.nm-form-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  background: var(--lms-surface-2);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.nm-form-error {
  font-size: 0.75rem;
  color: var(--lms-danger);
  margin-top: 0.25rem;
}

.nm-form-form-error {
  font-size: 0.85rem;
  color: var(--lms-danger);
  padding: 0.5rem 0;
}

/* ═══════════ Test Connection Result ═══════════ */
.nm-test-result {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.85rem;
  border-radius: var(--lms-radius-sm);
  margin-top: 0.75rem;
  font-size: 0.82rem;
  line-height: 1.5;
}

.nm-test-result--ok {
  background: var(--lms-success-light);
  border: 1px solid var(--lms-success-border);
  color: var(--lms-success);
}

.nm-test-result--error {
  background: var(--lms-danger-light);
  border: 1px solid var(--lms-danger-border);
  color: var(--lms-danger);
}

.nm-test-result__icon {
  font-size: 1.1rem;
  flex: none;
  margin-top: 1px;
}

.nm-test-result strong {
  display: block;
}

.nm-test-result__detail {
  font-size: 0.78rem;
  opacity: 0.85;
  margin-top: 0.15rem;
}

/* ═══════════ Buttons ═══════════ */
.nm-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: var(--lms-radius-sm);
  height: var(--lms-h, 36px);
  padding: 0 1rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--lms-transition);
  font: inherit;
  white-space: nowrap;
}

.nm-btn--primary {
  background: var(--lms-accent);
  color: #fff;
  border: none;
}

.nm-btn--primary:hover {
  background: var(--lms-accent-hover);
}

.nm-btn--primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.nm-btn--secondary {
  background: var(--lms-surface);
  color: var(--lms-text);
  border: 1px solid var(--lms-border);
}

.nm-btn--secondary:hover {
  border-color: var(--lms-accent);
  color: var(--lms-accent);
}

.nm-btn--secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.nm-btn--ghost {
  background: none;
  border: none;
  color: var(--lms-muted);
  padding: 0.3rem 0.5rem;
  font-weight: 400;
}

.nm-btn--ghost:hover {
  color: var(--lms-text);
  background: var(--lms-surface-2);
}

.nm-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ═══════════ Mobile ═══════════ */
@media (max-width: 767px) {
  .nm-modal-overlay {
    align-items: flex-end;
  }

  .nm-modal {
    max-width: 100%;
    border-radius: var(--lms-radius) var(--lms-radius) 0 0;
    max-height: 90vh;
  }
}
</style>
