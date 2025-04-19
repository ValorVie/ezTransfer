import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import { useRuntimeConfig } from '#imports';
import { SignalingClient } from '~/lib/signaling';
import { WebRTCManager } from '~/lib/webrtc';

export const useConnectionStore = defineStore('connection', () => {
  // 狀態
  const status = ref('disconnected'); // disconnected, connecting, awaiting_connection, connected, reconnecting, error
  const isLoading = ref(false);
  const connectionCode = ref('');
  const errorMessage = ref('');
  const role = ref(''); // sender 或 receiver
  const isReconnecting = ref(false); // 是否正在重連中
  const reconnectAttempt = ref(0); // 當前重連嘗試次數
  const connectionQuality = ref('unknown'); // 連接質量: excellent, good, fair, poor, critical, unknown
  const connectionStats = reactive({ // 連接統計
    rtt: 0,            // 往返時間(毫秒)
    packetLoss: 0,     // 丟包率(百分比)
    bandwidth: 0,      // 帶寬(kbps)
    lastUpdated: null  // 最後更新時間
  });
  
  // WebRTC 和信令相關的實例
  let signalingClient = null;
  let webRTCManager = null;
  
  // 獲取環境變數配置
  const runtimeConfig = useRuntimeConfig();
  
  // 重置狀態
  const reset = () => {
    status.value = 'disconnected';
    isLoading.value = false;
    connectionCode.value = '';
    errorMessage.value = '';
    role.value = '';
    
    // 斷開現有連接
    if (signalingClient) {
      signalingClient.disconnect();
      signalingClient = null;
    }
    
    if (webRTCManager) {
      webRTCManager.close();
      webRTCManager = null;
    }
  };
  
  // 作為接收者開始連接流程
  const startAsReceiver = async () => {
    try {
      reset();
      isLoading.value = true;
      role.value = 'receiver';
      
      // 獲取 WebSocket Token
      const wsToken = await getWebSocketToken();
      
      // 創建信令客戶端（signalingUrl 會從環境變數中獲取）
      signalingClient = new SignalingClient({
        token: wsToken,
        maxReconnectAttempts: 10, // 最大重連嘗試次數
        reconnectBaseDelay: 1000, // 基礎重連延遲(毫秒)
        heartbeatInterval: 15000 // 心跳間隔(毫秒)
      });
      
      // 設置信令事件處理器
      setupSignalingEvents();
      
      // 連接到信令伺服器
      await signalingClient.connect();
      
      // 請求連接代碼
      await signalingClient.requestCode();
      
      status.value = 'awaiting_connection';
      isLoading.value = false;
    } catch (error) {
      console.error('開始接收者流程失敗:', error);
      status.value = 'error';
      errorMessage.value = `連接失敗: ${error.message || '未知錯誤'}`;
      isLoading.value = false;
    }
  };
  
  // 作為發送者開始連接流程
  const startAsSender = async (code) => {
    try {
      reset();
      isLoading.value = true;
      role.value = 'sender';
      
      // 獲取 WebSocket Token
      const wsToken = await getWebSocketToken();
      
      // 創建信令客戶端（signalingUrl 會從環境變數中獲取）
      signalingClient = new SignalingClient({
        token: wsToken,
        maxReconnectAttempts: 10, // 最大重連嘗試次數
        reconnectBaseDelay: 1000, // 基礎重連延遲(毫秒)
        heartbeatInterval: 15000 // 心跳間隔(毫秒)
      });
      
      // 設置信令事件處理器
      setupSignalingEvents();
      
      // 連接到信令伺服器
      await signalingClient.connect();
      
      // 使用代碼請求連接
      status.value = 'connecting';
      await signalingClient.requestConnection(code);
    } catch (error) {
      console.error('開始發送者流程失敗:', error);
      status.value = 'error';
      errorMessage.value = `連接失敗: ${error.message || '未知錯誤'}`;
      isLoading.value = false;
    }
  };
  
  // 斷開連接
  const disconnect = () => {
    reset();
  };
  
  // 設置信令事件處理器
  const setupSignalingEvents = () => {
    if (!signalingClient) return;
    
    // 代碼生成事件
    signalingClient.onCodeGenerated = (code) => {
      connectionCode.value = code;
    };
    
    // 連接就緒事件（發送方收到）
    signalingClient.onConnectionReady = () => {
      // 初始化 WebRTC 連接
      initializeWebRTC();
    };
    
    // 對等方連接事件（接收方收到）
    signalingClient.onPeerConnected = () => {
      // 初始化 WebRTC 連接
      initializeWebRTC();
    };
    
    // Offer 接收事件
    signalingClient.onOfferReceived = (offer) => {
      if (webRTCManager) {
        webRTCManager.handleOffer(offer);
      }
    };
    
    // Answer 接收事件
    signalingClient.onAnswerReceived = (answer) => {
      if (webRTCManager) {
        webRTCManager.handleAnswer(answer);
      }
    };
    
    // ICE 候選者接收事件
    signalingClient.onIceCandidateReceived = (candidate) => {
      if (webRTCManager) {
        webRTCManager.addIceCandidate(candidate);
      }
    };
    
    // 對等方斷開連接事件
    signalingClient.onPeerDisconnected = () => {
      console.log('[DEBUG-ConnectionStore] 收到對等方斷開連接通知，當前重連狀態:', isReconnecting.value);
      console.log('[DEBUG-ConnectionStore] WebRTC 連接狀態:', webRTCManager ? webRTCManager.peerConnection?.connectionState : 'no manager');
      console.log('[DEBUG-ConnectionStore] WebRTC ICE 狀態:', webRTCManager ? webRTCManager.peerConnection?.iceConnectionState : 'no manager');
      console.log('[DEBUG-ConnectionStore] 頁面角色:', role.value);
      console.log('[DEBUG-ConnectionStore] 發生在頁面:', window.location.pathname);
      
      status.value = 'disconnected';
      errorMessage.value = '對方已斷開連接';
    };
    
    // 錯誤事件
    signalingClient.onError = (error) => {
      console.error('信令錯誤:', error);
      status.value = 'error';
      errorMessage.value = `連接錯誤: ${error.message || '未知錯誤'}`;
      isLoading.value = false;
    };
    
    // 信令重連嘗試事件
    signalingClient.onReconnecting = () => {
      console.log('正在嘗試重新連接到信令伺服器...');
      isReconnecting.value = true;
      status.value = 'reconnecting';
      errorMessage.value = '連接中斷，嘗試重新連接...';
    };
    
    // 信令重連成功事件
    signalingClient.onReconnected = () => {
      console.log('重新連接到信令伺服器成功');
      isReconnecting.value = false;
      reconnectAttempt.value = 0;
      
      // 如果 WebRTC 連接已斷開但信令已重連，嘗試恢復 WebRTC 連接
      if (webRTCManager && !webRTCManager.isConnected()) {
        console.log('信令已恢復，嘗試恢復 WebRTC 連接');
        
        // 重新初始化 WebRTC 連接
        if (webRTCManager.isReconnecting) {
          console.log('WebRTC 已在重連中，不重複初始化');
        } else {
          console.log('重新初始化 WebRTC 連接');
          webRTCManager.tryReconnect();
        }
      } else if (status.value === 'reconnecting') {
        // 如果 WebRTC 仍然是連接的，恢復原來的狀態
        status.value = webRTCManager && webRTCManager.isConnected() ? 'connected' : 'connecting';
        errorMessage.value = '';
      }
    };
    
    // 信令重連失敗事件
    signalingClient.onReconnectFailed = () => {
      console.error('重新連接到信令伺服器失敗');
      isReconnecting.value = false;
      status.value = 'error';
      errorMessage.value = '重新連接失敗，請重試';
    };
  };
  
  // 初始化 WebRTC 連接
  const initializeWebRTC = () => {
    // 創建 WebRTC 管理器（環境變數的 iceServers 設定會在 WebRTCManager 內部處理）
    webRTCManager = new WebRTCManager({
      isInitiator: role.value === 'sender',
      maxReconnectAttempts: 5,  // 最大重連嘗試次數
      reconnectBaseDelay: 1000,  // 基礎重連延遲(毫秒)
      enableConnectionMonitoring: true // 啟用連接質量監測
    });
    
    // 設置 WebRTC 事件處理器
    setupWebRTCEvents();
    
    // 連接 WebRTC 與信令
    webRTCManager.connectSignaling(signalingClient);
    
    // 如果是發送者，創建 Offer
    if (role.value === 'sender') {
      webRTCManager.createOffer();
    }
  };
  
  // 設置 WebRTC 事件處理器
  const setupWebRTCEvents = () => {
    if (!webRTCManager) return;
    
    // 連接狀態變更
    webRTCManager.onConnectionStateChange = (state) => {
      console.log('WebRTC 連接狀態變更:', state);
      
      if (state === 'connected') {
        status.value = 'connected';
        isLoading.value = false;
        isReconnecting.value = false;
        errorMessage.value = '';
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        // 不立即更新 UI 狀態為斷開，因為可能會自動重連
        // 只有當不在重連中或重連已經失敗時才更新狀態
        if (!isReconnecting.value) {
          status.value = 'disconnected';
          errorMessage.value = '連接已斷開或失敗';
        }
      }
    };
    
    // 資料通道開啟
    webRTCManager.onDataChannelOpen = () => {
      status.value = 'connected';
      isLoading.value = false;
      isReconnecting.value = false;
      errorMessage.value = '';
    };
    
    // 資料通道關閉
    webRTCManager.onDataChannelClose = () => {
      // 不立即更新 UI 狀態為斷開，因為可能會自動重連
      if (!isReconnecting.value) {
        status.value = 'disconnected';
        errorMessage.value = '資料通道已關閉';
      }
    };
    
    // 資料通道錯誤
    webRTCManager.onDataChannelError = (error) => {
      console.error('資料通道錯誤:', error);
      
      // 不立即更新 UI 狀態為錯誤，因為可能會自動重連
      if (!isReconnecting.value) {
        status.value = 'error';
        errorMessage.value = `資料通道錯誤: ${error.message || '未知錯誤'}`;
      }
    };
    
    // WebRTC 重連嘗試事件
    webRTCManager.onReconnecting = () => {
      console.log('正在嘗試重新建立 WebRTC 連接...');
      isReconnecting.value = true;
      reconnectAttempt.value = webRTCManager.reconnectAttempts;
      status.value = 'reconnecting';
      errorMessage.value = '連接中斷，嘗試重新連接...';
    };
    
    // WebRTC 重連成功事件
    webRTCManager.onReconnected = () => {
      console.log('重新建立 WebRTC 連接成功');
      isReconnecting.value = false;
      reconnectAttempt.value = 0;
      status.value = 'connected';
      errorMessage.value = '';
    };
    
    // WebRTC 重連失敗事件
    webRTCManager.onReconnectFailed = () => {
      console.error('重新建立 WebRTC 連接失敗');
      isReconnecting.value = false;
      status.value = 'error';
      errorMessage.value = '重新連接失敗，請重試';
    };
    
    // 連接質量變更事件
    webRTCManager.onConnectionQualityChange = (quality, stats) => {
      console.log(`連接質量: ${quality}`, stats);
      connectionQuality.value = quality;
      
      // 更新連接統計
      if (stats) {
        if (stats.avgRtt !== undefined) connectionStats.rtt = stats.avgRtt;
        if (stats.avgPacketLoss !== undefined) connectionStats.packetLoss = stats.avgPacketLoss;
        if (stats.avgBandwidth !== undefined) connectionStats.bandwidth = stats.avgBandwidth;
        connectionStats.lastUpdated = Date.now();
      }
      
      // 如果連接質量差，向用戶顯示提示
      if (quality === 'poor' || quality === 'critical') {
        errorMessage.value = `連接質量${quality === 'poor' ? '較差' : '很差'}，可能會影響聊天體驗`;
      } else if (quality === 'excellent' || quality === 'good') {
        // 清除之前的連接質量錯誤消息
        if (errorMessage.value && errorMessage.value.includes('連接質量')) {
          errorMessage.value = '';
        }
      }
    };
  };
  
  // 獲取 WebSocket Token
  const getWebSocketToken = async () => {
    try {
      // 從環境變數中獲取 API 路徑和密鑰
      const apiPath = runtimeConfig.public.wsTokenEndpoint || '/api/get-ws-token';
      const wssKey = runtimeConfig.public.wssKey || ''; // 從環境變數獲取 WSS Key
      
      // 嘗試向後端請求令牌
      try {
        // 獲取 WebSocket 主機 (從 URL 解析)
        let wsHost;
        try {
          // 嘗試從 WebSocket URL 獲取主機名
          const wsUrl = new URL(runtimeConfig.public.signalingUrl);
          wsHost = wsUrl.host;
          console.log(`從 WebSocket URL 獲取主機: ${wsHost}`);
        } catch (e) {
          // 如果 URL 無效，使用預設值或當前頁面的主機
          wsHost = window.location.host;
          console.log(`使用當前頁面主機: ${wsHost}`);
        }
        
        // 構建 API URL (使用 HTTPS)
        let protocol = 'https://';
        const tokenUrl = `${protocol}${wsHost}${apiPath}`;
        console.log('從後端獲取令牌:', tokenUrl);
        
        const response = await fetch(tokenUrl);
        if (!response.ok) {
          throw new Error(`伺服器返回錯誤: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        console.log('成功獲取令牌:', data);
        return data.token;
      } catch (fetchError) {
        console.error('無法從後端獲取令牌，嘗試使用本地生成:', fetchError);
        
        // 如果無法從後端獲取，使用本地生成的令牌
        if (wssKey) {
          console.log('使用本地生成的令牌');
          const timestamp = Math.floor(Date.now() / 1000);
          const expiry = timestamp + 600; // 10分鐘過期
          return `{"iat":${timestamp},"exp":${expiry}}.${wssKey.substring(0, 10)}`;
        } else {
          throw fetchError;
        }
      }
    } catch (error) {
      console.error('獲取 WebSocket Token 失敗:', error);
      throw new Error('無法獲取連接憑證');
    }
  };
  
  // 為彈出窗口設置角色
  const setRole = (newRole) => {
    if (newRole === 'sender' || newRole === 'receiver') {
      console.log(`手動設置角色: ${newRole}`);
      role.value = newRole;
      return true;
    }
    return false;
  };
  
  // 為彈出窗口設置狀態
  const setStatus = (newStatus) => {
    console.log(`手動設置連接狀態: ${newStatus}`);
    status.value = newStatus;
  };
  
  // 暴露給外部使用的 API
  return {
    // 狀態
    status,
    isLoading,
    connectionCode,
    errorMessage,
    role,
    isReconnecting,
    reconnectAttempt,
    connectionQuality,
    connectionStats,
    
    // 方法
    reset,
    startAsReceiver,
    startAsSender,
    disconnect,
    setRole,        // 新增：允許手動設置角色
    setStatus,      // 新增：允許手動設置狀態
    
    // 連接質量相關
    getConnectionQuality: () => connectionQuality.value,
    getConnectionStats: () => ({ ...connectionStats }),
    
    // 獲取 WebRTC 管理器 (供其他 store 使用)
    getWebRTCManager: () => webRTCManager
  };
});
