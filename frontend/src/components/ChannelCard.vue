<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Channel } from '../types/notify'
import { useNotifyChannels } from '../composables/useNotifyChannels'
import ConfirmModal from './ConfirmModal.vue'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{ channel: Channel }>()
const emit = defineEmits<{ edit: [ch: Channel]; delete: [id: string] }>()

const { toggleEnabled, testChannel } = useNotifyChannels()
const { t } = useI18n()

const testing = ref(false)
const confirmOpen = ref(false)
const deleting = ref(false)

const typeIcon = computed(() => ({ slack: '#', discord: '🎮', telegram: '✈️', custom: '🔗' })[props.channel.type])
const disabledClass = computed(() => ({ 'channel-disabled': !props.channel.enabled }))
const autoDisabled = computed(() => props.channel.enabled === false && !!props.channel.auto_disabled_reason)

async function handleToggle(): Promise<void> {
  await toggleEnabled(props.channel)
}

async function handleTest(): Promise<void> {
  testing.value = true
  try {
    await testChannel(props.channel)
  } finally {
    testing.value = false
  }
}

async function handleConfirmDelete(): Promise<void> {
  deleting.value = true
  try {
    emit('delete', props.channel.id)
    confirmOpen.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="channel-card" :class="[disabledClass, autoDisabled ? 'auto-disabled' : '']">
    <div class="channel-card-head">
      <span class="channel-type-icon" aria-hidden="true">{{ typeIcon }}</span>
      <div class="channel-title-block">
        <div class="channel-name-row">
          <h3 class="channel-name">{{ channel.name }}</h3>
          <span v-if="!channel.enabled" class="disabled-label">已停用</span>
          <span v-if="autoDisabled" class="auto-disabled-badge" title="因連續失敗已自動停用">⚠</span>
        </div>
        <span class="channel-type-label">{{ channel.type }}</span>
      </div>
      <label class="switch" :title="`啟用 ${channel.name}`">
        <input
          type="checkbox"
          role="switch"
          :aria-checked="channel.enabled"
          :aria-label="`啟用 ${channel.name}`"
          :checked="channel.enabled"
          data-testid="channel-toggle"
          @change="handleToggle"
        />
        <span class="slider" aria-hidden="true" />
      </label>
    </div>
    <div class="channel-events">
      <span v-for="ev in channel.events" :key="ev" class="event-badge">{{ ev }}</span>
    </div>
    <div class="channel-scope">
      {{ channel.all_services ? '全部服務' : `${(channel.services || []).length} 個指定服務` }}
    </div>
    <div class="channel-card-actions">
      <button
        class="btn btn-sm btn-act"
        :disabled="testing"
        data-testid="channel-test"
        :aria-label="`測試 ${channel.name}`"
        :title="`測試 ${channel.name}`"
        @click="handleTest"
      >
        <span v-if="testing" class="spinner" aria-hidden="true" />
        <span v-else aria-hidden="true">📤</span>
        <span class="act-label">{{ t('notify.test') }}</span>
      </button>
      <button
        class="btn btn-sm btn-act"
        :aria-label="`編輯 ${channel.name}`"
        :title="`編輯 ${channel.name}`"
        @click="emit('edit', channel)"
      >
        <span aria-hidden="true">✏️</span>
        <span class="act-label">編輯</span>
      </button>
      <button
        class="btn btn-sm btn-danger btn-act"
        :aria-label="`刪除 ${channel.name}`"
        :title="`刪除 ${channel.name}`"
        @click="confirmOpen = true"
      >
        <span aria-hidden="true">🗑️</span>
        <span class="act-label">刪除</span>
      </button>
    </div>

    <ConfirmModal
      :show="confirmOpen"
      :title="'刪除 Channel'"
      :message="`確定刪除 Channel「${channel.name}」？此操作無法復原。`"
      :confirm-loading="deleting"
      confirm-label="確認刪除"
      @confirm="handleConfirmDelete"
      @cancel="confirmOpen = false"
    />
  </div>
</template>

<style scoped>
/* ── 卡片容器（§4.4.1）── */
.channel-card {
  position: relative;
  background: var(--lms-surface);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  box-shadow: var(--lms-shadow);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: box-shadow var(--lms-transition), border-color var(--lms-transition);
}
.channel-card:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
  border-color: var(--lms-accent);
}

/* 停用灰化 + 文字 muted（WCAG 1.4.1：另有「已停用」文字標籤） */
.channel-card.channel-disabled {
  opacity: 0.55;
}
.channel-card.channel-disabled .channel-name,
.channel-card.channel-disabled .channel-type-label {
  color: var(--lms-muted);
}

/* ── 頭部：圖示 + 名稱/類型 + toggle ── */
.channel-card-head {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}
.channel-type-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--lms-radius-sm);
  background: var(--lms-surface-2);
  font-size: 1.2rem;
}
.channel-title-block {
  flex: 1;
  min-width: 0;
}
.channel-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.channel-name {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--lms-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.channel-type-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  color: var(--lms-muted);
}
.disabled-label {
  font-size: 0.7rem;
  color: var(--lms-muted);
  background: var(--lms-border);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  white-space: nowrap;
}
.auto-disabled-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 0.8rem;
  border-radius: 50%;
  background: var(--lms-warning-light);
  color: var(--lms-warning);
  cursor: help;
}

/* ── 事件 chips ── */
.channel-events {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.event-badge {
  font-size: 0.72rem;
  background: var(--lms-accent-light);
  color: var(--lms-accent);
  border-radius: var(--lms-radius-sm);
  padding: 0.15rem 0.5rem;
  white-space: nowrap;
}

.channel-scope {
  font-size: 0.8rem;
  color: var(--lms-muted);
}

/* ── Toggle（自建 .switch/.slider，role=switch）── */
.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: #ccc;
  border-radius: 10px;
  transition: background var(--lms-transition);
}
.slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 2px;
  top: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform var(--lms-transition);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.switch input:checked + .slider {
  background: #4caf50;
}
.switch input:checked + .slider::before {
  transform: translateX(16px);
}
.switch input:focus-visible + .slider {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}
[data-theme='dark'] .slider {
  background: #555;
}
[data-theme='dark'] .switch input:checked + .slider {
  background: #388e3c;
}

/* ── 動作列：icon-only 36px 按鈕 ── */
.channel-card-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: auto;
}
.channel-card-actions .btn-act {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  width: 36px;
  min-width: 36px;
  height: var(--lms-h);
  padding: 0;
  border: 1px solid var(--lms-border);
  background: var(--lms-surface-2);
  color: var(--lms-muted);
  border-radius: var(--lms-radius-sm);
  cursor: pointer;
  font-size: 0.9rem;
  transition: color var(--lms-transition), border-color var(--lms-transition), background var(--lms-transition);
}
.channel-card-actions .btn-act:hover:not(:disabled) {
  color: var(--lms-accent);
  border-color: var(--lms-accent);
  background: var(--lms-surface);
}
.channel-card-actions .btn-danger:hover:not(:disabled) {
  color: var(--lms-danger);
  border-color: var(--lms-danger);
}
.channel-card-actions .btn-act:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.channel-card-actions .btn-act:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}
.act-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── RWD：mobile 觸控目標 44px ── */
@media (max-width: 767px) {
  .channel-card-actions .btn-act {
    width: 44px;
    min-width: 44px;
    height: var(--lms-h-mobile);
  }
}
</style>
