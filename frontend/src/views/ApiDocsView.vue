<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AppHeader from '../components/AppHeader.vue'

const auth = useAuthStore()
const router = useRouter()

async function handleLogout(): Promise<void> {
  await auth.logout()
  router.replace('/login')
}

const docsUrl = '/api/v1/docs/'
</script>

<template>
  <main class="app-container">
    <AppHeader
      :username="auth.username"
      @logout="handleLogout"
    />

    <div class="api-docs-view" data-testid="api-docs-view">
      <div class="page-header">
        <h2>📖 API 文件</h2>
        <a
          class="btn-secondary"
          :href="docsUrl"
          target="_blank"
          rel="noopener"
          data-testid="docs-open-new-tab"
        >↗ 在新分頁開啟</a>
      </div>

      <!-- 認證使用說明（可折疊） -->
      <details class="auth-guide" data-testid="docs-auth-guide">
        <summary>🔐 API Token 認證方式</summary>
        <div class="auth-guide-body">
          <p>
            於「API Tokens」頁面建立 Token 後，以
            <code>Authorization: Bearer lsm_...</code> header 呼叫所有
            <code>/api/v1/*</code> 端點：
          </p>
          <ul>
            <li>
              <strong>read</strong> scope — 僅允許 GET / HEAD / OPTIONS；
              寫入操作回傳 <code>403</code>。
            </li>
            <li>
              <strong>full</strong> scope — 允許所有操作
              （服務啟停、批次、設定檔編輯、通知管理…）。
            </li>
            <li>
              Token 管理端點（<code>/api/v1/tokens</code>）僅限 Session 登入，
              不可用 Token 呼叫。
            </li>
            <li>
              非 2xx 回應一律為 <code>{"error": "說明"}</code>。
            </li>
          </ul>
          <pre class="curl-example" data-testid="docs-curl-example">curl -sS \
  -H "Authorization: Bearer lsm_你的Token" \
  https://你的主機/api/v1/services</pre>
          <p class="guide-hint">
            💡 文件頁內的「Authorize」按鈕可直接填入 Token，
            之後所有「Try it out」請求會自動帶上。
          </p>
        </div>
      </details>

      <!-- Swagger UI -->
      <iframe
        :src="docsUrl"
        class="docs-frame"
        title="API 文件（Swagger UI）"
        data-testid="docs-frame"
      />
    </div>
  </main>
</template>

<style scoped>
.api-docs-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.page-header h2 {
  margin: 0;
  font-size: 1.35rem;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--lms-border, #ccc);
  border-radius: 6px;
  background: var(--lms-bg-secondary, #f5f5f5);
  color: var(--lms-text, #222);
  text-decoration: none;
  font-size: 0.9rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.btn-secondary:hover {
  border-color: var(--lms-accent, #2563eb);
  background: var(--lms-bg-hover, #eef2ff);
}

/* ── 認證說明 ── */
.auth-guide {
  border: 1px solid var(--lms-border, #ccc);
  border-radius: 8px;
  background: var(--lms-bg-secondary, #f7f7f7);
  overflow: hidden;
}

.auth-guide summary {
  cursor: pointer;
  padding: 0.65rem 1rem;
  font-weight: 600;
  font-size: 0.95rem;
  user-select: none;
}

.auth-guide-body {
  padding: 0 1rem 1rem;
  font-size: 0.9rem;
  line-height: 1.7;
}

.auth-guide-body p {
  margin: 0.4rem 0;
}

.auth-guide-body ul {
  margin: 0.4rem 0;
  padding-left: 1.25rem;
}

.auth-guide-body li {
  margin: 0.25rem 0;
}

.auth-guide-body code {
  font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.82em;
  background: var(--lms-code-bg, rgba(0, 0, 0, 0.06));
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

.curl-example {
  margin: 0.6rem 0;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.82rem;
  overflow-x: auto;
  white-space: pre;
}

.guide-hint {
  color: var(--lms-text-muted, #666);
  font-size: 0.85rem;
}

/* ── Swagger UI iframe ── */
.docs-frame {
  width: 100%;
  height: calc(100vh - 320px);
  min-height: 560px;
  border: 1px solid var(--lms-border, #ccc);
  border-radius: 8px;
  background: #fff;
}

@media (max-width: 640px) {
  .docs-frame {
    height: calc(100vh - 380px);
    min-height: 480px;
  }
}
</style>
