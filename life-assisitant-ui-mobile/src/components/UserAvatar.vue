<script setup lang="ts">
/**
 * UserAvatar —— 用户头像（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/UserAvatar.tsx
 *
 * 与桌面端一致的行为：
 *   - 有 avatar 且能加载 → 显示图片；加载失败 → 回退首字母（不显示破图）
 *   - 无 avatar → 直接显示昵称首字母
 *
 * 差异：桌面端 avatar 存的是 `/uploads/...` 相对路径，必须经 resolveFileUrl
 * 拼上 API origin 才能加载 —— 移动端 dev 走 vite proxy，同样需要这一步；
 * 这里内置处理，调用方只管传原始值。
 */
import { computed, ref, watch } from 'vue'
import { displayNameOf, initialOf, resolveFileUrl } from '@/utils/avatar'

const props = withDefaults(
  defineProps<{
    user?: { name?: string; username?: string; avatar?: string } | null
    /** 直径（px） */
    size?: number
    /** 是否可点击（外层用 @click 时把鼠标指针带出来） */
    clickable?: boolean
  }>(),
  {
    user: null,
    size: 56,
    clickable: false,
  }
)

const broken = ref(false)

const src = computed(() => resolveFileUrl(props.user?.avatar))
const initial = computed(() => initialOf(props.user))
const name = computed(() => displayNameOf(props.user))

/** 头像地址变化（如刚上传完）时重置失败标记，否则新图也会被当成破图 */
watch(src, () => {
  broken.value = false
})

const showImage = computed(() => !!src.value && !broken.value)
</script>

<template>
  <div
    class="user-avatar"
    :class="{ clickable }"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` }"
    :title="name"
  >
    <img
      v-if="showImage"
      class="avatar-img"
      :src="src"
      :alt="name"
      @error="broken = true"
    />
    <span v-else class="avatar-initial">{{ initial }}</span>
  </div>
</template>

<style lang="scss" scoped>
.user-avatar {
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--color-primary);
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  overflow: hidden;
  line-height: 1;
  user-select: none;

  &.clickable { cursor: pointer; }
}
.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-initial { line-height: 1; }
</style>
