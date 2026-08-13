<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNotifyChannels } from '../composables/useNotifyChannels'
import type { Channel, ChannelPayload } from '../types/notify'
import AppHeader from '../components/AppHeader.vue'
import ChannelForm from '../components/ChannelForm.vue'
import ChannelCard from '../components/ChannelCard.vue'
import ChannelHistoryTable from '../components/ChannelHistoryTable.vue'
import ToastContainer from '../components/ToastContainer.vue'
import { useI18n } from '../composables/useI18n'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

async function handleLogout(): Promise<void> {
  await auth.logout()
  router.replace('/login')
}
const { channels, loading, error, fetchChannels, createChannel, updateChannel, removeChannel, registerWsHandler } = useNotifyChannels()

const activeTab = ref<'channels' | 'history'>('channels')
const formOpen = ref(false)
const editing = ref<Channel | null>(null)

onMounted(async () => {
  registerWsHandler()
  await fetchChannels()
})

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openEdit(ch: Channel): void {
  editing.value = ch
  formOpen.value = true
}

async function handleSave(payload: ChannelPayload): Promise<void> {
  if (editing.value) await updateChannel(editing.value.id, payload)
  else await createChannel(payload)
  formOpen.value = false
  await fetchChannels()
}
</script>

<template>
  <main class="app-container">
    <AppHeader :username="auth.username" @logout="handleLogout" />

  <div class="notifications-page">
    <div class="notify-page-header">
      <div class="notify-page-heading">
        <h2 class="notify-title">🔔 {{ t('nav.notifications') }}</h2>
        <p class="notify-desc">服務狀態變更時推送通知至 Slack / Discord / Telegram / 自訂 Webhook</p>
      </div>
      <button v-if="activeTab === 'channels'" type="button" class="btn btn-primary" data-testid="add-channel" @click="openCreate">
        ＋ {{ t('notify.addChannel') }}
      </button>
    </div>

    <div class="notify-tabs" role="tablist" aria-label="通知設定分頁">
      <button
        id="tab-channels"
        type="button"
        class="notify-tab"
        role="tab"
        :class="{ active: activeTab === 'channels' }"
        :aria-selected="activeTab === 'channels'"
        aria-controls="panel-channels"
        @click="activeTab = 'channels'"
      >
        {{ t('notify.tabChannels') }}
      </button>
      <button
        id="tab-history"
        type="button"
        class="notify-tab"
        role="tab"
        :class="{ active: activeTab === 'history' }"
        :aria-selected="activeTab === 'history'"
        aria-controls="panel-history"
        @click="activeTab = 'history'"
      >
        {{ t('notify.tabHistory') }}
      </button>
    </div>

    <div v-if="loading" class="loading-spinner" aria-busy="true" />

    <div v-else-if="error" class="error-state">
      <p class="error-message">{{ error }}</p>
      <button type="button" class="btn btn-secondary" data-testid="retry" @click="fetchChannels">重試</button>
    </div>

    <template v-else>
      <div
        v-if="activeTab === 'channels'"
        id="panel-channels"
        class="notify-tabpanel"
        role="tabpanel"
        aria-labelledby="tab-channels"
      >
        <div v-if="channels.length === 0" class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>尚未設定任何通知 Channel</p>
          <button type="button" class="btn btn-primary" @click="openCreate">＋ {{ t('notify.addChannel') }}</button>
        </div>
        <div v-else class="channel-grid">
          <ChannelCard
            v-for="ch in channels"
            :key="ch.id"
            :channel="ch"
            @edit="openEdit"
            @delete="removeChannel"
          />
        </div>
      </div>
      <div
        v-else
        id="panel-history"
        class="notify-tabpanel"
        role="tabpanel"
        aria-labelledby="tab-history"
      >
        <ChannelHistoryTable :channels="channels" />
      </div>
    </template>

    <ChannelForm v-if="formOpen" :channel="editing" @close="formOpen = false" @save="handleSave" />
  </div>

    <ToastContainer />
  </main>
</template>

<style scoped>
.notifications-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

/* ── Page header（§4.1）── */
.notify-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}
.notify-page-heading {
  min-width: 0;
}
.notify-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 1.35rem;
}
.notify-desc {
  margin: 0.35rem 0 0;
  color: var(--lms-muted);
  font-size: 0.82rem;
}

/* ── 按鈕（沿用 --lms-*，Pico 僅提供 .btn base）── */
.notifications-page .btn {
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
}
.notifications-page .btn-primary {
  background: var(--lms-accent);
  color: #fff;
  border: none;
}
.notifications-page .btn-primary:hover:not(:disabled) {
  background: var(--lms-accent-hover);
}
.notifications-page .btn-secondary {
  background: transparent;
  border: 1px solid var(--lms-border);
  color: var(--lms-text);
}
.notifications-page .btn-secondary:hover {
  background: var(--lms-surface-2);
}
.notifications-page .btn:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

/* ── Pill segmented tabs（§4.4.2）── */
.notify-tabs {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  background: var(--lms-surface-2);
  border: 1px solid var(--lms-border);
  border-radius: 10px;
  margin-bottom: 1.25rem;
}
.notify-tab {
  border: none;
  background: transparent;
  color: var(--lms-muted);
  font-size: 0.85rem;
  font-weight: 500;
  height: var(--lms-h);
  padding: 0 0.85rem;
  border-radius: 18px;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--lms-transition), background var(--lms-transition);
}
.notify-tab:hover {
  color: var(--lms-accent);
}
.notify-tab.active {
  background: var(--lms-accent);
  color: #fff;
}
.notify-tab:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

.notify-tabpanel {
  outline: none;
}

/* ── Loading / Error / Empty ── */
.loading-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--lms-muted);
}
.loading-spinner::after {
  content: '';
  width: 32px;
  height: 32px;
  border: 3px solid var(--lms-border);
  border-top-color: var(--lms-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  text-align: center;
  padding: 2.5rem 1rem;
}
.error-message {
  color: var(--lms-danger);
  font-size: 0.9rem;
  margin: 0 0 0.75rem;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--lms-muted);
}
.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}
.empty-state p {
  font-size: 0.95rem;
  margin: 0 0 1rem;
}

/* ── Channel grid（§6：3/2/1 欄）── */
.channel-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}

/* ── RWD ── */
@media (max-width: 767px) {
  .notify-page-header {
    flex-direction: column;
    align-items: stretch;
  }
  .notifications-page .btn-primary,
  .notifications-page .btn-secondary {
    width: 100%;
    min-height: var(--lms-h-mobile);
    font-size: 1rem;
  }
  .notify-tabs {
    display: flex;
    width: 100%;
  }
  .notify-tab {
    flex: 1;
    height: var(--lms-h-mobile);
    justify-content: center;
  }
}
</style>
