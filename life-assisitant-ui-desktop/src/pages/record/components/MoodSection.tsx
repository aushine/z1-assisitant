/**
 * MoodSection — 今日心情 / 精力标记（M02 / M04 / M05）。
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/MoodSection.vue
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/mood.go
 * 最后同步：2026-09-19（改为按小时记录 + 时间线 + 当前小时快捷区）
 *
 * 结构：
 *   卡片头：今日心情 + 此刻实时时钟
 *   副标题：按小时记录 · 心情会延续
 *   此刻区：心情 5 档 / 精力 3 档(+不填) / 备注(≤50) + 保存；点一下立刻落库
 *   时间线：按小时倒序，当前小时高亮「现在」，点任一行弹窗编辑那一小时
 *
 * 交互要点（对齐后端三态契约）：
 *   - 「此刻」chips 点一下立刻落库：只发被点的那一个字段（mood / energy），
 *     再点同一个值 = 取消该小时的单独记录（显式发 0）。
 *   - 备注「保存」只发 note；备注每小时一刷，不延续，输入框反映当前小时那一行。
 *   - 时间线当前小时行高亮 + 「现在」标记；点任一行打开弹窗编辑那个小时。
 *
 * 选中态来源是「时间线最后一条」（后端已向前延续填充），不是本地 state。
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Modal, Skeleton, TextArea, Toast } from '@douyinfe/semi-ui'
import { Icon, TINT_VARS } from '@/components/icon'
import { useMoodStore } from '@/stores/mood'
import ErrorState from '@/components/ErrorState'
import {
  energyOptions,
  moodOptions,
  MOOD_META,
  ENERGY_META,
  MOOD_VALUES_DESC,
} from '@/utils/mood-dict'
import type { EnergyValue, MoodHourItem, MoodValue } from '@/api/types'

/** 记录页用降序（很好 → 很差），见 utils/mood-dict.ts 的头注释 */
const MOOD_OPTIONS = moodOptions(MOOD_VALUES_DESC)
const ENERGY_OPTIONS = energyOptions([3, 2, 1])

/** 本地时区今天 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}
function moodText(m: number): string {
  if (!m) return '未记录'
  return MOOD_META[m as MoodValue]?.label ?? ''
}
function energyText(e: number): string {
  if (!e) return ''
  return ENERGY_META[e as EnergyValue]?.label ?? ''
}

/** 落库后的提示：整行被清空 > 取消该字段 > 正常记录 */
function toastOf(resp: { item: MoodHourItem | null } | null, cleared: boolean): void {
  if (!resp) return // 失败由 store 统一提示
  if (resp.item === null) Toast.success('已清除这一条')
  else if (cleared) Toast.success('已恢复沿用上一条')
  else Toast.success('已记录')
}

interface Props {
  /**
   * 是否折叠内部的「今天的时间线」：默认只显示最近 3 条，超出显示「展开全天」。
   * - 首页：不传（默认 false）→ 全量、不折叠；
   * - 健康 tab：传 true → 默认 3 条 + 展开全天。
   */
  collapse?: boolean
}

/** 折叠时默认展示的小时条数 */
const TL_COLLAPSE = 3

export function MoodSection({ collapse = false }: Props) {
  const moodStore = useMoodStore()
  const today = useMemo(todayStr, [])

  const [loadFailed, setLoadFailed] = useState(false)
  /** 编辑中的小时（弹窗） */
  const [editing, setEditing] = useState<MoodHourItem | null>(null)
  /** 折叠态下是否展开全天（仅 collapse=true 时生效） */
  const [tlExpanded, setTlExpanded] = useState(false)

  // 此刻实时时钟（仅展示；落库用的 hour 取自服务端 now_hour）
  const [clock, setClock] = useState(() => new Date())

  async function load() {
    setLoadFailed(false)
    try {
      await moodStore.fetchTimeline(today)
    } catch {
      setLoadFailed(true)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = moodStore.timeline?.items ?? []
  /** 时间线最后一条 = 延续后的「此刻」值（后端已向前延续填充） */
  const latest = items.length ? items[items.length - 1] : null
  const selMood = latest?.mood ?? 0
  const selEnergy = latest?.energy ?? 0
  /** 当前小时那一行（备注只属于当前小时） */
  const currentHour = items.find((i) => i.hour === moodStore.nowHour) ?? null

  // 备注草稿：反映当前小时那行的备注；跨小时 / 重拉后同步（编辑中不打断）
  const [noteDraft, setNoteDraft] = useState('')
  const [noteEditing, setNoteEditing] = useState(false)
  useEffect(() => {
    if (!noteEditing) setNoteDraft(currentHour?.note ?? '')
  }, [currentHour?.note, noteEditing])

  async function pickMood(m: MoodValue) {
    // 再点同一个值 = 该小时不再单独记录（只发 mood:0），显示时回落到上一条的延续值
    const mood = selMood === m ? 0 : m
    const resp = await moodStore.upsertHour({ date: today, hour: moodStore.nowHour, mood })
    toastOf(resp, mood === 0)
  }

  async function pickEnergy(e: EnergyValue) {
    const energy = selEnergy === e ? 0 : e
    const resp = await moodStore.upsertHour({ date: today, hour: moodStore.nowHour, energy })
    toastOf(resp, energy === 0)
  }

  async function clearEnergy() {
    const resp = await moodStore.upsertHour({ date: today, hour: moodStore.nowHour, energy: 0 })
    toastOf(resp, true)
  }

  async function saveNote() {
    setNoteEditing(false)
    const resp = await moodStore.upsertHour({
      date: today,
      hour: moodStore.nowHour,
      note: noteDraft.slice(0, 50),
    })
    toastOf(resp, false)
  }

  // ---- 弹窗编辑某一小时 ----
  const [editMood, setEditMood] = useState<MoodValue | 0>(0)
  const [editEnergy, setEditEnergy] = useState<EnergyValue | 0>(0)
  const [editNote, setEditNote] = useState('')
  const [touched, setTouched] = useState({ mood: false, energy: false, note: false })

  function openHour(item: MoodHourItem) {
    setEditing(item)
    setEditMood(item.mood)
    setEditEnergy(item.energy)
    setEditNote(item.note ?? '')
    setTouched({ mood: false, energy: false, note: false })
  }

  async function saveHour() {
    if (!editing) return
    const payload: { date: string; hour: number; mood?: MoodValue | 0; energy?: EnergyValue | 0; note?: string } = {
      date: today,
      hour: editing.hour,
    }
    // 三态语义：只发被改动的字段，未动的保持原样
    if (touched.mood) payload.mood = editMood
    if (touched.energy) payload.energy = editEnergy
    if (touched.note) payload.note = editNote.slice(0, 50)
    if (!touched.mood && !touched.energy && !touched.note) {
      setEditing(null)
      return
    }
    const resp = await moodStore.upsertHour(payload)
    toastOf(resp, false)
    setEditing(null)
  }

  const clockText = `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`
  const loading = moodStore.timelineLoading
  const showError = loadFailed && !moodStore.timeline

  return (
    <Card bordered={false} className="card mood-card">
      <div className="card-head">
        <div>
          <span className="card-title">今日心情</span>
          <span className="card-sub">按小时记录 · 心情会延续</span>
        </div>
        <span className="mood-clock">
          <Icon name="Clock" size={14} />
          {clockText}
        </span>
      </div>

      {showError ? (
        <ErrorState compact message="心情加载失败，请重试" onRetry={load} />
      ) : (
        <div className="mood-body">
          {/* 此刻 */}
          <div className="mood-section-label">此刻</div>
          <div className="mood-row">
            <span className="mood-row-label">心情</span>
            <div className="mood-chips">
              {MOOD_OPTIONS.map((o) => {
                const selected = selMood === o.value
                return (
                  <div
                    key={o.value}
                    className={`mood-chip${selected ? ' active' : ''}`}
                    onClick={() => pickMood(o.value)}
                    style={{
                      background: selected ? TINT_VARS[o.tint].bg : 'transparent',
                      borderColor: selected ? 'var(--color-primary-500)' : 'var(--color-border-light)',
                      color: TINT_VARS[o.tint].fg,
                    }}
                    title={o.label}
                  >
                    <Icon name={o.icon} size={18} />
                    <span className="mood-chip-label">{o.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mood-row">
            <span className="mood-row-label">精力</span>
            <div className="mood-chips">
              {ENERGY_OPTIONS.map((o) => {
                const selected = selEnergy === o.value
                return (
                  <div
                    key={o.value}
                    className={`mood-chip${selected ? ' active' : ''}`}
                    onClick={() => pickEnergy(o.value)}
                    style={{
                      background: selected ? TINT_VARS[o.tint].bg : 'transparent',
                      borderColor: selected ? 'var(--color-primary-500)' : 'var(--color-border-light)',
                      color: TINT_VARS[o.tint].fg,
                    }}
                    title={o.label}
                  >
                    <Icon name={o.icon} size={18} />
                    <span className="mood-chip-label">{o.label}</span>
                  </div>
                )
              })}
              <div
                className={`mood-chip mood-chip-clear${selEnergy === 0 ? ' active' : ''}`}
                onClick={clearEnergy}
                title="精力不填"
              >
                <span className="mood-chip-label">不填</span>
              </div>
            </div>
          </div>

          <div className="mood-row mood-note-row">
            <span className="mood-row-label">备注</span>
            <TextArea
              className="mood-note"
              value={noteDraft}
              onChange={(v: string) => setNoteDraft(v)}
              onFocus={() => setNoteEditing(true)}
              onBlur={() => setNoteEditing(false)}
              placeholder="这一刻的想法…（≤50 字）"
              maxLength={50}
              rows={1}
            />
            <Button
              theme="light"
              type="secondary"
              size="small"
              loading={moodStore.timelineSaving}
              onClick={saveNote}
              style={{ alignSelf: 'flex-start' }}
            >
              保存
            </Button>
          </div>

          <p className="mood-hint">不点就是继续沿用上一次的心情和精力；备注只属于当前这个小时</p>

          {items.length === 0 && (
            <p className="mood-empty-tip">今天还没有记录。点一下心情，就从现在开始。</p>
          )}

          {/* 时间线（倒序：新 → 旧）；折叠态默认只显示最近 3 条 */}
          <div className="mood-section-label">今天的时间线</div>
          {items.length === 0 ? (
            <p className="mood-tl-empty">还没有时间线条目</p>
          ) : (
            <>
              <ul className="mood-timeline">
                {(() => {
                  const reversed = [...items].reverse()
                  const shown =
                    collapse && !tlExpanded && reversed.length > TL_COLLAPSE
                      ? reversed.slice(0, TL_COLLAPSE)
                      : reversed
                  return shown.map((item) => (
                    <li
                      key={item.hour}
                      className={`mood-tl-row${item.hour === moodStore.nowHour ? ' is-now' : ''}`}
                      onClick={() => openHour(item)}
                    >
                      {item.hour === moodStore.nowHour && <span className="mood-tl-now">现在</span>}
                      <span className="mood-tl-hour">{hourLabel(item.hour)}</span>
                      <span className="mood-tl-mood">
                        {moodText(item.mood)}
                        {energyText(item.energy) ? ` · ${energyText(item.energy)}` : ''}
                      </span>
                      {item.note && <span className="mood-tl-note">{item.note}</span>}
                    </li>
                  ))
                })()}
              </ul>
              {/* 折叠态且仍有更多条目 → 展开全天 */}
              {collapse && !tlExpanded && items.length > TL_COLLAPSE && (
                <button className="mood-tl-expand" onClick={() => setTlExpanded(true)}>
                  展开全天
                </button>
              )}
            </>
          )}
        </div>
      )}

      {loading && !moodStore.timeline && !loadFailed && (
        <div className="skeleton-wrap">
          <Skeleton><Skeleton.Paragraph rows={2} /></Skeleton>
        </div>
      )}

      <Modal
        title={editing ? `编辑 ${hourLabel(editing.hour)} 的记录` : ''}
        visible={!!editing}
        onCancel={() => setEditing(null)}
        onOk={saveHour}
        okText="保存"
        cancelText="取消"
        confirmLoading={moodStore.timelineSaving}
      >
        <div className="mood-body">
          <div className="mood-row">
            <span className="mood-row-label">心情</span>
            <div className="mood-chips">
              {MOOD_OPTIONS.map((o) => {
                const selected = editMood === o.value
                return (
                  <div
                    key={o.value}
                    className={`mood-chip${selected ? ' active' : ''}`}
                    onClick={() => {
                      setEditMood(o.value)
                      setTouched((t) => ({ ...t, mood: true }))
                    }}
                    style={{
                      background: selected ? TINT_VARS[o.tint].bg : 'transparent',
                      borderColor: selected ? 'var(--color-primary-500)' : 'var(--color-border-light)',
                      color: TINT_VARS[o.tint].fg,
                    }}
                    title={o.label}
                  >
                    <Icon name={o.icon} size={18} />
                    <span className="mood-chip-label">{o.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mood-row">
            <span className="mood-row-label">精力</span>
            <div className="mood-chips">
              {ENERGY_OPTIONS.map((o) => {
                const selected = editEnergy === o.value
                return (
                  <div
                    key={o.value}
                    className={`mood-chip${selected ? ' active' : ''}`}
                    onClick={() => {
                      setEditEnergy(o.value)
                      setTouched((t) => ({ ...t, energy: true }))
                    }}
                    style={{
                      background: selected ? TINT_VARS[o.tint].bg : 'transparent',
                      borderColor: selected ? 'var(--color-primary-500)' : 'var(--color-border-light)',
                      color: TINT_VARS[o.tint].fg,
                    }}
                    title={o.label}
                  >
                    <Icon name={o.icon} size={18} />
                    <span className="mood-chip-label">{o.label}</span>
                  </div>
                )
              })}
              <div
                className={`mood-chip mood-chip-clear${editEnergy === 0 ? ' active' : ''}`}
                onClick={() => {
                  setEditEnergy(0)
                  setTouched((t) => ({ ...t, energy: true }))
                }}
                title="精力不填"
              >
                <span className="mood-chip-label">不填</span>
              </div>
            </div>
          </div>

          <div className="mood-row">
            <span className="mood-row-label">备注</span>
            <TextArea
              className="mood-note"
              value={editNote}
              onChange={(v: string) => {
                setEditNote(v)
                setTouched((t) => ({ ...t, note: true }))
              }}
              placeholder="这一刻的想法…（≤50 字）"
              maxLength={50}
              rows={1}
            />
          </div>
        </div>
      </Modal>
    </Card>
  )
}

export default MoodSection
