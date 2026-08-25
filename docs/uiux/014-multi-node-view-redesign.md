# 多機管理檢視模式 — 設計規格

> **功能編號**：014（多機管理 Agent 模式）的 UIUX 子設計
> **互動稿**：`docs/uiux/014-multi-node-view-redesign-mockup.html`
> **上游**：`docs/interaction-flows/014-multi-node-agent-management.md` §3.1
> **狀態**：✅ 已定案（2025-08-25 使用者確認）

---

## 1. 設計決策

採用**節點切換**模式：

- 總覽頁（Aggregate Dashboard）顯示所有節點卡片 + 全場統計列
- 點擊節點卡片進入單機視圖（URL `?node={id}`），一次只操作一台機器
- Header 節點下拉選單可隨時切換；「所有節點」按鈕返回總覽
- 離線節點不可進入操作視圖，點擊開啟離線詳情面板
- 跨節點搜尋移出功能範圍，移入未來 backlog

---

## 2. Design Token

沿用專案 `--lms-*` 變數（mockup 內以對應值呈現）。

| Token | 值 | 用途 |
|-------|---|------|
| accent | `#1a73e8` | 品牌色、節點連結、選取態 |
| success | `#188038` | 線上指示燈、執行中 badge |
| danger | `#c5221f` | 離線指示燈、失敗 badge |
| warning | `#e37400` | 延遲指示燈、離線 Banner |
| radius | 10px / 6px | 卡片 / 按鈕 |
| h | 36px (mobile 44px) | 控制項高度 |
| fs | 0.875rem | 主字級 |
| transition | 0.2s ease | 動畫，尊重 `prefers-reduced-motion` |

---

## 3. 狀態矩陣

### 節點卡片

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 🟢 線上 | 綠燈、統計正常色 | 可點擊 → 單機視圖 |
| 🟡 延遲 | 黃燈 + 「⚠ 心跳延遲」 | 可點擊 |
| 🔴 離線 | 紅燈、整卡降透明度、統計灰顯 | 點擊 → 離線詳情（非操作） |
| ⚫ 長期離線 | 灰燈 | 同離線；卡片可摺疊至底部 |
| hover | 邊框 accent + 上浮 1px + 陰影 | cursor pointer |
| focus | focus ring（WCAG 2.4.7） | Enter/Space 觸發 |

無障礙：Card 為 `<button>`（鍵盤可達）、燈號不以顏色單獨傳達（併文字標籤）、aria-label 含節點名稱。

### 控制項

| 控制項 | 狀態 |
|-------|------|
| 節點下拉選單 | idle / hover / open / disabled（離線） |
| 返回鈕 | idle / hover / focus |
| 搜尋框（節點內） | empty / typing / focused |

---

## 4. RWD

| 斷點 | 行為 |
|------|------|
| ≥1024 | 卡片網格 auto-fill ≥230px；工具列單列 |
| 768–1023 | 卡片 2 欄；統計列換行 |
| ≤767 | 卡片單欄；Header 導航摺疊；控制項高 44px |

---

## 5. 驗收清單

- [ ] 總覽 → 點線上節點卡 → 單機視圖，URL 變 `?node={id}`
- [ ] 返回鈕 / 下拉切換 / 「所有節點」皆可用
- [ ] 離線節點卡不可進入操作視圖，點擊開啟離線詳情
- [ ] 全域不存在跨節點搜尋或合併服務清單
- [ ] 兩主題、三斷點下檢視正常
