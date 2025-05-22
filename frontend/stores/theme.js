import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useRuntimeConfig } from '#imports';

export const useThemeStore = defineStore('theme', () => {
  // 主題狀態: 'light', 'dark', 'auto'
  const theme = ref(
    process.client ? localStorage.getItem('theme') || 'auto' : 'auto'
  );
  
  // 是否為黑暗模式
  const isDark = ref(false);
  
  // 系統偏好是否為黑暗模式
  const systemPrefersDark = ref(false);
  
  // 初始化
  const initialize = () => {
    if (!process.client) return;
    
    // 檢測系統主題偏好
    if (window.matchMedia) {
      // 獲取系統偏好
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      systemPrefersDark.value = prefersDark;
      
      // 監聽系統偏好變化
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        systemPrefersDark.value = e.matches;
        applyTheme();
      });
    }
    
    // 應用主題
    applyTheme();
  };
  
  // 應用主題
  const applyTheme = () => {
    if (!process.client) return;
    
    let darkMode = false;
    
    // 根據設定值決定是否使用深色模式
    if (theme.value === 'auto') {
      darkMode = systemPrefersDark.value;
    } else {
      darkMode = theme.value === 'dark';
    }
    
    // 更新狀態
    isDark.value = darkMode;
    
    // 應用深色/亮色類別到 HTML 元素
    if (darkMode) {
      document.documentElement.classList.add('dark-mode');
      document.documentElement.classList.remove('light-mode');
    } else {
      document.documentElement.classList.add('light-mode');
      document.documentElement.classList.remove('dark-mode');
    }
  };
  
  // 設置主題
  const setTheme = (newTheme) => {
    if (['light', 'dark', 'auto'].includes(newTheme)) {
      theme.value = newTheme;
      
      // 保存至本地存儲
      if (process.client) {
        localStorage.setItem('theme', newTheme);
      }
      
      // 應用新主題
      applyTheme();
    }
  };
  
  // 切換主題
  const toggleTheme = () => {
    const next = isDark.value ? 'light' : 'dark';
    setTheme(next);
  };
  
  // 監聽主題變化
  watch(theme, () => {
    applyTheme();
  });
  
  // 返回公開方法和屬性
  return {
    theme,
    isDark,
    systemPrefersDark,
    initialize,
    setTheme,
    toggleTheme
  };
});