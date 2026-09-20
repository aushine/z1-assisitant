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
 * 把后端返回的文件地址换算成浏览器可加载的完整 URL。
 * - http(s):// 与 data: → 原样（历史值/外链兼容）
 * - /z1/uploads/...（第十三轮起本服务受管路径；历史值 /uploads/... 同规则）
 *   及其他 / 开头路径 → 拼 API origin：
 *   VITE_API_BASE 为相对（dev 走 vite proxy /z1）时得当前站点 origin；
 *   VITE_API_BASE 为绝对地址（独立部署前端）时直达后端域名。
 */
export function resolveFileUrl(src?: string | null): string | undefined {
  if (!src) return undefined
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  if (src.startsWith('/')) {
    const base = import.meta.env.VITE_API_BASE || '/z1/api/v1'
    try {
      return new URL(src, new URL(base, location.href).origin).href
    } catch {
      return src
    }
  }
  return src
}
