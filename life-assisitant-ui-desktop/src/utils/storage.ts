/**
 * localStorage 封装
 * 统一处理 JSON 序列化 / 解析失败 / 异常
 */

export const storage = {
  get<T>(key: string, fallback: T | null = null): T | null {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },

  getString(key: string, fallback = ''): string {
    try {
      return localStorage.getItem(key) ?? fallback
    } catch {
      return fallback
    }
  },

  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[storage.set] failed', key, err)
    }
  },

  setString(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[storage.setString] failed', key, err)
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  },

  clear(keys?: string[]): void {
    if (keys && keys.length) {
      keys.forEach((k) => storage.remove(k))
      return
    }
    try {
      localStorage.clear()
    } catch {
      // ignore
    }
  },
}

export default storage
