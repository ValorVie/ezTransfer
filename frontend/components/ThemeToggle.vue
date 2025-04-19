<template>
  <div class="theme-toggle">
    <button 
      class="btn btn-sm"
      :class="themeStore.isDark ? 'btn-outline-light' : 'btn-outline-dark'"
      @click="toggleDropdown"
      aria-label="切換主題"
    >
      <i class="bi" :class="themeStore.isDark ? 'bi-moon' : 'bi-sun'"></i>
      <span class="ms-1 d-none d-md-inline">{{ themeStore.isDark ? '深色模式' : '亮色模式' }}</span>
    </button>
    
    <!-- 主題選擇下拉選單 -->
    <div class="theme-select mt-2" v-if="showDropdown">
      <div class="form-check mb-2">
        <input 
          class="form-check-input" 
          type="radio" 
          name="themeOption" 
          id="themeLight" 
          value="light" 
          :checked="themeStore.theme === 'light'"
          @change="themeStore.setTheme('light')"
        >
        <label class="form-check-label" for="themeLight">
          <i class="bi bi-sun me-1"></i> 亮色模式
        </label>
      </div>
      <div class="form-check mb-2">
        <input 
          class="form-check-input" 
          type="radio" 
          name="themeOption" 
          id="themeDark" 
          value="dark" 
          :checked="themeStore.theme === 'dark'"
          @change="themeStore.setTheme('dark')"
        >
        <label class="form-check-label" for="themeDark">
          <i class="bi bi-moon me-1"></i> 深色模式
        </label>
      </div>
      <div class="form-check">
        <input 
          class="form-check-input" 
          type="radio" 
          name="themeOption" 
          id="themeAuto" 
          value="auto" 
          :checked="themeStore.theme === 'auto'"
          @change="themeStore.setTheme('auto')"
        >
        <label class="form-check-label" for="themeAuto">
          <i class="bi bi-circle-half me-1"></i> 自動 (依系統設定)
        </label>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'; // 修正: 添加 onUnmounted
import { useThemeStore } from '~/stores/theme';

const themeStore = useThemeStore();
const showDropdown = ref(false);

// 組件掛載時初始化主題
onMounted(() => {
  themeStore.initialize();
  document.addEventListener('click', handleClickOutside);
});

// 組件卸載時移除事件監聽
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

// 切換顯示下拉選單
const toggleDropdown = () => {
  showDropdown.value = !showDropdown.value;
};

// 點擊其他地方時關閉下拉選單
const handleClickOutside = (event) => {
  if (showDropdown.value && !event.target.closest('.theme-toggle')) {
    showDropdown.value = false;
  }
};
</script>

<style scoped>
.theme-toggle {
  position: relative;
}

.theme-select {
  position: absolute;
  right: 0;
  top: 100%;
  width: 200px;
  background-color: var(--card-background);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  padding: 0.75rem;
  z-index: 1000;
  box-shadow: 0 0.5rem 1rem var(--shadow);
}

.theme-select .form-check-label {
  color: var(--text-color);
  cursor: pointer;
}
</style>