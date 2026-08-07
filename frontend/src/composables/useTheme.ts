import { ref, readonly } from 'vue'

export type Theme = 'light' | 'dark'

const theme = ref<Theme>(
  (localStorage.getItem('lms-theme') as Theme) ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
)

function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme.value)
  localStorage.setItem('lms-theme', theme.value)
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme()
}

function setTheme(t: Theme) {
  theme.value = t
  applyTheme()
}

// Apply on load
applyTheme()

// Listen for system changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('lms-theme')) {
    setTheme(e.matches ? 'dark' : 'light')
  }
})

export function useTheme() {
  return { theme: readonly(theme), toggleTheme, setTheme }
}
