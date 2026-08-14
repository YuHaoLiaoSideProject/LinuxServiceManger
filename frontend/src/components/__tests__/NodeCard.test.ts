/**
 * RED phase — NodeCard.vue（F-NC-01 ~ F-NC-06）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.3（決策 8）。
 *
 * NodeCard.vue 尚未建立 → import 失敗即為 RED。
 * 狀態燈映射（§2.7）：online 🟢 / degraded 🟡 / offline 🔴 / long_offline ⚫ / warning 🟡。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Node } from '../../types/node'

// ── 生產模組：NodeCard.vue 尚未建立 → import 失敗即 RED ──
import NodeCard from '../NodeCard.vue'

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'n1',
    name: 'web-server-01',
    address: '10.0.0.5:8443',
    hostname: 'web-server-01',
    status: 'online',
    service_stats: { total: 3, active: 2, failed: 1 },
    created_at: '2026-08-13T08:00:00Z',
    updated_at: '2026-08-13T08:00:00Z',
    ...overrides,
  } as Node
}

function mountCard(node: Node) {
  return mount(NodeCard, { props: { node } })
}

describe('NodeCard（F-NC）', () => {
  it('F-NC-01: Card 顯示完整資訊（名稱 / Hostname / 狀態燈 / 服務統計 / 最後心跳）', () => {
    const wrapper = mountCard(makeNode({ last_heartbeat: new Date(Date.now() - 5000).toISOString() }))

    expect(wrapper.find('[data-testid="node-card"]').exists()).toBe(true)
    expect(wrapper.find('.node-name').text()).toBe('web-server-01')
    expect(wrapper.find('.node-hostname').text()).toBe('web-server-01')
    // 狀態燈 = SVG 圓點 + 文字標籤（UIUX 決策 3 / WCAG 1.4.1，非 emoji）
    expect(wrapper.find('.node-status-dot').exists()).toBe(true)
    expect(wrapper.find('.node-status-dot svg circle').exists()).toBe(true)
    expect(wrapper.find('.status-text').text()).toBe('線上')
    expect(wrapper.find('.node-stats').text()).toContain('2/3 執行中')
    expect(wrapper.find('.node-heartbeat').text()).toContain('最後心跳：5 秒前')
    // 「詳情」按鈕（data-testid="node-detail" + aria-label）
    expect(wrapper.find('[data-testid="node-detail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-detail"]').attributes('aria-label')).toBe('詳情 web-server-01')
  })

  it('F-NC-02: 狀態燈 5 態文字標籤 + SVG 圓點（online/degraded/offline/long_offline/warning）', () => {
    const cases: Array<[Node['status'], string]> = [
      ['online', '線上'],
      ['degraded', '延遲'],
      ['offline', '離線'],
      ['long_offline', '長期離線'],
    ]
    for (const [status, label] of cases) {
      const wrapper = mountCard(makeNode({ status }))
      expect(wrapper.find('.node-status-dot').exists()).toBe(true)
      expect(wrapper.find('.node-status-dot svg circle').exists()).toBe(true)
      expect(wrapper.find('.status-text').text()).toBe(label)
    }
    // warning → 「警告」（版本警告優先，不阻斷）
    const w = mountCard(makeNode({ status: 'warning', agent_version: '1.0.0' }))
    expect(w.find('.status-text').text()).toBe('警告')
  })

  it('F-NC-03: 離線服務統計灰顯（dimmed + node-offline class）', () => {
    const wrapper = mountCard(makeNode({ status: 'offline' }))

    expect(wrapper.find('[data-testid="node-card"]').classes()).toContain('node-offline')
    expect(wrapper.find('.node-stats').classes()).toContain('dimmed')

    const online = mountCard(makeNode({ status: 'online' }))
    expect(online.find('.node-stats').classes()).not.toContain('dimmed')
  })

  it('F-NC-04: 線上節點可點擊（emit click(id, status)）', async () => {
    const wrapper = mountCard(makeNode({ id: 'n1', status: 'online' }))
    await wrapper.find('[data-testid="node-card"]').trigger('click')

    const emitted = wrapper.emitted('click')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['n1', 'online'])
  })

  it('F-NC-05: 離線節點點擊 → emit click(id, offline)（供視圖顯示離線面板，非切換）', async () => {
    const wrapper = mountCard(makeNode({ id: 'n1', status: 'offline' }))
    await wrapper.find('[data-testid="node-card"]').trigger('click')

    const emitted = wrapper.emitted('click')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['n1', 'offline'])
  })

  it('F-NC-06: 「詳情」按鈕 → emit detail(id) 且不觸發 card click', async () => {
    const wrapper = mountCard(makeNode({ id: 'n1' }))
    await wrapper.find('[data-testid="node-detail"]').trigger('click')

    const detail = wrapper.emitted('detail')
    expect(detail).toBeTruthy()
    expect(detail![0]).toEqual(['n1'])
    // @click.stop：詳情按鈕不冒泡為 card click（離線面板事件不與切換事件混淆）
    expect(wrapper.emitted('click')).toBeUndefined()
  })
})
