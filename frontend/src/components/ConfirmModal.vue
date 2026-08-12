<script setup lang="ts">
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
defineProps<{ show: boolean; message: string; details?: string[] }>()
defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="lms-modal-overlay" @click.self="$emit('cancel')">
      <div class="lms-modal" role="alertdialog" aria-modal="true">
        <h3>{{ t('modal.title') }}</h3>
        <p class="modal-message">{{ message }}</p>
        <div v-if="details && details.length" class="modal-details">
          <p v-for="(name, i) in details" :key="i" class="modal-detail-item">{{ name }}</p>
        </div>
        <div class="lms-modal-actions">
          <button class="secondary" @click="$emit('cancel')">{{ t('modal.cancel') }}</button>
          <button class="btn-danger" @click="$emit('confirm')" autofocus>{{ t('modal.confirm') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
