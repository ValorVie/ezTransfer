<template>
  <div class="app-container">
    <nav class="navbar navbar-expand-lg" :class="themeStore.isDark ? 'navbar-dark bg-dark' : 'navbar-light bg-primary'">
      <div class="container">
        <NuxtLink to="/" class="navbar-brand d-flex align-items-center">
          <img src="/logo.svg" alt="ezTransfer Logo" class="me-2" height="30" />
          <span>ezTransfer</span>
        </NuxtLink>
        
        <!-- 主題切換按鈕 -->
        <div class="ms-auto">
          <ThemeToggle />
        </div>
      </div>
    </nav>
    
    <main class="container py-4">
      <NuxtPage />
    </main>
    
    <footer class="footer mt-auto py-3" :class="themeStore.isDark ? 'bg-dark text-light' : 'bg-light text-muted'">
      <div class="container text-center">
        <span>© {{ new Date().getFullYear() }} ezTransfer - 安全的點對點檔案傳輸</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { useThemeStore } from '~/stores/theme';
import ThemeToggle from '~/components/ThemeToggle.vue';

const themeStore = useThemeStore();
</script>

<style>
html, body {
  height: 100%;
}

.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

main {
  flex: 1;
}

/* 深色模式下的導航欄調整 */
.dark-mode .navbar.bg-dark {
  background-color: #1a1a1a !important;
}

/* 深色模式下的頁尾調整 */
.dark-mode .footer.bg-dark {
  background-color: #1a1a1a !important;
}
</style>