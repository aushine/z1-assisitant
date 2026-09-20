<script setup lang="ts">
/**
 * 首次设置向导 —— 5 步（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/period/components/PeriodSetupWizard.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/period.go（PeriodSetupReq）
 * 契约文档：md/spec-260919/04-页面与交互设计.md §7.5
 *
 * 触发条件：首次进入经期 Tab 且 `period_settings.disclaimer_accepted_at IS NULL`。
 *
 * 两步的取舍（照抄设计，不要「优化」）：
 *   1. 提交走**一次** `POST /period/setup`，不在中途落库 ——
 *      避免用户填到一半断网留下半状态（后端在事务里建骨架 + 写设置）。
 *   2. 「先看看」跳过**不写** `disclaimer_accepted_at`：下次进来会再次弹向导；
 *      但只要他点开记录浮层（那里会先弹同一条免责确认），也视为完成（04 §7.5）。
 *
 * 免责文案逐字取自 04 §7.1，不许自由发挥 —— 这句话的可信度就是功能的可信度。
 */
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import { usePeriodStore } from '@/stores/period'
import { PERIOD_GOAL_OPTIONS } from '@/constants/period'
import { addDays, formatMonthDay, todayDate } from '@/utils/date'

const emit = defineEmits<{
  (e: 'done'): void
  (e: 'skip'): void
}>()

const store = usePeriodStore()

const TOTAL = 5
const step = ref(1)

const lastPeriodStart = ref(addDays(todayDate(), -28))
const avgPeriodLength = ref(5)
const avgCycleLength = ref(28)
const goal = ref(2)

const maxDate = computed(() => todayDate())
const submitting = ref(false)

function next(): void {
  if (step.value < TOTAL) step.value++
}
function prev(): void {
  if (step.value > 1) step.value--
}

async function submit(): Promise<void> {
  if (!lastPeriodStart.value) {
    showFailToast('请选择上次月经开始的日期')
    return
  }
  if (lastPeriodStart.value > todayDate()) {
    showFailToast('日期不能晚于今天')
    return
  }
  submitting.value = true
  const ok = await store.setup({
    last_period_start: lastPeriodStart.value,
    avg_period_length: avgPeriodLength.value,
    avg_cycle_length: avgCycleLength.value,
    goal: goal.value,
    // 易孕期默认开启；围绝经期目标下后端会弱化展示（README §2.1）
    show_fertile_window: 1,
  })
  submitting.value = false
  if (ok) emit('done')
}
</script>

<template>
  <div class="wiz">
    <!-- ==================== 进度 ==================== -->
    <div class="wiz-progress" role="progressbar" :aria-valuenow="step" :aria-valuemin="1" :aria-valuemax="TOTAL">
      <span v-for="n in TOTAL" :key="n" class="wiz-seg" :class="{ 'is-on': n <= step }" />
    </div>
    <p class="wiz-step">第 {{ step }} / {{ TOTAL }} 步</p>

    <!-- ==================== 1 上次月经 ==================== -->
    <section v-if="step === 1" class="wiz-body">
      <h3 class="wiz-title">上次月经是几号来的？</h3>
      <p class="wiz-desc">从出血的第一天算起，不确定的话选个大概日期就行。</p>
      <input
        v-model="lastPeriodStart"
        class="wiz-date"
        type="date"
        :max="maxDate"
      >
      <p class="wiz-hint">已选：{{ formatMonthDay(lastPeriodStart) }}</p>
    </section>

    <!-- ==================== 2 经期几天 ==================== -->
    <section v-else-if="step === 2" class="wiz-body">
      <h3 class="wiz-title">一般来几天？</h3>
      <p class="wiz-desc">多数人是 3–7 天。</p>
      <div class="wiz-stepper">
        <button class="wiz-step-btn" type="button" aria-label="减少" @click="avgPeriodLength = Math.max(1, avgPeriodLength - 1)">−</button>
        <span class="wiz-step-value">{{ avgPeriodLength }} 天</span>
        <button class="wiz-step-btn" type="button" aria-label="增加" @click="avgPeriodLength = Math.min(15, avgPeriodLength + 1)">＋</button>
      </div>
    </section>

    <!-- ==================== 3 周期几天 ==================== -->
    <section v-else-if="step === 3" class="wiz-body">
      <h3 class="wiz-title">你的周期大概多少天？</h3>
      <p class="wiz-desc">两次月经第一天的间隔。不确定就用 28，之后会自动校准。</p>
      <div class="wiz-stepper">
        <button class="wiz-step-btn" type="button" aria-label="减少" @click="avgCycleLength = Math.max(15, avgCycleLength - 1)">−</button>
        <span class="wiz-step-value">{{ avgCycleLength }} 天</span>
        <button class="wiz-step-btn" type="button" aria-label="增加" @click="avgCycleLength = Math.min(60, avgCycleLength + 1)">＋</button>
      </div>
      <p class="wiz-hint">只有约 13% 的人周期正好是 28 天，填错也没关系。</p>
    </section>

    <!-- ==================== 4 目标 ==================== -->
    <section v-else-if="step === 4" class="wiz-body">
      <h3 class="wiz-title">你用这个功能主要想做什么？</h3>
      <p class="wiz-desc">只影响默认展示顺序与提示文案，随时可改。</p>
      <button
        v-for="g in PERIOD_GOAL_OPTIONS"
        :key="g.value"
        type="button"
        class="wiz-goal"
        :class="{ 'is-on': goal === g.value }"
        @click="goal = g.value"
      >
        <span class="wiz-goal-body">
          <span class="wiz-goal-label">{{ g.label }}</span>
          <span class="wiz-goal-desc">{{ g.desc }}</span>
        </span>
        <span class="wiz-goal-radio" :class="{ 'is-on': goal === g.value }" />
      </button>
    </section>

    <!-- ==================== 5 免责 ==================== -->
    <section v-else class="wiz-body">
      <h3 class="wiz-title">关于经期预测</h3>
      <div class="wiz-disclaimer">
        <p>本功能根据你自己记录的日期推算，属于日历法预测，存在误差：</p>
        <ul>
          <li>只有约 13% 的人周期正好是 28 天，第 14 天排卵的比例也约 13%</li>
          <li>日历法对排卵日的预测准确率约为 21%</li>
          <li>因此「相对安全期」不能作为避孕依据</li>
        </ul>
        <p>预测有助于了解自己的节律，但不能代替医学检查。</p>
        <p>如有月经紊乱、异常出血或持续不适，请咨询专业医生。</p>
      </div>
    </section>

    <!-- ==================== 底部操作 ==================== -->
    <footer class="wiz-foot">
      <button v-if="step > 1" class="wiz-btn wiz-btn-ghost" type="button" :disabled="submitting" @click="prev">
        上一步
      </button>
      <button
        v-if="step < TOTAL"
        class="wiz-btn wiz-btn-primary"
        type="button"
        @click="next"
      >
        下一步
      </button>
      <button
        v-else
        class="wiz-btn wiz-btn-primary"
        type="button"
        :disabled="submitting"
        @click="submit"
      >
        {{ submitting ? '保存中…' : '我知道了' }}
      </button>
    </footer>

    <button class="wiz-skip" type="button" @click="emit('skip')">
      <Icon name="X" :size="14" />
      先看看
    </button>
  </div>
</template>

<style lang="scss" scoped>
.wiz {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--space-4) var(--space-5) calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  position: relative;
}

/* ==================== 进度 ==================== */
.wiz-progress {
  display: flex;
  gap: 6px;
  margin-top: var(--space-2);
}
.wiz-seg {
  flex: 1;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-border-light);

  &.is-on { background: var(--color-primary); }
}
.wiz-step {
  margin: 8px 0 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ==================== 正文 ==================== */
.wiz-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-top: var(--space-5);
}
.wiz-title {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--color-text-primary);
}
.wiz-desc {
  margin: 0 0 var(--space-5);
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
  line-height: 1.55;
}
.wiz-hint {
  margin: var(--space-3) 0 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

/* ==================== 日期 ==================== */
.wiz-date {
  width: 100%;
  height: 52px;
  padding: 0 14px;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  font-size: var(--fs-body);
  font-family: var(--font-num);
  color: var(--color-text-primary);
  outline: none;

  &:focus { border-color: var(--color-primary); }
}

/* ==================== 步进 ==================== */
.wiz-stepper {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.wiz-step-btn {
  width: 52px;
  height: 52px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  font-size: var(--fs-h2);
  line-height: 1;
  color: var(--color-text-primary);

  &:active { background: var(--color-bg-hover); }
}
.wiz-step-value {
  flex: 1;
  text-align: center;
  font-size: var(--fs-metric-lg);
  font-weight: 600;
  font-family: var(--font-num);
  color: var(--color-text-primary);
}

/* ==================== 目标 ==================== */
.wiz-goal {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 14px var(--space-4);
  margin-bottom: 10px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  text-align: left;

  &.is-on {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
  &:active { transform: scale(0.99); }
}
.wiz-goal-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wiz-goal-label {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.wiz-goal-desc {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.wiz-goal-radio {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--color-border-strong);
  box-sizing: border-box;

  &.is-on {
    border-color: var(--color-primary);
    background: radial-gradient(circle, var(--color-primary) 0 5px, transparent 5px 100%);
  }
}

/* ==================== 免责 ==================== */
.wiz-disclaimer {
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  box-shadow: var(--shadow-xs);

  p {
    margin: 0 0 10px;
    font-size: var(--fs-caption);
    line-height: 1.65;
    color: var(--color-text-secondary);

    &:last-child { margin-bottom: 0; }
  }
  ul {
    margin: 0 0 10px;
    padding-left: 18px;
  }
  li {
    font-size: var(--fs-caption);
    line-height: 1.65;
    color: var(--color-text-secondary);
    margin-bottom: 4px;
  }
}

/* ==================== 底部 ==================== */
.wiz-foot {
  flex-shrink: 0;
  display: flex;
  gap: 10px;
  margin-top: var(--space-4);
}
.wiz-btn {
  height: 48px;
  border: 0;
  border-radius: var(--radius-pill);
  font-size: var(--fs-body);
  font-weight: 600;

  &:active:not(:disabled) { transform: scale(0.98); }
  &:disabled { opacity: 0.6; }
}
.wiz-btn-primary {
  flex: 1;
  background: var(--color-primary);
  color: #FFFFFF;
  box-shadow: var(--shadow-button);
}
.wiz-btn-ghost {
  flex-shrink: 0;
  padding: 0 22px;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.wiz-skip {
  position: absolute;
  top: var(--space-3);
  right: var(--space-4);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-bg-hover);
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);

  :deep(svg) { display: block; }
  &:active { opacity: 0.8; }
}
</style>
