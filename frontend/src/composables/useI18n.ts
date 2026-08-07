import { ref, readonly } from 'vue'

type Lang = 'zh-TW' | 'en'

const translations: Record<Lang, Record<string, string>> = {
  'zh-TW': {
    'stats.total': '總服務數',
    'stats.running': '執行中',
    'stats.failed': '失敗',
    'search.placeholder': '搜尋服務名稱...',
    'header.refresh': '🔄 重新整理',
    'header.logout': '🚪 登出',
    'tab.my': '我的服務',
    'tab.system': '系統服務',
    'modal.title': '⚠️ 確認操作',
    'modal.cancel': '取消',
    'modal.confirm': '確認',
    'modal.stop': '確定要停止 {name} 嗎？',
    'modal.restart': '確定要重啟 {name} 嗎？',
    'empty.state': '找不到任何服務，或無法連線至 systemd。',
    'search.empty': '沒有符合「{term}」的服務',
    'action.start': 'Start',
    'action.stop': 'Stop',
    'action.restart': 'Restart',
    'locked.badge': '🔒 已鎖定',
    'locked.tooltip': '此服務受保護，無法直接操作。設定 UNLOCKED_SERVICES 環境變數解鎖。',
    'toast.started': '{name} 已啟動',
    'toast.stopped': '{name} 已停止',
    'toast.restarted': '{name} 已重啟',
    'toast.error': '{name} 操作失敗',
    'login.title': 'Linux Service Manager',
    'login.subtitle': '請登入以管理系統服務',
    'login.username': '帳號',
    'login.password': '密碼',
    'login.submit': '登入',
    'login.error': '帳號或密碼錯誤',
  },
  'en': {
    'stats.total': 'Total Services',
    'stats.running': 'Running',
    'stats.failed': 'Failed',
    'search.placeholder': 'Search services...',
    'header.refresh': '🔄 Refresh',
    'header.logout': '🚪 Logout',
    'tab.my': 'My Services',
    'tab.system': 'System Services',
    'modal.title': '⚠️ Confirm Action',
    'modal.cancel': 'Cancel',
    'modal.confirm': 'Confirm',
    'modal.stop': 'Are you sure you want to stop {name}?',
    'modal.restart': 'Are you sure you want to restart {name}?',
    'empty.state': 'No services found or unable to connect to systemd.',
    'search.empty': 'No services matching "{term}"',
    'action.start': 'Start',
    'action.stop': 'Stop',
    'action.restart': 'Restart',
    'locked.badge': '🔒 Locked',
    'locked.tooltip': 'This service is protected. Set the UNLOCKED_SERVICES environment variable to unlock.',
    'toast.started': '{name} started',
    'toast.stopped': '{name} stopped',
    'toast.restarted': '{name} restarted',
    'toast.error': '{name} operation failed',
    'login.title': 'Linux Service Manager',
    'login.subtitle': 'Sign in to manage system services',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign In',
    'login.error': 'Invalid username or password',
  },
}

function detectLang(): Lang {
  const stored = localStorage.getItem('lms-lang') as Lang | null
  if (stored && translations[stored]) return stored
  if (navigator.language.startsWith('zh')) return 'zh-TW'
  return 'en'
}

const currentLang = ref<Lang>(detectLang())

export function useI18n() {
  function t(key: string, params?: Record<string, string>): string {
    const text = translations[currentLang.value]?.[key] || key
    if (!params) return text
    return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text)
  }

  function setLang(lang: Lang) {
    currentLang.value = lang
    localStorage.setItem('lms-lang', lang)
    document.documentElement.lang = lang
  }

  function toggleLang() {
    setLang(currentLang.value === 'zh-TW' ? 'en' : 'zh-TW')
  }

  return { t, lang: readonly(currentLang), setLang, toggleLang }
}
