// https://nuxt.com/docs/api/configuration/nuxt-config
import removeConsole from 'vite-plugin-remove-console'
import { resolve } from 'path';

export default defineNuxtConfig({
  devtools: { enabled: true },
  ssr: false,
  modules: [
    '@pinia/nuxt',
  ],
  // Vite 配置
  vite: {
    server: {
      host: true,
      allowedHosts: true, // 允許所有主機訪問
      hmr: true  // ⛔ 關閉熱重載
    },
    // 移除了特定的打包配置
    plugins: process.env.NODE_ENV === 'production'
      ? [removeConsole({ exclude: ['error', 'warn'] })]
      : []
  },
  app: {
    head: {
      title: 'ezTransfer - P2P 檔案傳輸',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: '一個基於 WebRTC 的點對點檔案傳輸 Web 應用程式，無需註冊，無需安裝，只需瀏覽器即可在設備之間安全地傳輸檔案。' }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
      ],
      // 添加預先加載深色模式檢測的腳本，避免閃爍
      script: [
        {
          innerHTML: `
            (function() {
              try {
                const theme = localStorage.getItem('theme');
                const isDark = theme === 'dark' ||
                  (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                if (isDark) {
                  document.documentElement.classList.add('dark-mode');
                } else {
                  document.documentElement.classList.add('light-mode');
                }
              } catch (e) {}
            })();
          `,
          type: 'text/javascript'
        }
      ]
    },
    baseURL: '/', // 確保正確的基本URL
    buildAssetsDir: '/assets/' // 指定資產目錄
  },
  runtimeConfig: {
    public: {
      signalingUrl:  'ws://localhost:8000/ws',
      wssKey: 'default-key',
      wsTokenEndpoint: '/api/get-ws-token',
      stunUri: 'stun:stun.l.google.com:19302',
      turnUri: '',
      turnUsername: '',
      turnPassword: '',
      turnProto: 'tcp',
      devMode: 'true',
      chunkSize: '16384',
      connectionTimeout: '10000'
    }
  },
  // 設置 Nuxt 的伺服器配置
  server: {
    port: 3000,
    host: '0.0.0.0', // 允許所有 IP 訪問
  },
  css: [
    'bootstrap/dist/css/bootstrap.min.css', 
    'bootstrap-icons/font/bootstrap-icons.css', 
    '~/assets/css/main.css',
    '~/assets/css/theme.css' // 添加主題 CSS
  ],
  build: {
    transpile: []
  },
  // 配置靜態文件和處理
  nitro: {
    publicAssets: [
      {
        baseURL: '/',
        dir: 'public',
        maxAge: 60 * 60 * 24 * 365 // 1 年緩存
      }
    ]
  }
})