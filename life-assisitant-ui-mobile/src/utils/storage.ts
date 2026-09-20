/**
 * localStorage 封装
 * - 统一异常处理：localStorage 不可用（隐私模式 / 满）时静默失败
 * - 统一 JSON 序列化
 */

export const storage = {
  /**
   * 读取
   * @param key 键
   * @returns 字符串（无值或异常返回空串）
   */
  get(key: string): string {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  },

  /**
   * 写入
   * @param key 键
   * @param value 值
   */
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* 静默失败 */
    }
  },

  /**
   * 删除
   * @param key 键
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      /* 静默失败 */
    }
  },

  /**
   * 清空（危险：会清掉所有同源 localStorage）
   */
  clear(): void {
    try {
      localStorage.clear()
    } catch {
      /* 静默失败 */
    }
  },

  /**
   * 读取 JSON 对象
   * @param key 键
   * @param fallback 解析失败或无值时的默认
   */
  getJSON<T>(key: string, fallback: T): T {
    const raw = storage.get(key)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },

  /**
   * 写入 JSON 对象
   */
  setJSON<T>(key: string, value: T): void {
    try {
      storage.set(key, JSON.stringify(value))
    } catch {
      /* 静默失败 */
    }
  },
}
