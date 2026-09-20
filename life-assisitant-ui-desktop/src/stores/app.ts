import { create } from 'zustand'
import { storage } from '@/utils/storage'

const SIDEBAR_KEY = 'app_sidebar_collapsed'

interface AppStore {
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
  toggleSidebar: () => void
  setTheme: (t: 'light' | 'dark') => void
}

export const useAppStore = create<AppStore>((set) => ({
  sidebarCollapsed: storage.get<boolean>(SIDEBAR_KEY) ?? false,
  theme: 'light',

  toggleSidebar() {
    set((s) => {
      const next = !s.sidebarCollapsed
      storage.set(SIDEBAR_KEY, next)
      return { sidebarCollapsed: next }
    })
  },

  setTheme(t) {
    set({ theme: t })
    document.documentElement.dataset.theme = t
  },
}))
