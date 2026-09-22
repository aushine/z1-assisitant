/**
 * IconPicker —— 图标选择器（桌面端）
 *
 * 形态：居中 Modal（宽 ~520，含搜索 + 分组 chips + 6 列图标网格）。
 * 行为逐条对齐 04 §4 桌面端规格：
 *   - 搜索：按图标名（英文）模糊、跨组；
 *   - 分组 chips：默认第 1 组，切换组不清空搜索；
 *   - 选中即关闭，点击遮罩/取消关闭；
 *   - 键盘：Esc 关闭、方向键移动焦点、Enter 选中、输入即聚焦搜索框。
 *
 * 图标清单来自 `ICON_GROUPS`（fin-icons 维护，两端逐字一致 + 哈希校验）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Button, Input } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import type { IconName } from '@/components/icon'
import { ICON_GROUPS } from '@/constants/icon-groups'

interface Props {
  visible: boolean
  value?: IconName | null
  onClose: () => void
  onSelect: (name: IconName) => void
}

const GRID_COLS = 6

export default function IconPicker({ visible, value, onClose, onSelect }: Props) {
  const groupKeys = useMemo(() => Object.keys(ICON_GROUPS), [])
  const [activeGroup, setActiveGroup] = useState<string>(groupKeys[0] ?? '')
  const [query, setQuery] = useState('')
  const [focusIdx, setFocusIdx] = useState(0)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  // 打开时重置状态并聚焦搜索框
  useEffect(() => {
    if (visible) {
      setQuery('')
      setActiveGroup(groupKeys[0] ?? '')
      setFocusIdx(0)
      // 延迟到 Modal 渲染后聚焦
      const t = setTimeout(() => searchRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // 当前可见的图标列表
  const visibleIcons = useMemo<IconName[]>(() => {
    const q = query.trim().toLowerCase()
    if (q) {
      const all: IconName[] = []
      for (const list of Object.values(ICON_GROUPS)) {
        for (const n of list) if (n.toLowerCase().includes(q)) all.push(n)
      }
      return all
    }
    return ICON_GROUPS[activeGroup] ?? []
  }, [query, activeGroup, groupKeys])

  // 焦点越界保护
  useEffect(() => {
    if (focusIdx >= visibleIcons.length) setFocusIdx(0)
  }, [visibleIcons.length, focusIdx])

  function commit(name: IconName) {
    onSelect(name)
    onClose()
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    if (visibleIcons.length === 0) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setFocusIdx((i) => Math.min(visibleIcons.length - 1, i + 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setFocusIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx((i) => Math.min(visibleIcons.length - 1, i + GRID_COLS))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx((i) => Math.max(0, i - GRID_COLS))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const name = visibleIcons[focusIdx]
      if (name) commit(name)
    }
  }

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={
        <Button theme="light" type="tertiary" onClick={onClose}>
          取消
        </Button>
      }
      title="选择图标"
      width={520}
      bodyStyle={{ paddingTop: 12 }}
    >
      <Input
        ref={searchRef as never}
        prefix={<Icon name="Search" size={16} />}
        placeholder="搜索图标…"
        value={query}
        onChange={(v: string) => {
          setQuery(v)
          setFocusIdx(0)
        }}
        showClear
      />

      {!query && (
        <div className="icon-group-chips">
          {groupKeys.map((k) => (
            <button
              key={k}
              type="button"
              className={`icon-group-chip${k === activeGroup ? ' active' : ''}`}
              onClick={() => {
                setActiveGroup(k)
                setFocusIdx(0)
              }}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {visibleIcons.length === 0 ? (
        <div className="icon-picker-empty">没有匹配的图标</div>
      ) : (
        <div
          className="icon-grid"
          ref={gridRef}
          role="listbox"
          tabIndex={0}
          onKeyDown={onGridKeyDown}
        >
          {visibleIcons.map((name, idx) => (
            <button
              key={name}
              type="button"
              className={`icon-cell${value === name ? ' active' : ''}${focusIdx === idx ? ' focus' : ''}`}
              title={name}
              onClick={() => commit(name)}
              onMouseEnter={() => setFocusIdx(idx)}
            >
              <Icon name={name} size={20} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
