/**
 * 外链工具（spec-20261001-v2）
 *
 * 「性价比人生指南」（htlb · How To Live Better）静态页与主站同源，部署在 `/htlb/` 路径下。
 * ⚠️ 地址必须**运行时**计算（location.protocol + location.host），不能构建期写死：
 *    同一份产物要同时服务域名（voz21.cn）/ 公网 IP / 内网 IP 等多种入口，
 *    且 location.host 天然含端口（如 :8443），协议跟随当前页面（http/https）。
 */

/** 「性价比人生指南」外链完整 URL（当前协议 + 当前 host + 固定路径） */
export function htlbUrl(): string {
  return `${location.protocol}//${location.host}/htlb/HowToLiveBetter.html`
}
