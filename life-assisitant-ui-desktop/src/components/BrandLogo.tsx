/**
 * BrandLogo —— 账户图标三态渲染器（spec-20260922-v1 · 01 §4 / 02 §5~6，P5）
 *
 * 渲染链路（02 §5.2）：
 *   `brand:<slug>` → 本地品牌图片（/bank-logos|brand-logos/<slug>.<ext>）
 *                     └ 加载失败 → 文字徽标兜底（绝不裂图，02 §5.3）
 *   `lucide:<Name>` → <Icon>（现有图标组件通道）
 *   其他 / emoji    → resolveAccountIcon（现有 emoji 反查逻辑）
 *   空              → 文字徽标
 *
 * 规则：
 * - SHOW_BANK_LOGOS=false → brand: 全部降级文字徽标，布局不塌（同尺寸盒子）
 * - onError 只降级一次，不循环重试；slug 变化时重置
 * - 彩色 logo 白色托底（暗色主题下彩色透明底 logo 不可见的兜底，01 §4）
 * - 路径必须拼 import.meta.env.BASE_URL（两端 base 不同，02 §5.4）
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon, TINT_VARS, strokeWidthForSize } from '@/components/icon'
import { resolveAccountIcon } from '@/utils/category-dict'
import { SHOW_BANK_LOGOS } from '@/constants/account'

/** brand-logos/ 目录下的 slug（其余 brand: 一律按 bank-logos/ 处理） */
const BRAND_DIR_SLUGS = new Set([
  'alipay', 'baitiao', 'huabei', 'jiebei', 'jingdong',
  'meituan', 'weixin', 'yuebao', 'unionpay',
])
/** brand-logos/ 下仅有的 2 个 SVG（其余全 PNG；bank-logos/ 153 个全 PNG，实测 Glob） */
const SVG_SLUGS = new Set(['visa', 'mastercard'])

/** 中性灰文字徽标底色（B3：注册表暂无品牌色字段，统一中性灰） */
const NEUTRAL_BADGE_BG = '#8A8A8A'

/** `brand:<slug>` → 静态资源 URL；非 brand: 返回 null */
export function brandLogoSrc(iconRef: string): string | null {
  if (!iconRef.startsWith('brand:')) return null
  const slug = iconRef.slice('brand:'.length)
  if (!slug) return null
  const ext = SVG_SLUGS.has(slug) ? 'svg' : 'png'
  const dir = BRAND_DIR_SLUGS.has(slug) ? 'brand-logos' : 'bank-logos'
  return `${import.meta.env.BASE_URL}${dir}/${slug}.${ext}`
}

export interface BrandLogoProps {
  /** 图标引用原文：`brand:<slug>` | `lucide:<Name>` | emoji | 空 */
  icon: string
  /** 尺寸（px），默认 20 */
  size?: number
  /** 文字徽标文字（传 bank.short[0] 或账户名首字；取首字渲染） */
  fallbackText?: string
  /** 文字徽标底色（传 bank.color；缺省中性灰） */
  fallbackColor?: string
  className?: string
  style?: CSSProperties
}

export default function BrandLogo({
  icon,
  size = 20,
  fallbackText,
  fallbackColor,
  className,
  style,
}: BrandLogoProps) {
  const [failed, setFailed] = useState(false)

  // slug 变化时重置失败态（同一组件实例先后渲染不同品牌时允许重新加载一次）
  const src = brandLogoSrc(icon)
  useEffect(() => {
    setFailed(false)
  }, [src])

  const badgeStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(4, Math.round(size * 0.22)),
    background: fallbackColor || NEUTRAL_BADGE_BG,
    color: '#FFF',
    fontSize: Math.round(size * 0.48),
    fontWeight: 600,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    userSelect: 'none',
  }

  /** 文字徽标兜底（02 §6：简称首字 + 品牌色/中性灰，白字） */
  function Badge() {
    const text = fallbackText?.trim()?.[0] || '·'
    return (
      <div className={className} style={{ ...badgeStyle, ...style }} aria-label={fallbackText || '图标'}>
        {text}
      </div>
    )
  }

  // ① brand: 品牌资源（SHOW_BANK_LOGOS=false 时全部降级，布局同尺寸不塌）
  if (src) {
    if (!SHOW_BANK_LOGOS || failed) return <Badge />
    // 白色托底：彩色透明底 PNG 在暗色主题下需要白底才可辨认（01 §4）
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          background: '#FFF',
          borderRadius: Math.max(4, Math.round(size * 0.22)),
          overflow: 'hidden',
          flexShrink: 0,
          ...style,
        }}
      >
        <img
          src={src}
          width={size}
          height={size}
          alt=""
          loading="lazy"
          draggable={false}
          style={{ display: 'block', objectFit: 'contain' }}
          onError={() => setFailed(true)}
        />
      </span>
    )
  }

  // ② lucide: 通用图标（走现有 <Icon> 通道，注册表外名字由 Icon 自行降级）
  if (icon.startsWith('lucide:')) {
    const name = icon.slice('lucide:'.length)
    return (
      <span className={className} style={{ display: 'inline-flex', flexShrink: 0, ...style }}>
        <Icon name={name as never} size={size} />
      </span>
    )
  }

  // ③ emoji / 存量字符串 → 现有 resolveAccountIcon 反查（lucide + 语义色）
  if (icon) {
    const resolved = resolveAccountIcon(icon)
    const Cmp = resolved.icon
    return (
      <span className={className} style={{ display: 'inline-flex', flexShrink: 0, ...style }}>
        <Cmp size={size} strokeWidth={strokeWidthForSize(size)} style={{ color: TINT_VARS[resolved.tint].fg }} />
      </span>
    )
  }

  // ④ 空 → 文字徽标
  return <Badge />
}
