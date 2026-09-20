import { create } from 'zustand'
import { storage } from '@/utils/storage'

type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void
}

function applyTheme(t: ThemeMode) {
  const resolved = t === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : t
  document.documentElement.dataset.theme = resolved
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: (storage.get('theme') as ThemeMode) || 'light',
  setTheme: (t) => {
    storage.set('theme', t)
    applyTheme(t)
    set({ theme: t })
  },
}))

// Apply on load
applyTheme(useThemeStore.getState().theme)
