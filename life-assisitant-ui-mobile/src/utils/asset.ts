/**
 * 公共资源 URL 前缀：跟随构建 base。
 * - dev（vite 默认 base '/'）→ '/'
 * - 子路径部署（vite build --base=/z1-app/）→ '/z1-app/'
 * 用途：public/ 下资源（z1-logo.png 等）在模板里写死绝对路径 /xxx
 * 构建时不会被 base 改写，必须用本前缀拼接。
 */
export const assetBase: string = import.meta.env.BASE_URL
