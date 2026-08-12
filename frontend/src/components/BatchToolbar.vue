<script setup lang="ts">
import { computed } from 'vue'
import type { ServiceAction } from '../types/service'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{
  selectedCount: number
  executing: boolean
  progress: { done: number; total: number } | null
}>()

const emit = defineEmits<{
  'batch-action': [action: ServiceAction]
  'clear-selection': []
}>()

const progressPercent = computed(() => {
  if (!props.progress || props.progress.total === 0) return 0
  return Math.min(100, Math.round((props.progress.done / props.progress.total) * 100))
})

function ariaLabel(action: ServiceAction): string {
  const count = String(props.selectedCount)
  const key: Record<ServiceAction, string> = {
    start: 'batch.action.start.aria',
    stop: 'batch.action.stop.aria',
    restart: 'batch.action.restart.aria',
  }
  return t(key[action], { count })
}
</script>

<template>
  <div
    class="batchbar"
    :class="{ 'batch-executing': executing, 'batch-selected': !executing && selectedCount > 0 }"
  >
    <!-- 固定槽位：永遠佔同一位置（min-height 52px），內容在三態間 150ms 淡入替換 -->
    <div class="bb-inner">
      <!-- Idle：未選取，單行提示，無亮色按鈕 -->
      <div v-if="!executing && selectedCount === 0" class="bb-hint">
        <span class="key" aria-hidden="true">☑</span>
        <span>{{ t('batch.hint') }}</span>
      </div>

      <!-- 已選取：計數 + 動作按鈕 + 取消選取 -->
      <template v-else-if="!executing">
        <span class="batch-count">{{ t('batch.selected.prefix') }} <strong>{{ selectedCount }}</strong> {{ t('batch.selected.suffix') }}</span>
        <button
          class="act act-start btn-start"
          :aria-label="ariaLabel('start')"
          @click="emit('batch-action', 'start')"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z"></path>
          </svg>
          {{ t('action.start') }}
        </button>
        <button
          class="act act-stop btn-stop"
          :aria-label="ariaLabel('stop')"
          @click="emit('batch-action', 'stop')"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="1.5"></rect>
          </svg>
          {{ t('action.stop') }}
        </button>
        <button
          class="act act-restart btn-restart"
          :aria-label="ariaLabel('restart')"
          @click="emit('batch-action', 'restart')"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.6-6.3"></path>
            <path d="M21 3v6h-6"></path>
          </svg>
          {{ t('action.restart') }}
        </button>
        <button class="btn-clear-link" @click="emit('clear-selection')">{{ t('batch.clear') }}</button>
      </template>

      <!-- 執行中：進度列 + N/M 完成 -->
      <template v-else>
        <span class="batch-count">{{ t('batch.selected.prefix') }} <strong>{{ selectedCount }}</strong> {{ t('batch.selected.suffix') }}</span>
        <div
          class="progress"
          role="progressbar"
          :aria-valuemin="0"
          :aria-valuemax="progress?.total ?? 0"
          :aria-valuenow="progress?.done ?? 0"
          :aria-label="t('batch.progress.aria')"
        >
          <div class="bar" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <span class="batch-progress">{{ t('batch.progress', { done: String(progress?.done ?? 0), total: String(progress?.total ?? 0) }) }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── 固定槽位：min-height 52px，三態共用（docs/uiux/012-toolbar-dashboard-design.html） ──
   高度不變原則：bar 高度永遠 = 52px（含 1px+2px 邊框）。
   垂直 padding 用固定 6px（非 rem），因為 root font-size 為 20px 時
   0.55rem = 11px，36px 按鈕 + 22px padding + 3px 邊框 = 61px > 52px，
   會讓「已選取」狀態比 idle 高出 9px。改 6px 後：36+12+3 = 51px < 52px，
   三態（idle / selected / executing）都是 52px。 */
.batchbar {
  background: var(--lms-surface-2, #f6f7f9);
  border: 1px solid var(--lms-border);
  border-bottom: 2px solid var(--lms-border);
  border-radius: var(--lms-radius-sm) var(--lms-radius-sm) 0 0;
  padding: 6px 1rem;
  display: flex;
  align-items: center;
  min-height: 52px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.bb-inner {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  flex-wrap: wrap;
  animation: batchFade 0.15s ease;
}

@keyframes batchFade {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* Idle 提示 */
.bb-hint {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--lms-muted);
  font-size: 13px; /* 文件 0.8rem@16px = 12.8px */
}
.bb-hint .key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--lms-border);
  font-size: 11px;
  color: var(--lms-muted);
}

/* 已選取態：accent 左邊線 */
.batchbar.batch-selected {
  background: var(--lms-surface);
  border-bottom-color: var(--lms-accent);
}

/* 執行中態：warning 左邊線 */
.batchbar.batch-executing {
  border-bottom-color: var(--lms-warning);
}

.batch-count {
  font-size: 14px; /* 文件：0.875rem@16px = 14px */
  color: var(--lms-muted);
  white-space: nowrap;
}
.batch-count strong,
.batch-count b {
  color: var(--lms-accent);
  font-size: 16px; /* 文件：1rem@16px */
}

/* ── 動作按鈕（success / danger / accent + light 底）── */
.act {
  height: var(--lms-h, 36px);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.9rem;
  border-radius: var(--lms-radius-sm);
  font-size: 14px; /* 文件：動作按鈕 14px */
  font-weight: 600;
  border: 1px solid;
  cursor: pointer;
  transition: all var(--lms-transition);
  white-space: nowrap;
}
.act:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.act-start {
  background: var(--lms-success-light);
  color: var(--lms-success);
  border-color: var(--lms-success-border);
}
.act-start:hover:not(:disabled) {
  background: var(--lms-success);
  color: #fff;
}
.act-stop {
  background: var(--lms-danger-light);
  color: var(--lms-danger);
  border-color: var(--lms-danger-border);
}
.act-stop:hover:not(:disabled) {
  background: var(--lms-danger);
  color: #fff;
}
.act-restart {
  background: var(--lms-accent-light);
  color: var(--lms-accent);
  border-color: rgba(26, 115, 232, 0.3);
}
.act-restart:hover:not(:disabled) {
  background: var(--lms-accent);
  color: #fff;
}

/* 取消選取：link 樣式，36px 點擊區 */
.btn-clear-link {
  height: var(--lms-h, 36px);
  padding: 0 0.4rem;
  background: none;
  border: none;
  color: var(--lms-muted);
  font-size: 13px; /* 文件：0.8125rem@16px = 13px */
  cursor: pointer;
  text-decoration: underline;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  margin-left: auto;
}
.btn-clear-link:hover {
  color: var(--lms-accent);
}

/* 文件 a11y：focus ring 可見 */
.act:focus-visible,
.btn-clear-link:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

/* ── 進度列：8px、warning 填充 ── */
.progress {
  flex: 1;
  min-width: 140px;
  max-width: 260px;
  height: 8px;
  border-radius: 20px;
  background: var(--lms-border);
  overflow: hidden;
}
.progress .bar {
  height: 100%;
  width: 0%;
  background: var(--lms-warning);
  border-radius: 20px;
  transition: width 0.3s ease;
}
.batch-progress {
  font-size: 12px; /* 文件：0.78rem@16px = 12.5px */
  color: var(--lms-warning);
  font-weight: 700;
  white-space: nowrap;
}

/* ── RWD mobile（≤767px）：44px 觸控目標 ── */
@media (max-width: 767px) {
  /* 手機版：隱藏 idle 提示區塊（☑ 勾選服務後…），勾選服務後工具列才出現 */
  .batchbar:not(.batch-selected):not(.batch-executing) {
    display: none;
  }
  .batchbar {
    padding: 0.6rem 0.75rem;
    flex-direction: column;
    align-items: stretch;
  }
  .bb-inner {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .bb-hint {
    justify-content: center;
    text-align: center;
    padding: 0.25rem 0;
  }
  .batch-count {
    align-self: flex-start;
    padding-top: 0.1rem;
  }
  .btn-clear-link {
    margin-left: auto;
  }
  .act {
    height: var(--lms-h-mobile, 44px);
    justify-content: center;
  }
  /* 動作按鈕 2×2 全寬（重啟跨整列） */
  .act-start, .act-stop, .act-restart {
    flex: 1 1 calc(50% - 0.25rem);
  }
  .act-restart {
    flex-basis: 100%;
  }
  .progress {
    max-width: none;
    width: 100%;
  }
}
</style>
