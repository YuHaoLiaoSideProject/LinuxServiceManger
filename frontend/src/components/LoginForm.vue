<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useAuthStore } from '../stores/auth'

const { t } = useI18n()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''
  loading.value = true
  const err = await auth.login(username.value, password.value)
  if (err) {
    error.value = t('login.error')
  }
  loading.value = false
}
</script>

<template>
  <form @submit.prevent="handleSubmit" class="login-form">
    <h2>{{ t('login.title') }}</h2>
    <p class="login-subtitle">{{ t('login.subtitle') }}</p>

    <div v-if="error" class="login-error">{{ error }}</div>

    <label>
      {{ t('login.username') }}
      <input v-model="username" type="text" autocomplete="username" required autofocus />
    </label>

    <label>
      {{ t('login.password') }}
      <input v-model="password" type="password" autocomplete="current-password" required />
    </label>

    <button type="submit" :disabled="loading">
      {{ loading ? '...' : t('login.submit') }}
    </button>
  </form>
</template>

<style scoped>
.login-form {
  max-width: 360px;
  margin: 10vh auto 0;
  padding: 2rem;
  background: var(--pico-card-background-color);
  border: 1px solid var(--pico-muted-border-color);
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}
.login-form h2 {
  text-align: center;
  margin-bottom: 0.25rem;
}
.login-subtitle {
  text-align: center;
  color: var(--pico-muted-color);
  margin-bottom: 1.5rem;
  font-size: 0.9rem;
}
.login-error {
  background: #fce8e6;
  color: #c5221f;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  text-align: center;
}
.login-form button {
  width: 100%;
  margin-top: 0.5rem;
}
</style>
