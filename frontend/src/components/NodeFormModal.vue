<script setup lang="ts">
import { ref, watch } from 'vue'
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
  }
  if (!address.value.trim()) {
    addressError.value = '請輸入 Agent 位址 (host:port)'
    valid = false
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
  if ((e.target as HTMLElement).classList.contains('lms-modal-overlay')) {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="lms-modal-overlay" @click="onOverlayClick">
      <div class="lms-modal node-form-modal" role="dialog" aria-modal="true">
        <h3>{{ mode === 'create' ? '新增節點' : '編輯節點' }}</h3>

        <form class="node-form" @submit.prevent="onSubmit">
          <!-- 節點名稱 -->
          <div class="node-form__field" :class="{ 'has-error': !!nameError }">
            <label for="node-name">節點名稱 <span class="required">*</span></label>
            <input id="node-name" v-model="name" type="text" placeholder="例如：production-web-1" />
            <span v-if="nameError" class="node-form__error">{{ nameError }}</span>
          </div>

          <!-- Agent 位址 -->
          <div class="node-form__field" :class="{ 'has-error': !!addressError }">
            <label for="node-address">Agent 位址 <span class="required">*</span></label>
            <input id="node-address" v-model="address" type="text" placeholder="host:port" />
            <span v-if="addressError" class="node-form__error">{{ addressError }}</span>
          </div>

          <!-- TLS 憑證指紋 -->
          <div class="node-form__field">
            <label for="node-tls">TLS 憑證指紋</label>
            <input id="node-tls" v-model="tlsFingerprint" type="text" placeholder="SHA-256 指紋（選填）" />
          </div>

          <!-- API Token -->
          <div v-if="mode === 'create'" class="node-form__field">
            <label for="node-token">API Token</label>
            <input id="node-token" v-model="token" type="password" placeholder="選填" />
          </div>

          <!-- 備註 -->
          <div class="node-form__field">
            <label for="node-note">備註</label>
            <textarea id="node-note" v-model="note" rows="2" placeholder="選填"></textarea>
          </div>

          <!-- 測試連線結果 -->
          <div v-if="testResult" class="node-form__result" :class="testResult.ok ? 'node-form__result--ok' : 'node-form__result--error'">
            <template v-if="testResult.ok">
              ✅ 連線成功 — 版本 {{ testResult.version || '未知' }}・主機 {{ testResult.hostname || '未知' }}
            </template>
            <template v-else>
              ❌ 連線失敗：{{ testResult.error || '未知錯誤' }}
            </template>
          </div>

          <!-- 表單錯誤 -->
          <div v-if="formError" class="node-form__form-error" role="alert">{{ formError }}</div>

          <!-- 操作按鈕 -->
          <div class="node-form__actions">
            <button type="button" class="secondary" :disabled="testing" @click="onTestConnection">
              {{ testing ? '測試中...' : '測試連線' }}
            </button>
            <div class="node-form__actions-right">
              <button type="button" class="secondary" @click="emit('close')">取消</button>
              <button type="submit" class="btn-primary" :disabled="submitting">
                {{ submitting ? '提交中...' : (mode === 'create' ? '建立節點' : '更新節點') }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.node-form-modal {
  max-width: 520px;
}

.node-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.node-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.node-form__field label {
  font-size: 0.85rem;
  font-weight: 600;
}

.node-form__field input,
.node-form__field textarea {
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  background: var(--lms-surface);
  font-size: 0.9rem;
}

.node-form__field.has-error input,
.node-form__field.has-error textarea {
  border-color: var(--lms-danger);
}

.required {
  color: var(--lms-danger);
}

.node-form__error {
  font-size: 0.8rem;
  color: var(--lms-danger);
}

.node-form__result {
  padding: 0.65rem 0.85rem;
  border-radius: var(--lms-radius-sm);
  font-size: 0.85rem;
}

.node-form__result--ok {
  background: var(--lms-success-light);
  color: var(--lms-success);
  border: 1px solid var(--lms-success-border);
}

.node-form__result--error {
  background: var(--lms-danger-light);
  color: var(--lms-danger);
  border: 1px solid var(--lms-danger-border);
}

.node-form__form-error {
  font-size: 0.85rem;
  color: var(--lms-danger);
  padding: 0.4rem 0;
}

.node-form__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.5rem;
}

.node-form__actions-right {
  display: flex;
  gap: 0.5rem;
}

.btn-primary {
  background: var(--lms-accent);
  color: #fff;
  border: none;
  padding: 0.45rem 1rem;
  border-radius: var(--lms-radius-sm);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
}

.btn-primary:hover {
  background: var(--lms-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
