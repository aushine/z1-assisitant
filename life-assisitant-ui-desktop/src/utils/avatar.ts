/**
 * 头像工具（D-03 第八轮：base64 入库方案废弃，改为真文件上传）
 *
 * 流程：选图 → 居中裁方 → 256px JPEG File → POST /users/me/avatar（multipart）
 *      → 后端落盘 <storage.upload_dir>/avatars/ → DB 只存 /uploads/avatars/<name>。
 * base64 data URL 曾直接塞进 users.avatar 撞 varchar(500) 1406，现仅兼容历史外链。
 */

/**
 * 压缩为 256px 方形 JPEG File（extra-large 展示位 64px 的 4 倍图，Retina 也够锐利）。
 * 落盘走文件接口，不再受 DB 列宽约束；256px q0.82 约 10-25KB。
 */
export function compressAvatar(file: File, size = 256): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('当前环境不支持图片处理')); return }
      ctx.drawImage(
        img,
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, size, size,
      )
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('图片压缩失败')); return }
          resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
        },
        'image/jpeg',
        0.82,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')) }
    img.src = url
  })
}

/**
 * 上传文件对外基址（后端 storage.public_url 下发，见 App.UploadsBase）。
 * '' = 未配置或探活失败 → 回落「当前连接的后端」（同源 /z1/uploads 静态映射）。
 * 启动时 initUploadsBase() 异步填充，resolveFileUrl 同步读取。
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/utils/avatar.ts（两端逻辑一致）
 */
let uploadsBase = ''

/**
 * 启动时探测上传文件对外基址（入口处 await，最多 ~4s）。
 * ① GET <api>/app/uploads-base 拿 storage.public_url；空 → 保持 ''；
 * ② 非空再探活 <base>/z1/api/v1/health，不通 → 也回落 ''。
 * 任何一步失败都静默回落，绝不阻塞/影响启动。
 */
export async function initUploadsBase(): Promise<void> {
  try {
    const base = import.meta.env.VITE_API_BASE || '/z1/api/v1'
    const api = new URL(base, location.href)
    const url =
      api.origin + api.pathname.replace(/\/+$/, '') + '/app/uploads-base'
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return
    const body = await res.json()
    const u = String(body?.data?.uploads_base_url || '').trim().replace(/\/+$/, '')
    if (!u) return
    const probe = await fetch(u + '/z1/api/v1/health', {
      signal: AbortSignal.timeout(2000),
    })
    if (probe.ok) uploadsBase = u
  } catch {
    /* 探测失败保持 ''：走当前连接的后端 */
  }
}

/**
 * 把后端返回的文件地址换算成浏览器可加载的完整 URL。
 * - http(s):// 与 data: → 原样（历史值/外链兼容）
 * - /z1/uploads/...（第十三轮起本服务受管路径；历史值 /uploads/... 同规则）
 *   及其他 / 开头路径：
 *   ① 后端配了 storage.public_url 且探活通过 → 拼「配置基址」的绝对 URL
 *     （本地后端连线上同库时，文件字节只在部署机上，同源取会 404）；
 *   ② 未配置/不通 → 拼 API origin：
 *     VITE_API_BASE 为相对（dev 走 vite proxy /z1）时得当前站点 origin；
 *     VITE_API_BASE 为绝对地址（独立部署前端）时直达后端域名。
 */
export function resolveFileUrl(src?: string | null): string | undefined {
  if (!src) return undefined
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  if (src.startsWith('/')) {
    if (uploadsBase) return uploadsBase + src
    const base = import.meta.env.VITE_API_BASE || '/z1/api/v1'
    try {
      return new URL(src, new URL(base, location.href).origin).href
    } catch {
      return src
    }
  }
  return src
}
