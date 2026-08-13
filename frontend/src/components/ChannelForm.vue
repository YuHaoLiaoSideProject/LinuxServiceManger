<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { Channel, ChannelPayload, ChannelType, TriggerEvent, HttpMethod } from '../types/notify'
import { useServiceStore } from '../stores/service'
import { listServices } from '../api/client'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'
import ConfirmModal from './ConfirmModal.vue'

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
const showSystemServices = ref(false)

const dialogEl = ref<HTMLElement | null>(null)

const title = computed(() =>
  props.channel ? `編輯 Channel：${props.channel.name}` : t('notify.addChannel'),
)

// 編輯既有的 Telegram Channel 時，token 留空 = 保留原值
const isEditingTelegram = props.channel?.type === 'telegram'

// 編輯模式預填
if (props.channel) {
  form.type = props.channel.type
  form.name = props.channel.name
  form.url = props.channel.url || ''
  // Telegram token 由 API 回傳 masked（'****xxxx'），編輯時不預填、留空表示不變更
  form.token = ''
  form.chatId = props.channel.chat_id || ''
  form.subChatId = props.channel.sub_chat_id || ''
  form.method = props.channel.method || 'POST'
  form.headers = Object.entries(props.channel.headers || {}).map(([key, value]) => ({ key, value }))
  if (form.headers.length === 0) form.headers = [{ key: '', value: '' }]
  form.events = [...props.channel.events]
  form.all_services = props.channel.all_services
  form.services = [...(props.channel.services || [])]
}

// 擷取編輯預填（或新增空表單）後的初始快照，用於 dirty 偵測（決策 4 / §5.2）
const initialSnapshot = JSON.stringify(form)
const isDirty = computed(() => JSON.stringify(form) !== initialSnapshot)
const showConfirmClose = ref(false)

const allTriggerEvents: TriggerEvent[] = ['started', 'stopped', 'failed', 'restarted']

const myServices = computed(() => {
  const kw = serviceKeyword.value.trim().toLowerCase()
  return serviceStore.services.filter(s => !s.locked && (!kw || s.name.toLowerCase().includes(kw)))
})

const systemServices = computed(() => {
  const kw = serviceKeyword.value.trim().toLowerCase()
  return serviceStore.services.filter(s => s.locked && (!kw || s.name.toLowerCase().includes(kw)))
})

// 輸入關鍵字時自動展開系統服務，避免漏掉符合的結果
const systemExpanded = computed(() => showSystemServices.value || serviceKeyword.value.trim() !== '')

function handleClose(): void {
  // 表單有輸入時先跳出 ConfirmModal 確認，避免誤關丟失
  if (isDirty.value) {
    showConfirmClose.value = true
    return
  }
  emit('close')
}

function confirmDiscard(): void {
  showConfirmClose.value = false
  emit('close')
}

function closeConfirmModal(): void {
  showConfirmClose.value = false
  // 關閉 ConfirmModal 後焦點回到表單
  void nextTick().then(() => {
    dialogEl.value?.querySelector<HTMLElement>('[data-testid="channel-type"]')?.focus()
  })
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    // ConfirmModal 開啟時，Esc 等同取消（關閉 ConfirmModal），不要重複觸發 handleClose()
    if (showConfirmClose.value) {
      closeConfirmModal()
    } else {
      handleClose()
    }
    return
  }
  if (e.key !== 'Tab' || !dialogEl.value) return
  // ConfirmModal 開啟時不劫持 Tab，交由其上層互動（ConfirmModal 的 confirm 按鈕具 autofocus）
  if (showConfirmClose.value) return

  // focus trap：Tab / Shift+Tab 於 dialog 內循環
  const focusable = Array.from(
    dialogEl.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null
  const inDialog = !!active && dialogEl.value.contains(active)

  if (e.shiftKey) {
    if (active === first || !inDialog) {
      e.preventDefault()
      last.focus()
    }
  } else if (active === last || !inDialog) {
    e.preventDefault()
    first.focus()
  }
}

// 開啟時：鎖定背景捲動、焦點移至「類型下拉」、掛載 Esc/Tab 監聽
onMounted(async () => {
  // 直接進入 /notifications（未經 Dashboard 載入）時，補載服務清單
  if (serviceStore.services.length === 0) {
    try {
      serviceStore.setServices(await listServices())
    } catch {
      // 載入失敗不阻擋表單填寫
    }
  }
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', handleKeydown)
  await nextTick()
  dialogEl.value?.querySelector<HTMLElement>('[data-testid="channel-type"]')?.focus()
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeydown)
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
    // 編輯既有 Telegram Channel 時 token 可留空（保留原值）；建立或由其他類型轉來時必填
    const tokenRequired = !isEditingTelegram
    const missingToken = tokenRequired && !form.token.trim()
    const missingChatId = !form.chatId.trim()
    if (missingToken || missingChatId) {
      if (missingToken) errors.value.token = 'required'
      if (missingChatId) errors.value.chatId = 'required'
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
  <Teleport to="body">
    <div class="channel-form-overlay" @click.self="handleClose">
      <div
        ref="dialogEl"
        class="cf-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-form-title"
        tabindex="-1"
      >
        <header class="cf-head">
          <h2 id="channel-form-title" class="cf-title">{{ title }}</h2>
        </header>

        <form class="cf-body" @submit.prevent="handleSubmit" novalidate>
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
                <input id="channel-token" v-model="form.token" type="password" :placeholder="isEditingTelegram ? '留空則保留原 Token' : '123456789:AA...'" :class="{ 'field-error': errors.token }" />
              </div>
              <div class="form-field form-field--full">
                <label for="channel-chatid">Chat ID（整數或 @channelusername）</label>
                <input id="channel-chatid" v-model="form.chatId" placeholder="123456789 或 @channelusername" :class="{ 'field-error': errors.chatId }" />
              </div>
              <div class="form-field form-field--full">
                <label for="channel-sub-chatid">子 Chat ID（選填，forum topic 的 message_thread_id）</label>
                <input id="channel-sub-chatid" v-model="form.subChatId" placeholder="選填，例如 42" data-testid="channel-sub-chatid" />
              </div>
              <p class="field-hint">{{ isEditingTelegram ? '編輯時留空 Token 表示保留原值。' : '' }}請先至 @BotFather 建立 bot 取得 token，並向 @userinfobot 取得 chat_id</p>
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
              <div class="svc-list">
                <div class="service-group">
                  <div class="service-group-head">
                    <span class="service-group-label">我的服務</span>
                    <span class="service-group-count">{{ myServices.length }}</span>
                  </div>
                  <label v-for="s in myServices" :key="s.name" class="service-option">
                    <input type="checkbox" :value="s.name" v-model="form.services" />
                    <span class="service-option-name">{{ s.name }}</span>
                  </label>
                  <p v-if="!myServices.length" class="service-empty">沒有符合的服務</p>
                </div>

                <div class="service-group">
                  <button
                    type="button"
                    class="service-group-toggle"
                    :aria-expanded="systemExpanded"
                    @click="showSystemServices = !showSystemServices"
                  >
                    <span class="service-group-label">系統服務</span>
                    <span class="service-group-count">{{ systemServices.length }}</span>
                    <span class="service-group-chevron" aria-hidden="true">{{ systemExpanded ? '▾' : '▸' }}</span>
                  </button>
                  <template v-if="systemExpanded">
                    <label v-for="s in systemServices" :key="s.name" class="service-option">
                      <input type="checkbox" :value="s.name" v-model="form.services" />
                      <span class="service-option-name">{{ s.name }}</span>
                    </label>
                    <p v-if="!systemServices.length" class="service-empty">沒有符合的服務</p>
                  </template>
                </div>
              </div>
              <p class="selected-count">已選 {{ form.services.length }} 個服務</p>
            </div>
          </fieldset>

          <!-- 隱藏 submit 按鈕：保留 Enter 隱式提交（WCAG §2.1.1），實際儲存由 header/footer 按鈕觸發 -->
          <button type="submit" hidden aria-hidden="true" tabindex="-1">儲存</button>
        </form>

        <footer class="cf-foot">
          <button type="button" class="cf-btn cf-btn-secondary" @click="handleClose">取消</button>
          <button
            type="button"
            class="cf-btn cf-btn-primary"
            :disabled="saving"
            data-testid="channel-save-footer"
            @click="handleSubmit"
          >
            <span v-if="saving" class="spinner" aria-hidden="true" /> {{ saving ? '儲存中...' : '儲存' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>

  <ConfirmModal
    :show="showConfirmClose"
    message="變更尚未儲存，確定要捨棄嗎？"
    cancel-label="繼續編輯"
    confirm-label="捨棄變更"
    confirm-class="danger"
    @confirm="confirmDiscard"
    @cancel="closeConfirmModal"
  />
</template>

<style scoped>
/* ── Modal overlay / dialog（§4.2、§6、§8.2）── */
.channel-form-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  animation: cf-overlay-in 150ms ease-out;
}
@keyframes cf-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.cf-dialog {
  background: var(--lms-surface);
  border-radius: var(--lms-radius-lg);
  max-width: 720px;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--lms-shadow-lg);
  overflow: hidden;
  animation: cf-dialog-in 150ms ease-out;
}
@keyframes cf-dialog-in {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

/* header / footer sticky（flex-shrink:0 + 分隔線）*/
.cf-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--lms-border);
}
.cf-title {
  margin: 0;
  font-size: 1.1rem;
  line-height: 1.3;
}
.cf-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--lms-border);
}

/* body 內部捲動 */
.cf-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 1.25rem;
  min-height: 0;
}

/* ── 驗證錯誤（role=alert）── */
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
.cf-body input:not([type='checkbox']):not([type='radio']),
.cf-body select {
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
.cf-body input:not([type='checkbox']):not([type='radio']):focus,
.cf-body select:focus {
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
/* 「指定服務」多選清單：max-height 240px 內部捲動，避免雙層捲動陷阱 */
.svc-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  padding: 0.5rem;
  background: var(--lms-surface);
}

/* ── 服務分組（我的服務 / 系統服務）── */
.service-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.service-group-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.4rem;
}
.service-group-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.25rem 0.4rem;
  border: none;
  background: transparent;
  color: var(--lms-text);
  font-size: 0.78rem;
  cursor: pointer;
  border-radius: var(--lms-radius-sm);
}
.service-group-toggle:hover {
  background: var(--lms-surface-2);
}
.service-group-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--lms-muted);
}
.service-group-count {
  font-size: 0.72rem;
  color: var(--lms-muted);
  background: var(--lms-surface-2);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
}
.service-group-chevron {
  margin-left: auto;
  color: var(--lms-muted);
}
.service-empty {
  font-size: 0.75rem;
  color: var(--lms-muted);
  padding: 0.25rem 0.4rem;
  margin: 0;
}

/* ── 服務選項：整列反白（框選效果）── */
.service-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid transparent;
  border-radius: var(--lms-radius-sm);
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--lms-text);
  transition: background var(--lms-transition), border-color var(--lms-transition), color var(--lms-transition);
}
.service-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.service-option::before {
  content: '';
  width: 16px;
  height: 16px;
  flex: none;
  display: grid;
  place-items: center;
  border: 1px solid var(--lms-border);
  border-radius: 4px;
  background: var(--lms-surface);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  transition: background var(--lms-transition), border-color var(--lms-transition);
}
.service-option-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.service-option:hover {
  background: var(--lms-surface-2);
}
.service-option:has(input:checked) {
  background: var(--lms-accent-light);
  border-color: var(--lms-accent);
  color: var(--lms-accent);
  font-weight: 600;
}
.service-option:has(input:checked)::before {
  content: '✓';
  background: var(--lms-accent);
  border-color: var(--lms-accent);
}
.service-option:has(input:focus-visible) {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

.selected-count {
  font-size: 0.75rem;
  color: var(--lms-muted);
  margin: 0;
}

/* ── 按鈕（header/footer 共用）── */
.cf-btn {
  min-height: var(--lms-h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.5rem 1.2rem;
  border-radius: var(--lms-radius-sm);
  font-size: 0.9rem;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid transparent;
  transition: background var(--lms-transition), border-color var(--lms-transition), color var(--lms-transition);
}
.cf-btn-primary {
  background: var(--lms-accent);
  color: #fff;
  border-color: var(--lms-accent);
}
.cf-btn-primary:hover:not(:disabled) {
  background: var(--lms-accent-hover);
  border-color: var(--lms-accent-hover);
}
.cf-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.cf-btn-secondary {
  background: transparent;
  border-color: var(--lms-border);
  color: var(--lms-text);
}
.cf-btn-secondary:hover {
  background: var(--lms-surface-2);
}
.cf-btn:focus-visible {
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
  animation: cf-spin 0.6s linear infinite;
}
@keyframes cf-spin {
  to { transform: rotate(360deg); }
}

/* ── prefers-reduced-motion：停用 Modal 動畫 ── */
@media (prefers-reduced-motion: reduce) {
  .channel-form-overlay,
  .cf-dialog {
    animation: none;
  }
}

/* ── RWD：≤767px 轉全螢幕 bottom sheet（貼底、頂部圓角 16px）── */
@media (max-width: 767px) {
  .channel-form-overlay {
    align-items: flex-end;
    padding: 0;
  }
  .cf-dialog {
    max-width: none;
    width: 100%;
    max-height: 100dvh;
    border-radius: 16px 16px 0 0;
    animation-name: cf-dialog-up;
  }
  @keyframes cf-dialog-up {
    from { opacity: 0; transform: translateY(100%); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* footer「取消/儲存」並排全寬 */
  .cf-foot {
    padding: 0.6rem 0.75rem;
  }
  .cf-foot .cf-btn {
    flex: 1;
    min-height: var(--lms-h-mobile);
    font-size: 1rem;
  }

  /* 欄位單欄堆疊 + 44px 觸控目標 */
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-field--full {
    grid-column: auto;
  }
  .header-row {
    grid-template-columns: 1fr;
  }
  .cf-body input:not([type='checkbox']):not([type='radio']),
  .cf-body select {
    height: var(--lms-h-mobile);
    font-size: 16px;
  }
  .cf-btn {
    min-height: var(--lms-h-mobile);
  }
}
</style>
