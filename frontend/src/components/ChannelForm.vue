<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Channel, ChannelPayload, ChannelType, TriggerEvent, HttpMethod } from '../types/notify'
import { useServiceStore } from '../stores/service'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'

const props = defineProps<{ channel: Channel | null }>()
const emit = defineEmits<{ close: []; save: [payload: ChannelPayload] }>()

const { t } = useI18n()
const { showToast } = useToast()
const serviceStore = useServiceStore()

const form = reactive({
  type: '' as ChannelType | '',
  name: '',
  url: '',
  token: '',
  chatId: '',
  subChatId: '',
  method: 'POST' as HttpMethod,
  headers: [{ key: '', value: '' }] as Array<{ key: string; value: string }>,
  events: [] as TriggerEvent[],
  all_services: true,
  services: [] as string[],
})
const saving = ref(false)
const errors = ref<Record<string, string>>({})
const serviceKeyword = ref('')

// 編輯模式預填
if (props.channel) {
  form.type = props.channel.type
  form.name = props.channel.name
  form.url = props.channel.url || ''
  form.token = props.channel.token || ''
  form.chatId = props.channel.chat_id || ''
  form.subChatId = props.channel.sub_chat_id || ''
  form.method = props.channel.method || 'POST'
  form.headers = Object.entries(props.channel.headers || {}).map(([key, value]) => ({ key, value }))
  if (form.headers.length === 0) form.headers = [{ key: '', value: '' }]
  form.events = [...props.channel.events]
  form.all_services = props.channel.all_services
  form.services = [...(props.channel.services || [])]
}

const allTriggerEvents: TriggerEvent[] = ['started', 'stopped', 'failed', 'restarted']

const filteredServices = computed(() => {
  const kw = serviceKeyword.value.trim().toLowerCase()
  const list = serviceStore.services.map(s => s.name)
  return kw ? list.filter(n => n.toLowerCase().includes(kw)) : list
})

function toggleEvent(ev: TriggerEvent): void {
  const idx = form.events.indexOf(ev)
  if (idx === -1) form.events.push(ev)
  else form.events.splice(idx, 1)
}

function addHeader(): void {
  form.headers.push({ key: '', value: '' })
}

function buildPayload(): ChannelPayload {
  const headers: Record<string, string> = {}
  for (const h of form.headers) {
    if (h.key.trim()) headers[h.key.trim()] = h.value
  }
  return {
    type: form.type as ChannelType,
    name: form.name,
    url: form.url,
    token: form.token,
    chat_id: form.chatId,
    sub_chat_id: form.subChatId,
    method: form.method,
    headers,
    events: [...form.events],
    all_services: form.all_services,
    services: [...form.services],
  }
}

function handleSubmit(): void {
  errors.value = {}
  // headers 上限（先於其他驗證，供測試 F-CF-10 直接觸發）
  if (form.headers.length > 10) {
    showToast('自訂 Headers 最多 10 組')
    return
  }
  // 必填：type / url（或 telegram token+chatId）
  if (!form.type) {
    showToast('請填寫必要欄位')
    return
  }
  if (form.type === 'telegram') {
    if (!form.token.trim() || !form.chatId.trim()) {
      errors.value.token = 'required'
      errors.value.chatId = 'required'
      showToast('請填寫必要欄位')
      return
    }
  } else if (!form.url.trim()) {
    errors.value.url = 'required'
    showToast('請填寫必要欄位')
    return
  }
  if (form.events.length === 0) {
    showToast('請至少勾選一個觸發事件')
    return
  }
  emit('save', buildPayload())
}
</script>

<template>
  <form class="channel-form" @submit.prevent="handleSubmit">
    <h3 v-if="channel" class="channel-form-title">編輯 Channel：{{ channel.name }}</h3>

    <div v-if="Object.keys(errors).length" class="form-alert" role="alert">
      <span aria-hidden="true">⚠</span> 請填寫必要欄位
    </div>

    <div class="form-grid">
      <div class="form-field">
        <label for="channel-type">Channel 類型</label>
        <select id="channel-type" v-model="form.type" data-testid="channel-type">
          <option value="" disabled>請選擇類型</option>
          <option value="slack">Slack</option>
          <option value="discord">Discord</option>
          <option value="telegram">Telegram</option>
          <option value="custom">自訂 Webhook</option>
        </select>
      </div>

      <div class="form-field">
        <label for="channel-name">Channel 名稱</label>
        <input id="channel-name" v-model="form.name" placeholder="Channel 名稱" :class="{ 'field-error': errors.name }" />
      </div>
    </div>

    <div class="form-grid">
      <template v-if="form.type === 'slack' || form.type === 'discord' || form.type === 'custom'">
        <div class="form-field form-field--full">
          <label for="channel-url">Webhook URL</label>
          <input
            id="channel-url"
            v-model="form.url"
            :placeholder="form.type === 'discord' ? 'https://discord.com/api/webhooks/...' : (form.type === 'custom' ? 'https://...' : 'https://hooks.slack.com/services/...')"
            :class="{ 'field-error': errors.url }"
          />
        </div>
      </template>
      <template v-else-if="form.type === 'telegram'">
        <div class="form-field form-field--full">
          <label for="channel-token">Bot Token</label>
          <input id="channel-token" v-model="form.token" type="password" placeholder="123456789:AA..." :class="{ 'field-error': errors.token }" />
        </div>
        <div class="form-field form-field--full">
          <label for="channel-chatid">Chat ID（整數或 @channelusername）</label>
          <input id="channel-chatid" v-model="form.chatId" placeholder="123456789 或 @channelusername" :class="{ 'field-error': errors.chatId }" />
        </div>
        <div class="form-field form-field--full">
          <label for="channel-sub-chatid">子 Chat ID（選填，forum topic 的 message_thread_id）</label>
          <input id="channel-sub-chatid" v-model="form.subChatId" placeholder="選填，例如 42" data-testid="channel-sub-chatid" />
        </div>
        <p class="field-hint">請先至 @BotFather 建立 bot 取得 token，並向 @userinfobot 取得 chat_id</p>
      </template>
    </div>

    <template v-if="form.type === 'custom'">
      <div class="form-grid">
        <div class="form-field form-field--full">
          <label for="channel-method">HTTP Method</label>
          <select id="channel-method" v-model="form.method" data-testid="channel-method">
            <option>POST</option>
            <option>PUT</option>
          </select>
        </div>
      </div>
      <div class="headers-editor">
        <div class="headers-editor-head">
          <span class="headers-editor-title">Headers</span>
          <button type="button" data-testid="header-add" @click="addHeader">＋ {{ t('notify.addHeader') }}</button>
        </div>
        <div v-for="(h, i) in form.headers" :key="i" class="header-row">
          <input v-model="h.key" placeholder="Header 名稱" aria-label="Header 名稱" />
          <input v-model="h.value" placeholder="值" aria-label="Header 值" />
          <button type="button" class="header-remove" :aria-label="`移除 Header ${i + 1}`" @click="form.headers.splice(i, 1)">✕</button>
        </div>
      </div>
    </template>

    <fieldset class="form-section">
      <legend>觸發事件</legend>
      <div class="event-options">
        <label v-for="ev in allTriggerEvents" :key="ev" class="checkbox event-chip">
          <input type="checkbox" :checked="form.events.includes(ev)" @change="toggleEvent(ev)" />
          <span>{{ ev }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset class="form-section">
      <legend>服務範圍</legend>
      <div class="scope-options">
        <label class="checkbox"><input type="radio" v-model="form.all_services" :value="true" /> 全部服務</label>
        <label class="checkbox"><input type="radio" v-model="form.all_services" :value="false" /> 指定服務</label>
      </div>
      <div v-if="!form.all_services" class="service-multiselect-wrap">
        <input v-model="serviceKeyword" placeholder="搜尋服務..." class="service-search" />
        <div class="service-multiselect">
          <label v-for="name in filteredServices" :key="name" class="checkbox">
            <input type="checkbox" :value="name" v-model="form.services" /> {{ name }}
          </label>
        </div>
        <div class="selected-services">
          <span v-for="s in form.services" :key="s" class="service-chip">{{ s }} ✕</span>
        </div>
      </div>
    </fieldset>

    <div class="form-actions">
      <button type="button" class="btn btn-secondary" @click="$emit('close')">取消</button>
      <button type="submit" class="btn btn-primary" :disabled="saving" data-testid="channel-save">
        <span v-if="saving" class="spinner" aria-hidden="true" /> {{ saving ? '儲存中...' : '儲存' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
/* ── 表單卡片（§4.2）── */
.channel-form {
  background: var(--lms-surface);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  box-shadow: var(--lms-shadow);
  padding: 1.25rem;
  margin-bottom: 1.25rem;
}
.channel-form-title {
  margin: 0 0 1rem;
  font-size: 1.05rem;
}

/* 驗證錯誤（role=alert） */
.form-alert {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--lms-danger-light);
  border: 1px solid var(--lms-danger-border);
  color: var(--lms-danger);
  border-radius: var(--lms-radius-sm);
  padding: 0.5rem 0.75rem;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

/* 2 欄 grid（mobile 單欄） */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem 1rem;
  margin-bottom: 0.9rem;
}
.form-grid:empty {
  display: none;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.form-field--full {
  grid-column: 1 / -1;
}
.form-field label,
.form-section legend {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--lms-muted);
}

/* 文字型輸入與下拉 */
.channel-form input:not([type='checkbox']):not([type='radio']),
.channel-form select {
  height: var(--lms-h);
  min-height: var(--lms-h);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  background: var(--lms-surface);
  color: var(--lms-text);
  padding: 0 0.6rem;
  font-size: 0.9rem;
  transition: border-color var(--lms-transition), box-shadow var(--lms-transition);
}
.channel-form input:not([type='checkbox']):not([type='radio']):focus,
.channel-form select:focus {
  border-color: var(--lms-accent);
  box-shadow: 0 0 0 3px var(--lms-accent-light);
  outline: none;
}
.field-error {
  border-color: var(--lms-danger) !important;
}
.field-error:focus {
  box-shadow: 0 0 0 3px var(--lms-danger-light) !important;
}
.field-hint {
  font-size: 0.75rem;
  color: var(--lms-muted);
  margin: 0;
  grid-column: 1 / -1;
}

/* ── Headers 編輯器 ── */
.headers-editor {
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  padding: 0.75rem;
  margin-bottom: 0.9rem;
  background: var(--lms-surface-2);
}
.headers-editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.headers-editor-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--lms-muted);
}
.headers-editor-head button {
  height: var(--lms-h);
  border: 1px solid var(--lms-border);
  background: var(--lms-surface);
  color: var(--lms-accent);
  border-radius: var(--lms-radius-sm);
  padding: 0 0.6rem;
  cursor: pointer;
  font-size: 0.8rem;
}
.headers-editor-head button:hover {
  border-color: var(--lms-accent);
}
.header-row {
  display: grid;
  grid-template-columns: 1fr 1fr 32px;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  align-items: center;
}
.header-remove {
  height: var(--lms-h);
  border: 1px solid var(--lms-border);
  background: transparent;
  color: var(--lms-muted);
  border-radius: var(--lms-radius-sm);
  cursor: pointer;
}
.header-remove:hover {
  color: var(--lms-danger);
  border-color: var(--lms-danger);
}

/* ── 觸發事件 chips / 服務範圍 ── */
.form-section {
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  padding: 0.75rem 0.9rem;
  margin: 0 0 0.9rem;
}
.form-section legend {
  padding: 0 0.4rem;
}
.event-options,
.scope-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: var(--lms-text);
  cursor: pointer;
}
.checkbox input {
  width: auto;
  height: auto;
  accent-color: var(--lms-accent);
}
.event-chip {
  position: relative;
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--lms-border);
  border-radius: 999px;
  background: var(--lms-surface-2);
  font-size: 0.78rem;
  transition: border-color var(--lms-transition), background var(--lms-transition), color var(--lms-transition);
}
.event-chip:hover {
  border-color: var(--lms-accent);
}
.event-chip input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.event-chip:has(input:checked) {
  background: var(--lms-accent-light);
  border-color: var(--lms-accent);
  color: var(--lms-accent);
}

.service-multiselect-wrap {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.service-multiselect {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  padding: 0.5rem;
}
.selected-services {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.service-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--lms-accent-light);
  color: var(--lms-accent);
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  font-size: 0.78rem;
}

/* ── 動作列 ── */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}
.channel-form .btn {
  min-height: var(--lms-h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.5rem 1.2rem;
  border-radius: var(--lms-radius-sm);
  font-size: 0.9rem;
  cursor: pointer;
}
.channel-form .btn-primary {
  background: var(--lms-accent);
  color: #fff;
  border: none;
}
.channel-form .btn-primary:hover:not(:disabled) {
  background: var(--lms-accent-hover);
}
.channel-form .btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.channel-form .btn-secondary {
  background: transparent;
  border: 1px solid var(--lms-border);
  color: var(--lms-text);
}
.channel-form .btn-secondary:hover {
  background: var(--lms-surface-2);
}
.channel-form .btn:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── RWD：mobile 單欄 + 44px 觸控目標 ── */
@media (max-width: 767px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-field--full {
    grid-column: auto;
  }
  .header-row {
    grid-template-columns: 1fr;
  }
  .channel-form input:not([type='checkbox']):not([type='radio']),
  .channel-form select {
    height: var(--lms-h-mobile);
    font-size: 16px;
  }
  .channel-form .btn {
    min-height: var(--lms-h-mobile);
    flex: 1;
    font-size: 1rem;
  }
}
</style>
