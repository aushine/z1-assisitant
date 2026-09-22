/**
 * BankPicker —— 银行选择器（桌面端，spec-20260922-v1 · 01 §6.2/§6.4，P7）
 *
 * 形态：居中 Modal（项目约定：选择器 → Modal）+ 顶部搜索 + 三段式内容区：
 *   ① 最近使用（localStorage `recent_banks`，存 code，≤8，仅本机不入库）
 *   ② 常用（hot: true）
 *   ③ 全部 —— 按 `py` 首字母 A–Z 分组（⚠️ 用 py 字段，B7；py 缺失兜底 short 首字）
 *
 * 搜索：中文名 / 简称 / py 拼音首字母 / code 四路，大小写不敏感（不做全拼）；
 *       有搜索词只出结果列表。⚠️ banks.ts 无 `en` 字段（实测），英文简称由 code 承担。
 * 键盘：↑/↓ 移动高亮、Enter 选中、Esc 关闭（桌面必备）。
 * 首项：「不指定银行」（清空 institution）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Modal } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import BrandLogo from '@/components/BrandLogo'
import { BANKS } from '@/constants/banks'
import type { BankDef } from '@/constants/banks'
import { storage } from '@/utils/storage'

export const RECENT_BANKS_KEY = 'recent_banks'
const RECENT_MAX = 8

interface Props {
  visible: boolean
  /** 当前选中的银行 code（'' = 未指定） */
  value?: string
  onClose: () => void
  /** code = '' 表示「不指定银行」 */
  onSelect: (code: string) => void
}

/** 最近使用（去重置顶截断 8），供选择后回写 */
function pushRecent(code: string): void {
  if (!code) return
  const prev = storage.get<string[]>(RECENT_BANKS_KEY, []) ?? []
  const next = [code, ...prev.filter((c) => c !== code)].slice(0, RECENT_MAX)
  storage.set(RECENT_BANKS_KEY, next)
}

function readRecent(): string[] {
  return (storage.get<string[]>(RECENT_BANKS_KEY, []) ?? []).filter((c) =>
    BANKS.some((b) => b.code === c),
  )
}

/** py 首字母分组键（B7：必须用 py 字段，缺失兜底 short 首字；非 A–Z 归入 #） */
function groupKeyOf(b: BankDef): string {
  const ch = (b.py?.[0] || b.short?.[0] || '#').toUpperCase()
  return /[A-Z]/.test(ch) ? ch : '#'
}

interface Row {
  key: string
  code: string // '' = 不指定银行
  bank?: BankDef
}

export default function BankPicker({ visible, value = '', onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [focusIdx, setFocusIdx] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 打开时重置
  useEffect(() => {
    if (visible) {
      setQuery('')
      setFocusIdx(0)
    }
  }, [visible])

  // ---- 数据分段 ----
  const recent = useMemo(() => (visible ? readRecent() : []), [visible])

  const searchResults = useMemo<BankDef[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return BANKS.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.short.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        b.py.toLowerCase().includes(q),
    )
  }, [query])

  const groups = useMemo<{ letter: string; banks: BankDef[] }[]>(() => {
    const map = new Map<string, BankDef[]>()
    for (const b of BANKS) {
      const k = groupKeyOf(b)
      const arr = map.get(k)
      if (arr) arr.push(b)
      else map.set(k, [b])
    }
    return [...map.entries()]
      .sort(([a], [c]) => (a === '#' ? 1 : c === '#' ? -1 : a.localeCompare(c)))
      .map(([letter, banks]) => ({ letter, banks }))
  }, [])

  // 段间去重（同一银行只出现一次，键盘高亮序与渲染序一致）：最近 → 常用 → 全部
  const recentBanks = useMemo(
    () =>
      recent
        .map((c) => BANKS.find((b) => b.code === c))
        .filter((b): b is BankDef => !!b),
    [recent],
  )
  const hotBanks = useMemo(() => {
    const rc = new Set(recentBanks.map((b) => b.code))
    return BANKS.filter((b) => b.hot && !rc.has(b.code))
  }, [recentBanks])
  const letterGroups = useMemo(() => {
    const seen = new Set([...recentBanks, ...hotBanks].map((b) => b.code))
    return groups
      .map((g) => ({ ...g, banks: g.banks.filter((b) => !seen.has(b.code)) }))
      .filter((g) => g.banks.length > 0)
  }, [groups, recentBanks, hotBanks])

  // 扁平行列表（键盘导航序）：首项「不指定」+ 各段（无重复）
  const rows = useMemo<Row[]>(() => {
    const head: Row[] = [{ key: '__none__', code: '' }]
    if (query.trim()) {
      return [...head, ...searchResults.map((b) => ({ key: b.code, code: b.code, bank: b }))]
    }
    return [
      ...head,
      ...recentBanks.map((b) => ({ key: `r_${b.code}`, code: b.code, bank: b })),
      ...hotBanks.map((b) => ({ key: `h_${b.code}`, code: b.code, bank: b })),
      ...letterGroups.flatMap((g) => g.banks.map((b) => ({ key: `g_${b.code}`, code: b.code, bank: b }))),
    ]
  }, [query, searchResults, recentBanks, hotBanks, letterGroups])

  // 焦点越界保护
  useEffect(() => {
    if (focusIdx >= rows.length) setFocusIdx(0)
  }, [rows.length, focusIdx])

  function commit(code: string) {
    pushRecent(code)
    onSelect(code)
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx((i) => Math.min(rows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[focusIdx]
      if (row) commit(row.code)
    }
  }

  // 高亮行滚入可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${focusIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusIdx])

  function renderRow(row: Row, idx: number) {
    const b = row.bank
    const selected = row.code === value
    const focused = idx === focusIdx
    return (
      <button
        key={row.key}
        type="button"
        data-idx={idx}
        className={`bp-row${focused ? ' focus' : ''}${selected ? ' selected' : ''}`}
        onClick={() => commit(row.code)}
        onMouseEnter={() => setFocusIdx(idx)}
      >
        {row.code === '' ? (
          <BrandLogo icon="" size={24} fallbackText="不" className="bp-logo" />
        ) : (
          <BrandLogo
            icon={b?.logo ? `brand:${b.logo}` : ''}
            size={24}
            fallbackText={b?.short?.[0] || b?.name?.[0]}
            className="bp-logo"
          />
        )}
        <span className="bp-short">{row.code === '' ? '不指定银行' : b!.short}</span>
        {row.code !== '' && b!.name !== b!.short && <span className="bp-full">{b!.name}</span>}
        {selected && <span className="bp-check">✓</span>}
      </button>
    )
  }

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      title="选择银行"
      width={520}
      bodyStyle={{ paddingTop: 12 }}
      footer={
        <Button theme="light" type="tertiary" onClick={onClose}>
          取消
        </Button>
      }
    >
      {/* onKeyDown 挂在包裹层：搜索框输入时 ↑/↓/Enter 同样生效 */}
      <div onKeyDown={onKeyDown}>
        <Input
          prefix={<Icon name="Search" size={16} />}
          placeholder="搜索银行名 / 简称 / 拼音首字母 / 编码"
          value={query}
          onChange={(v: string) => {
            setQuery(v)
            setFocusIdx(0)
          }}
          showClear
        />

        <div className="bp-list" ref={listRef}>
          {renderRow(rows[0], 0)}

          {query.trim() ? (
            searchResults.length === 0 ? (
              <div className="bp-empty">没有匹配的银行</div>
            ) : (
              searchResults.map((b, i) => renderRow({ key: b.code, code: b.code, bank: b }, i + 1))
            )
          ) : (
            <>
              {recentBanks.length > 0 && (
                <>
                  <div className="bp-section-title">最近使用</div>
                  {recentBanks.map((b) => {
                    const idx = rows.findIndex((r) => r.code === b.code)
                    return renderRow({ key: `r_${b.code}`, code: b.code, bank: b }, idx)
                  })}
                </>
              )}
              <div className="bp-section-title">常用</div>
              {hotBanks.map((b) => {
                const idx = rows.findIndex((r) => r.code === b.code)
                return renderRow({ key: `h_${b.code}`, code: b.code, bank: b }, idx)
              })}
              {letterGroups.map((g) => (
                <div key={g.letter}>
                  <div className="bp-section-title sticky">{g.letter}</div>
                  {g.banks.map((b) => {
                    const idx = rows.findIndex((r) => r.code === b.code)
                    return renderRow({ key: `g_${b.code}`, code: b.code, bank: b }, idx)
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
