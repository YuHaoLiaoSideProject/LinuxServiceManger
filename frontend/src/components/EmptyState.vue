<script setup lang="ts">
// showButton 預設 true：Vue 的 boolean prop 未傳時 runtime 是 false，
// 直接 v-if="showButton" 會讓按鈕消失，必須以 withDefaults 明確預設 true
const props = withDefaults(defineProps<{
  message?: string
  showButton?: boolean
}>(), {
  showButton: true,
})

defineEmits<{
  clear: []
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">🔍</div>
    <p>{{ message || '沒有符合條件的服務' }}</p>
    <button v-if="showButton" class="btn btn-secondary" @click="$emit('clear')">清除過濾</button>
    <slot />
  </div>
</template>
