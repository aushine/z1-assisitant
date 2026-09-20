/**
 * Global types
 */

export type LoadState = 'idle' | 'loading' | 'success' | 'error'

export type Nullable<T> = T | null

export type Dict<T = unknown> = Record<string, T>
