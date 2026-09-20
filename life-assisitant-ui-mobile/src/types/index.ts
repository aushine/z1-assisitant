/**
 * 全局通用类型（与 src/api/types.ts 互补）
 * api/types.ts 放业务相关类型（如 User/Role）
 * 此处放基础类型（无业务依赖）
 */

/** ID 类型（统一为 string） */
export type ID = string

/** ISO 8601 时间字符串 */
export type ISODateString = string

/** 可空 */
export type Nullable<T> = T | null

/** 分页查询参数 */
export interface PageQuery {
  page?: number
  page_size?: number
  sort?: string
  fields?: string
}

/** HTTP 方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** 通用键值对（用于 preferences 等） */
export type KV = Record<string, unknown>
