<script setup lang="ts">
/**
 * BankPicker —— 银行选择器（spec-20260922-v1 · 01 §6.2）
 *
 * 形态：`van-popup` 底部弹层（⚠️ `teleport="body"` 铁律；**不加 closeable**，
 * 关闭出口只留「取消」+ 点遮罩 —— 项目铁律，同 AccountEditSheet 的处理）。
 *
 * 三段式：① 首项「不指定银行」（清空 institution 用）
 *         ② 最近使用 ≤8（localStorage `recent_banks`，仅存 code，不入库）
 *         ③ 常用（hot）→ 全部（按 `py` 首字母 A–Z 分组）
 * ⚠️ 分组依据 = `bank.py[0]`（简称拼音首字母，B7；py 缺失兜底 short 首字），
 *    **不要**用全称首字（「中国工商银行」会排到 Z，用户找的是「工商银行」→ G）。
 * 搜索：中文名 / 简称 / py / code 四路、大小写不敏感（不做全拼）；
 *       有搜索词时隐藏三段式只出结果列表。
 * 索引条：固定 A–Z 26 格、absolute 定位**不随列表滚动**；无数据字母置灰无效。
 */
import { computed, ref, watch } from 'vue'
import Icon from '@/components/icon/Icon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { BANKS, type BankDef } from '@/constants/banks'

interface Props {
  show: boolean
  /** 当前已选 code（高亮用） */
  selected?: string
}

const props = withDefaults(defineProps<Props>(), {
  selected: '',
})

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  /** 选中的银行 code；'' = 不指定银行（清空 institution） */
  (e: 'select', code: string): void
}>()

const TITLE = '选择银行'
const RECENT_KEY = 'recent_banks'
const RECENT_MAX = 8
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
/** 无 logo 银行的文字徽标尺寸：内联 px，与 BrandLogo 的内联尺寸一致
 *  （SCSS 里的 px 会被 postcss-px-to-viewport 转成 vw，两者会错位） */
const BADGE_STYLE = { width: '28px', height: '28px', fontSize: '14px' }

const keyword = ref('')
const scrollEl = ref<HTMLElement | null>(null)
/** 字母分组标题的 DOM 映射（非响应式即可：只在 jump 时读取） */
const groupEls: Record<string, HTMLElement | null> = {}

const searching = computed(() => keyword.value.trim().length > 0)

// ==================== 最近使用（localStorage，仅本机） ====================
function loadRecentCodes(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((c): c is string => typeof c === 'string') : []
  } catch {
    return []
  }
}

const recentBanks = computed<BankDef[]>(() =>
  loadRecentCodes()
    .map((code) => BANKS.find((b) => b.code === code))
    .filter((b): b is BankDef => !!b)
)

/** 去重置顶截断 8（选择时写回） */
function saveRecent(code: string): void {
  if (!code) return
  const next = [code, ...loadRecentCodes().filter((c) => c !== code)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* 存储满 / 隐私模式：静默放弃（最近使用是纯增强） */
  }
}

// ==================== 常用 / 字母分组 ====================
const hotBanks = computed(() => BANKS.filter((b) => b.hot))

const letterGroups = computed(() => {
  const byLetter = new Map<string, BankDef[]>()
  for (const b of BANKS) {
    // ⚠️ B7：分组用 py 首字母；py 缺失兜底 short 首字（py 由生成脚本保证非空，防御式兜底）
    const letter = (b.py?.[0] ?? b.short?.[0] ?? '#').toUpperCase()
    const list = byLetter.get(letter)
    if (list) list.push(b)
    else byLetter.set(letter, [b])
  }
  return LETTERS.filter((l) => byLetter.has(l)).map((letter) => ({
    letter,
    banks: byLetter.get(letter) as BankDef[],
  }))
})

const activeLetters = computed(() => new Set(letterGroups.value.map((g) => g.letter)))

// ==================== 搜索（中文名 / 简称 / py / code，大小写不敏感） ====================
const results = computed<BankDef[]>(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return []
  return BANKS.filter(
    (b) =>
      b.name.toLowerCase().includes(q) ||
      b.short.toLowerCase().includes(q) ||
      (b.py ?? '').toLowerCase().includes(q) ||
      b.code.toLowerCase().includes(q)
  )
})

// ==================== 选择 / 关闭 ====================
function choose(b: BankDef): void {
  saveRecent(b.code)
  emit('select', b.code)
  emit('update:show', false)
}

function chooseNone(): void {
  emit('select', '')
  emit('update:show', false)
}

function close(): void {
  emit('update:show', false)
}

/** 点字母跳转：标题与列表同一滚动容器 → 直接 offsetTop（01 §6.2） */
function jump(letter: string): void {
  if (!activeLetters.value.has(letter)) return
  const el = groupEls[letter]
  if (el && scrollEl.value) scrollEl.value.scrollTop = el.offsetTop
}

watch(
  () => props.show,
  (v) => {
    if (v) keyword.value = ''
  }
)

function setGroupRef(letter: string, el: unknown): void {
  groupEls[letter] = (el as HTMLElement) ?? null
}
</script>

<template>
  <!-- ⚠️ teleport="body" 必留（嵌套弹层会被父级滚动容器压住，同 AccountEditSheet）；
       ⚠️ 不加 closeable：关闭出口只留「取消」+ 点遮罩（项目铁律） -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '72%' }"
    round
    teleport="body"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="bank-picker">
      <div class="bp-header">
        <span class="bp-title">{{ TITLE }}</span>
        <button type="button" class="bp-cancel" @click="close">取消</button>
      </div>

      <!-- 搜索（固定不滚动） -->
      <div class="bp-search">
        <Icon name="Search" :size="16" class="bp-search-icon" aria-hidden="true" />
        <input
          v-model="keyword"
          type="search"
          class="bp-search-input"
          placeholder="搜索银行名 / 简称 / 编码"
          enterkeyhint="search"
        >
        <button
          v-if="searching"
          type="button"
          class="bp-search-clear"
          aria-label="清空"
          @click="keyword = ''"
        >×</button>
      </div>

      <div ref="scrollEl" class="bp-scroll">
        <!-- 首项：不指定银行（清空 institution 用） -->
        <button type="button" class="bp-row bp-none" @click="chooseNone">
          <span class="bp-badge bp-badge--none" :style="BADGE_STYLE" aria-hidden="true">–</span>
          <span class="bp-name">不指定银行</span>
        </button>

        <!-- 搜索态：只出结果列表 -->
        <template v-if="searching">
          <div v-if="results.length === 0" class="bp-empty">没找到匹配的银行</div>
          <button
            v-for="b in results"
            :key="b.code"
            type="button"
            class="bp-row"
            :class="{ 'is-active': selected === b.code }"
            @click="choose(b)"
          >
            <BrandLogo
              v-if="b.logo"
              :icon="`brand:${b.logo}`"
              :fallback-text="b.short"
              :institution="b.code"
              :size="28"
            />
            <span v-else class="bp-badge" :style="BADGE_STYLE" aria-hidden="true">{{ b.short.slice(0, 1) }}</span>
            <span class="bp-name">{{ b.short }}</span>
            <span v-if="b.name !== b.short" class="bp-sub">{{ b.name }}</span>
            <Icon v-if="selected === b.code" name="Check" :size="16" class="bp-check" />
          </button>
        </template>

        <!-- 三段式：最近使用 → 常用 → 全部（A–Z） -->
        <template v-else>
          <template v-if="recentBanks.length > 0">
            <div class="bp-group-title">最近使用</div>
            <button
              v-for="b in recentBanks"
              :key="`recent-${b.code}`"
              type="button"
              class="bp-row"
              :class="{ 'is-active': selected === b.code }"
              @click="choose(b)"
            >
              <BrandLogo
                v-if="b.logo"
                :icon="`brand:${b.logo}`"
                :fallback-text="b.short"
                :institution="b.code"
                :size="28"
              />
              <span v-else class="bp-badge" :style="BADGE_STYLE" aria-hidden="true">{{ b.short.slice(0, 1) }}</span>
              <span class="bp-name">{{ b.short }}</span>
              <Icon v-if="selected === b.code" name="Check" :size="16" class="bp-check" />
            </button>
          </template>

          <div class="bp-group-title">常用</div>
          <button
            v-for="b in hotBanks"
            :key="`hot-${b.code}`"
            type="button"
            class="bp-row"
            :class="{ 'is-active': selected === b.code }"
            @click="choose(b)"
          >
            <BrandLogo
              v-if="b.logo"
              :icon="`brand:${b.logo}`"
              :fallback-text="b.short"
              :institution="b.code"
              :size="28"
            />
            <span v-else class="bp-badge" :style="BADGE_STYLE" aria-hidden="true">{{ b.short.slice(0, 1) }}</span>
            <span class="bp-name">{{ b.short }}</span>
            <Icon v-if="selected === b.code" name="Check" :size="16" class="bp-check" />
          </button>

          <template v-for="g in letterGroups" :key="g.letter">
            <div :ref="(el) => setGroupRef(g.letter, el)" class="bp-group-title bp-letter">
              {{ g.letter }}
            </div>
            <button
              v-for="b in g.banks"
              :key="g.letter + b.code"
              type="button"
              class="bp-row"
              :class="{ 'is-active': selected === b.code }"
              @click="choose(b)"
            >
              <BrandLogo
                v-if="b.logo"
                :icon="`brand:${b.logo}`"
                :fallback-text="b.short"
                :institution="b.code"
                :size="28"
              />
              <span v-else class="bp-badge" :style="BADGE_STYLE" aria-hidden="true">{{ b.short.slice(0, 1) }}</span>
              <span class="bp-name">{{ b.short }}</span>
              <Icon v-if="selected === b.code" name="Check" :size="16" class="bp-check" />
            </button>
          </template>

          <div class="bp-foot-space" aria-hidden="true" />
        </template>
      </div>

      <!-- 右侧字母索引条：absolute 定位，不随列表滚动；无数据字母置灰无效 -->
      <div v-if="!searching" class="bp-index" aria-hidden="true">
        <button
          v-for="l in LETTERS"
          :key="l"
          type="button"
          class="bp-index-item"
          :class="{ 'is-off': !activeLetters.has(l) }"
          :disabled="!activeLetters.has(l)"
          @click="jump(l)"
        >{{ l }}</button>
      </div>
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.bank-picker {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-app);
}

.bp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px var(--space-4) 8px;
}
.bp-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
.bp-cancel {
  border: 0;
  background: transparent;
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
  padding: 4px 6px;
  &:active { opacity: 0.7; }
}

.bp-search {
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  margin: 0 var(--space-4) var(--space-2);
  padding: 0 34px 0 32px;
  height: 38px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
}
.bp-search-icon {
  position: absolute;
  left: 10px;
  color: var(--color-text-tertiary);
}
.bp-search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  &::placeholder { color: var(--color-text-disabled); }
  &::-webkit-search-cancel-button { display: none; }
}
.bp-search-clear {
  position: absolute;
  right: 6px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: var(--fs-h4);
  color: var(--color-text-tertiary);
  &:active { background: var(--color-bg-hover); }
}

/* 唯一滚动容器（01 §6.2 .bp-scroll）；position:relative 使分组标题 offsetTop 可直接用 */
.bp-scroll {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

.bp-group-title {
  padding: 8px var(--space-4) 4px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  background: var(--color-bg-app);
}
/* 字母分组标题吸顶（01 §6.2） */
.bp-letter {
  position: sticky;
  top: 0;
  z-index: 1;
  font-weight: 600;
}

.bp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px var(--space-4);
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
  &.is-active .bp-name { color: var(--color-primary); font-weight: 600; }
}
.bp-none {
  border-bottom: 1px solid var(--color-border-light);
  margin-bottom: 4px;
}
.bp-name {
  flex-shrink: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
}
.bp-sub {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-check {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--color-primary);
}

/* 无 logo 银行的文字徽标（02 §6：中性灰 + 简称首字，B3 暂无品牌色字段） */
.bp-badge {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-base);
  background: #8A8A8A;
  color: #FFFFFF;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
.bp-badge--none {
  background: var(--color-bg-hover);
  color: var(--color-text-tertiary);
}

.bp-empty {
  padding: 40px 0;
  text-align: center;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.bp-foot-space {
  height: calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
}

/* 索引条：absolute + 垂直居中，不随列表滚动（01 §6.2） */
.bp-index {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 0;
  z-index: 2;
  padding: 4px 0;
}
.bp-index-item {
  width: 18px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-primary);
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(1.2); }
  &.is-off {
    color: var(--color-text-disabled);
    cursor: default;
  }
}
</style>
