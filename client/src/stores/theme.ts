import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// 应用主题到 DOM
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  
  if (theme === 'system') {
    // 移除手动设置的主题类，让 CSS media query 生效
    root.classList.remove('light', 'dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }
}


export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark', // 默认深色主题
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'theme-storage',
      onRehydrateStorage: () => (state) => {
        // 初始化时应用存储的主题
        if (state) {
          applyTheme(state.theme);
        }
      },
    }
  )
);

// 初始化主题（在应用启动时调用）
export function initTheme() {
  const theme = useThemeStore.getState().theme;
  applyTheme(theme);
  
  // 监听系统主题变化
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    mediaQuery.addEventListener('change', () => {
      const currentTheme = useThemeStore.getState().theme;
      if (currentTheme === 'system') {
        // 系统主题模式下，自动跟随
        applyTheme('system');
      }
    });
  }
}
