<script setup lang="ts">
/**
 * 帮助与反馈（移动端 · Phase 5.7）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/me/help.tsx
 * 最后同步：2026-09-18
 *
 * 常见问题（4 条，文案与桌面端逐字一致）+ 提交反馈（POST /feedbacks）。
 * 差异：桌面端用 Semi Collapse，移动端用 van-collapse（折叠面板在这边是原生交互）。
 */
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast, showSuccessToast } from 'vant'
import { feedbackApi } from '@/api/feedback'
import Icon from '@/components/icon/Icon.vue'
import type { IconName } from '@/components/icon/names'

/** 反馈类型（对齐后端 dto.CreateFeedbackReq.type 的枚举） */
type FeedbackType = 'bug' | 'suggestion' | 'other'

const router = useRouter()

/** 常见问题：文案与桌面端 help.tsx 的 FAQ 完全一致 */
const FAQ: Array<{ q: string; a: string }> = [
  { q: '如何创建任务？', a: '在「待办」页点击右上角「+」按钮，填写标题和截止日期即可。' },
  { q: '如何设置习惯提醒？', a: '在「我的 → 通知设置」中开启「习惯提醒」开关，具体提醒时间在创建习惯时设置。' },
  { q: '如何多账户记账？', a: '在「记录」页点击「新建账户」可添加多个账户类型（储蓄/信用卡/花呗/微信零钱）。' },
  { q: '数据同步失败怎么办？', a: '前往「我的 → 同步状态」点击「立即同步」重试。' },
]

const activeFaq = ref<string>('')

/**
 * 经期记录 · 操作指引（04 §7.6）
 *
 * ⚠️ 文案与桌面端 help 页**逐字一致**，改一处必须同改另一处。
 * 引导入口（D13）在这里说明「重新设置」可再次打开向导，与设置页的按钮呼应。
 */
const PERIOD_GUIDE: Array<{ title: string; body: string }> = [
  {
    title: '怎么记一天？',
    body: '在「记录 → 经期」点月历上的任意日期，或点右下角 +，横滑 9 页卡片填完点「完成」。',
  },
  {
    title: '只想记「今天有没有出血」？',
    body: '用月历上方的「今天」快捷条，点一下经量就记好了。',
  },
  {
    title: '记错了怎么办？',
    body: '再点那一天，改成正确的值；把某一页全部清空后点「完成」，会问你要不要清除这一天的记录。',
  },
  {
    title: '为什么预测不准？',
    body: '预测基于你自己记录的日期：只有约 13% 的人周期正好 28 天，日历法对排卵日的准确率约 21%。记录 2–3 个周期后会明显变准，记基础体温更准。',
  },
  {
    title: '不想让别人看到结论？',
    body: '概览卡右上角点眼睛图标，敏感内容会变成掩码，但记录功能照常用。',
  },
]

const TYPE_OPTIONS: Array<{ value: FeedbackType; label: string; icon: IconName }> = [
  { value: 'bug', label: 'Bug 反馈', icon: 'AlertTriangle' },
  { value: 'suggestion', label: '功能建议', icon: 'Lightbulb' },
  { value: 'other', label: '其他', icon: 'MessageCircle' },
]

const form = reactive<{ type: FeedbackType; content: string; contact: string }>({
  type: 'bug',
  content: '',
  contact: '',
})

const submitting = ref(false)
const contentError = computed(() => {
  const len = form.content.trim().length
  if (len === 0) return ''
  if (len > 2000) return '反馈内容最多 2000 字'
  return ''
})

async function onSubmit(): Promise<void> {
  const content = form.content.trim()
  if (!content) {
    showFailToast('请填写反馈内容')
    return
  }
  if (content.length > 2000) {
    showFailToast('反馈内容最多 2000 字')
    return
  }
  const contact = form.contact.trim()
  if (contact.length > 100) {
    showFailToast('联系方式最多 100 字')
    return
  }

  submitting.value = true
  try {
    await feedbackApi.create({
      type: form.type,
      content,
      contact: contact || undefined,
    })
    // spec-20260922-v2 · 05 §2.2 R2 保留：反馈提交后转入后台处理，结果不可见
    showSuccessToast('反馈已提交，感谢您的支持！')
    form.content = ''
    form.contact = ''
  } catch {
    showFailToast('提交失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="router.back()">‹</button>
      <h2 class="sub-title">帮助与反馈</h2>
    </header>

    <main class="sub-body">
      <!-- 常见问题 -->
      <section class="card">
        <h3 class="card-title">常见问题</h3>
        <van-collapse v-model="activeFaq">
          <van-collapse-item
            v-for="item in FAQ"
            :key="item.q"
            :name="item.q"
            :title="item.q"
          >
            <p class="faq-answer">{{ item.a }}</p>
          </van-collapse-item>
        </van-collapse>
      </section>

      <!-- 经期记录 · 操作指引（静态展开面板，文案与桌面端逐字一致） -->
      <section class="card">
        <h3 class="card-title">经期记录 · 操作指引</h3>
        <div v-for="(g, i) in PERIOD_GUIDE" :key="g.title" class="guide-item">
          <span class="guide-index">{{ i + 1 }}</span>
          <div class="guide-body">
            <p class="guide-title">{{ g.title }}</p>
            <p class="guide-text">{{ g.body }}</p>
          </div>
        </div>
        <p class="field-hint">
          想重新填写周期参数？到「我的 → 经期设置」点「重新运行设置向导」即可。
        </p>
      </section>

      <!-- 提交反馈 -->
      <section class="card">
        <h3 class="card-title">提交反馈</h3>

        <div class="field">
          <span class="field-label">反馈类型</span>
          <div class="type-row">
            <button
              v-for="t in TYPE_OPTIONS"
              :key="t.value"
              type="button"
              class="type-chip"
              :class="{ active: form.type === t.value }"
              :disabled="submitting"
              @click="form.type = t.value"
            >
              <Icon :name="t.icon" :size="14" class="type-emoji" />
              {{ t.label }}
            </button>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="fb-content">反馈内容</label>
          <van-field
            id="fb-content"
            v-model="form.content"
            type="textarea"
            rows="4"
            autosize
            maxlength="2000"
            show-word-limit
            placeholder="请详细描述遇到的问题或建议…"
            :border="false"
            class="field-input area"
            :disabled="submitting"
          />
          <p v-if="contentError" class="field-error">{{ contentError }}</p>
        </div>

        <div class="field">
          <label class="field-label" for="fb-contact">联系方式（可选）</label>
          <van-field
            id="fb-contact"
            v-model="form.contact"
            placeholder="邮箱或微信号"
            maxlength="100"
            clearable
            :border="false"
            class="field-input"
            :disabled="submitting"
          />
        </div>

        <button class="btn btn-primary" type="button" :disabled="submitting" @click="onSubmit">
          {{ submitting ? '提交中…' : '提交反馈' }}
        </button>
      </section>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.faq-answer {
  margin: 0;
  font-size: var(--fs-caption-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

/* ==================== 经期操作指引 ==================== */
.guide-item {
  display: flex;
  gap: 10px;
  padding: 10px 0;

  & + .guide-item { border-top: 1px solid var(--color-border-light); }
}
.guide-index {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--fs-micro);
  font-weight: 700;
  font-family: var(--font-num);
  line-height: 1;
}
.guide-body {
  flex: 1;
  min-width: 0;
}
.guide-title {
  margin: 0 0 3px;
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--color-text-primary);
}
.guide-text {
  margin: 0;
  font-size: var(--fs-caption-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.type-row {
  display: flex;
  gap: 8px;
}
.type-chip {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 38px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  transition: all var(--duration-fast) var(--ease-default);

  &.active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    color: var(--color-primary);
    font-weight: 600;
  }
  &:active:not(:disabled) { transform: scale(0.97); }
  &:disabled { opacity: 0.6; }
}
.type-emoji { :deep(svg) { display: block; } }

.field-input {
  padding: 0;
  background: transparent;

  :deep(.van-field__control) {
    padding: 10px 12px;
    font-size: var(--fs-body-sm);
    background: var(--color-bg-hover);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);

    &::placeholder { color: var(--color-text-placeholder); }
  }
  :deep(.van-field__word-limit) {
    color: var(--color-text-tertiary);
    font-size: var(--fs-micro);
  }
}
.area :deep(.van-field__control) {
  min-height: 88px;
  line-height: 1.5;
}
</style>
