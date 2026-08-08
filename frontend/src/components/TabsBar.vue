<script setup lang="ts">
import { computed } from 'vue'
import type { Service } from '../types/service'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const props = defineProps<{ services: Service[]; tab: string }>()

const myCount = computed(() => props.services.filter(s => !s.locked).length)
const systemCount = computed(() => props.services.filter(s => s.locked).length)
</script>

<template>
  <div class="tabs-bar">
    <button class="tab-btn" :class="{ active: tab === 'my' }" id="tab-my" @click="$emit('setTab', 'my')">
      {{ t('tab.my') }} <span class="tab-count">{{ myCount }}</span>
    </button>
    <button class="tab-btn" :class="{ active: tab === 'system' }" id="tab-system" @click="$emit('setTab', 'system')">
      {{ t('tab.system') }} <span class="tab-count">{{ systemCount }}</span>
    </button>
  </div>
</template>

<script lang="ts">
export default { emits: ['setTab'] }
</script>
