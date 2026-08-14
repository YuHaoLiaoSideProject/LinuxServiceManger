<script setup lang="ts">
import { computed } from 'vue'
import { dotColor, statusLabel } from '../utils/nodeStatus'

const props = withDefaults(defineProps<{
  status: string
  /** 是否內嵌文字標籤（「線上/延遲/離線/長期離線/警告」） */
  showLabel?: boolean
  /** 圓點直徑（px），預設 10（viewBox 0 0 8 8 的 r=4 圓點） */
  size?: number
}>(), {
  showLabel: false,
  size: 10,
})

const color = computed(() => dotColor(props.status))
const label = computed(() => statusLabel(props.status))
</script>

<template>
  <span
    class="node-status-dot"
    :class="`node-status-${status}`"
    role="img"
    :aria-label="label"
  >
    <svg :width="size" :height="size" viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="4" :fill="color" />
    </svg>
    <span v-if="showLabel" class="status-text">{{ label }}</span>
  </span>
</template>
