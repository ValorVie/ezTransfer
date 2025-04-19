<template>
  <div class="home-page">
    <div class="text-center mb-5">
      <img src="/logo.svg" alt="ezTransfer Logo" class="mb-4" width="150" />
      <h1 class="display-4 fw-bold">ezTransfer</h1>
      <p class="lead">點對點加密檔案傳輸，無需註冊，無需安裝，只需瀏覽器即可</p>
    </div>

    <div class="row justify-content-center g-4">
      <div class="col-md-6 col-lg-5">
        <div class="card home-card shadow-sm" @click="navigateTo('/receive')">
          <div class="card-body text-center p-5">
            <i class="bi bi-download home-icon text-primary"></i>
            <h2 class="card-title">接收檔案</h2>
            <p class="card-text">獲取一個連接代碼，分享給對方來接收檔案</p>
            <button class="btn btn-primary mt-3">
              <i class="bi bi-download me-2"></i>開始接收
            </button>
          </div>
        </div>
      </div>
      
      <div class="col-md-6 col-lg-5">
        <div class="card home-card shadow-sm" @click="navigateTo('/send')">
          <div class="card-body text-center p-5">
            <i class="bi bi-upload home-icon text-primary"></i>
            <h2 class="card-title">傳送檔案</h2>
            <p class="card-text">輸入連接代碼，開始傳輸檔案給對方</p>
            <button class="btn btn-primary mt-3">
              <i class="bi bi-upload me-2"></i>開始傳送
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="row mt-5">
      <div class="col-12">
        <div class="card border-0 theme-bg-light">
          <div class="card-body">
            <h3 class="card-title text-center mb-4">如何運作</h3>
            <div class="row g-4">
              <div class="col-md-4">
                <div class="text-center">
                  <div class="rounded-circle bg-primary text-white d-inline-flex align-items-center justify-content-center mb-3" style="width: 60px; height: 60px;">
                    <h3 class="m-0">1</h3>
                  </div>
                  <h4>接收者獲取代碼</h4>
                  <p>接收者點擊「接收檔案」獲取一個6位數代碼</p>
                </div>
              </div>
              <div class="col-md-4">
                <div class="text-center">
                  <div class="rounded-circle bg-primary text-white d-inline-flex align-items-center justify-content-center mb-3" style="width: 60px; height: 60px;">
                    <h3 class="m-0">2</h3>
                  </div>
                  <h4>發送者輸入代碼</h4>
                  <p>發送者在「傳送檔案」頁面輸入代碼建立連接</p>
                </div>
              </div>
              <div class="col-md-4">
                <div class="text-center">
                  <div class="rounded-circle bg-primary text-white d-inline-flex align-items-center justify-content-center mb-3" style="width: 60px; height: 60px;">
                    <h3 class="m-0">3</h3>
                  </div>
                  <h4>點對點安全傳輸</h4>
                  <p>通過加密的點對點連接，檔案直接傳輸，不經過伺服器</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="row mt-5">
      <div class="col-12">
        <div class="card border-0">
          <div class="card-body">
            <h3 class="card-title text-center mb-4">為何選擇 ezTransfer？</h3>
            <div class="row g-4">
              <div class="col-md-4">
                <div class="d-flex">
                  <i class="bi bi-shield-lock text-primary me-3" style="font-size: 2rem;"></i>
                  <div>
                    <h5>安全加密</h5>
                    <p>所有傳輸內容均使用端對端加密，確保您的檔案安全</p>
                  </div>
                </div>
              </div>
              <div class="col-md-4">
                <div class="d-flex">
                  <i class="bi bi-speedometer2 text-primary me-3" style="font-size: 2rem;"></i>
                  <div>
                    <h5>快速傳輸</h5>
                    <p>點對點直接連接，最大化傳輸速度，無中間伺服器延遲</p>
                  </div>
                </div>
              </div>
              <div class="col-md-4">
                <div class="d-flex">
                  <i class="bi bi-infinity text-primary me-3" style="font-size: 2rem;"></i>
                  <div>
                    <h5>無檔案大小限制</h5>
                    <p>傳輸大小僅受您的設備和網路條件限制</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 首頁組件邏輯
import { useThemeStore } from '~/stores/theme';

// 獲取主題狀態，用於主題感知型UI
const themeStore = useThemeStore();
</script>

<style scoped>
.home-page {
  animation: fadeIn 0.6s ease-in-out;
}

/* 輕量的主題適配背景 */
.theme-bg-light {
  background-color: var(--background-color);
  transition: background-color 0.3s ease;
}

/* 主題適配卡片樣式 */
.card {
  transition: all 0.3s ease;
}

.card-title, .card-text {
  color: var(--text-color);
  transition: color 0.3s ease;
}

/* 適配按鈕樣式 */
button.btn-primary {
  background-color: var(--primary-color);
  border-color: var(--primary-color);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

button.btn-primary:hover {
  background-color: var(--primary-hover);
  border-color: var(--primary-hover);
}

/* 圖標顏色適配 */
.text-primary {
  color: var(--primary-color) !important;
}

/* 深色模式下的圓形背景 */
.dark-mode .rounded-circle.bg-primary {
  background-color: var(--primary-color) !important;
}
</style>