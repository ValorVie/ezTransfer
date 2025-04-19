import { useRuntimeConfig } from '#imports';

/**
 * 信令客戶端類
 * 負責與信令伺服器的通信，處理各種信令事件
 */
export class SignalingClient {
  constructor(options = {}) {
    // 獲取環境變數配置
    const config = useRuntimeConfig();
    
    // 配置選項
    this.signalingUrl = options.signalingUrl || config.public.signalingUrl || 'ws://localhost:8000/ws';
    this.token = options.token || '';
    console.log('初始化信令客戶端，URL:', this.signalingUrl);
    
    // WebSocket 實例
    this.socket = null;
    
    // 連接狀態
    this.isConnected = false;
    
    // 事件回調
    this.onCodeGenerated = null;          // 當收到連接代碼時
    this.onConnectionReady = null;        // 當連接準備就緒時 (發送方收到)
    this.onPeerConnected = null;          // 當對等方連接時 (接收方收到)
    this.onOfferReceived = null;          // 當收到 Offer 時
    this.onAnswerReceived = null;         // 當收到 Answer 時
    this.onIceCandidateReceived = null;   // 當收到 ICE 候選者時
    this.onPeerDisconnected = null;       // 當對等方斷開時
    this.onError = null;                  // 當發生錯誤時
    this.onReconnecting = null;           // 當嘗試重連信令伺服器時
    this.onReconnected = null;            // 當重連信令伺服器成功時
    this.onReconnectFailed = null;        // 當重連信令伺服器失敗時
    
    // 連接超時處理
    this.connectionTimeout = null;
    
    // 從環境變數獲取連接超時設定（毫秒）
    this.timeoutDuration = config.public.connectionTimeout || 10000; // 默認 10 秒
    
    // 重連相關設置
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;  // 最大重連嘗試次數
    this.reconnectBaseDelay = options.reconnectBaseDelay || 1000;    // 基礎重連延遲(毫秒)
    this.isReconnecting = false;          // 是否正在嘗試重連
    this.reconnectAttempts = 0;           // 當前重連嘗試次數
    this.reconnectTimer = null;           // 重連計時器
    this.autoReconnect = options.autoReconnect !== false;  // 是否自動重連
    
    // 心跳檢測設置
    this.heartbeatInterval = options.heartbeatInterval || 15000;     // 心跳間隔(毫秒)
    this.heartbeatTimer = null;           // 心跳計時器
    this.missedHeartbeats = 0;            // 錯過的心跳次數
    this.maxMissedHeartbeats = 3;         // 觸發重連的最大錯過心跳次數
  }
  
  /**
   * 連接到信令伺服器
   */
  async connect(isReconnecting = false) {
    return new Promise((resolve, reject) => {
      try {
        // 停止任何現有的心跳檢測
        this.stopHeartbeat();
        
        // 檢查是否已經連接
        if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
          console.log('已經連接到信令伺服器，無需重新連接');
          
          // 啟動心跳檢測
          this.startHeartbeat();
          
          resolve();
          return;
        }
        
        // 關閉任何已存在的連接
        if (this.socket) {
          this.socket.onclose = null; // 避免觸發已有的 onclose 處理
          try {
            this.socket.close();
          } catch (e) {
            console.warn('關閉現有 WebSocket 連接時出錯:', e);
          }
          this.socket = null;
        }
        
        // 建立帶有 token 的 WebSocket URL
        const wsUrl = `${this.signalingUrl}?token=${encodeURIComponent(this.token)}`;
        console.log(`嘗試${isReconnecting ? '重新' : ''}連接到 WebSocket:`, wsUrl);
        
        // 創建 WebSocket 連接
        this.socket = new WebSocket(wsUrl);
        
        // 設置連接超時
        this.connectionTimeout = setTimeout(() => {
          if (!this.isConnected) {
            if (isReconnecting) {
              console.warn('重連超時');
              this.handleReconnectFailure();
            } else {
              reject(new Error('連接超時'));
            }
            this.disconnect();
          }
        }, this.timeoutDuration);
        
        // WebSocket 事件處理
        this.socket.onopen = () => {
          clearTimeout(this.connectionTimeout);
          this.isConnected = true;
          this.reconnectAttempts = 0; // 重置重連嘗試次數
          
          if (isReconnecting) {
            console.log('已重新連接到信令伺服器');
            this.handleReconnectSuccess();
          } else {
            console.log('已連接到信令伺服器');
          }
          
          // 啟動心跳檢測
          this.startHeartbeat();
          
          resolve();
        };
        
        this.socket.onmessage = (event) => {
          // 收到任何消息都重置心跳計數
          this.missedHeartbeats = 0;
          this.handleMessage(event.data);
        };
        
        this.socket.onerror = (error) => {
          console.error('WebSocket 錯誤:', error);
          if (this.onError) {
            this.onError(error);
          }
          if (!this.isConnected) {
            if (isReconnecting) {
              this.scheduleReconnect();
            } else {
              reject(new Error('連接失敗'));
            }
          }
        };
        
        this.socket.onclose = (event) => {
          clearTimeout(this.connectionTimeout);
          this.stopHeartbeat();
          this.isConnected = false;
          console.log(`信令伺服器連接已關閉 (Code: ${event.code}, Reason: ${event.reason || 'None'})`);
          
          // 只有當不是在重連過程中斷開時，才嘗試自動重連
          if (this.autoReconnect && !this.isReconnecting) {
            console.log('嘗試自動重連到信令伺服器');
            this.tryReconnect();
          }
          
          // 通知對等方斷開連接
          if (this.onPeerDisconnected) {
            this.onPeerDisconnected();
          }
        };
      } catch (error) {
        clearTimeout(this.connectionTimeout);
        this.stopHeartbeat();
        console.error('連接到信令伺服器失敗:', error);
        
        if (isReconnecting) {
          this.scheduleReconnect();
        } else {
          reject(error);
        }
      }
    });
  }
  
  /**
   * 斷開與信令伺服器的連接
   */
  disconnect() {
    this.autoReconnect = false; // 禁用自動重連
    clearTimeout(this.connectionTimeout);
    clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    
    if (this.socket) {
      // 關閉 WebSocket 連接
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }
      this.socket = null;
    }
    
    this.isConnected = false;
    this.isReconnecting = false;
  }
  
  /**
   * 處理從伺服器接收的訊息
   * @param {string} data - 接收到的訊息數據
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      const messageType = message.type;
      
      // 如果是心跳回應，重置心跳計數
      if (messageType === 'heartbeat_ack') {
        this.missedHeartbeats = 0;
        return;
      }
      
      console.log('收到信令消息:', messageType);
      
      switch (messageType) {
        case 'code_generated':
          // 收到連接代碼
          if (this.onCodeGenerated) {
            this.onCodeGenerated(message.code);
          }
          break;
          
        case 'connection_ready':
          // 連接準備就緒 (發送方收到)
          if (this.onConnectionReady) {
            this.onConnectionReady();
          }
          break;
          
        case 'peer_connected':
          // 對等方已連接 (接收方收到)
          if (this.onPeerConnected) {
            this.onPeerConnected();
          }
          break;
          
        case 'offer_received':
          // 收到 Offer
          if (this.onOfferReceived) {
            this.onOfferReceived(message.offer);
          }
          break;
          
        case 'answer_received':
          // 收到 Answer
          if (this.onAnswerReceived) {
            this.onAnswerReceived(message.answer);
          }
          break;
          
        case 'ice_received':
          // 收到 ICE 候選者
          if (this.onIceCandidateReceived) {
            this.onIceCandidateReceived(message.candidate);
          }
          break;
          
        case 'peer_disconnected':
          // 對等方斷開連接
          if (this.onPeerDisconnected) {
            this.onPeerDisconnected();
          }
          break;
          
        case 'error':
          // 處理錯誤訊息
          console.error('信令伺服器錯誤:', message.message);
          if (this.onError) {
            this.onError(new Error(message.message));
          }
          break;
          
        default:
          console.warn('收到未知類型的信令消息:', messageType);
          break;
      }
    } catch (error) {
      console.error('解析訊息失敗:', error, data);
      if (this.onError) {
        this.onError(error);
      }
    }
  }
  
  /**
   * 發送訊息到信令伺服器
   * @param {Object} message - 要發送的訊息物件
   */
  sendMessage(message) {
    if (!this.isConnected || !this.socket) {
      throw new Error('尚未連接到信令伺服器');
    }
    
    try {
      const messageStr = JSON.stringify(message);
      this.socket.send(messageStr);
    } catch (error) {
      console.error('發送訊息失敗:', error);
      throw error;
    }
  }
  
  /**
   * 請求連接代碼 (接收方調用)
   */
  async requestCode() {
    try {
      this.sendMessage({
        type: 'request_code'
      });
    } catch (error) {
      console.error('請求連接代碼失敗:', error);
      throw error;
    }
  }
  
  /**
   * 請求連接 (發送方調用)
   * @param {string} code - 連接代碼
   */
  async requestConnection(code) {
    try {
      this.sendMessage({
        type: 'request_connection',
        code: code
      });
    } catch (error) {
      console.error('請求連接失敗:', error);
      throw error;
    }
  }
  
  /**
   * 發送 Offer
   * @param {Object} offer - SDP Offer 物件
   */
  sendOffer(offer) {
    try {
      this.sendMessage({
        type: 'send_offer',
        offer: offer
      });
    } catch (error) {
      console.error('發送 Offer 失敗:', error);
      throw error;
    }
  }
  
  /**
   * 發送 Answer
   * @param {Object} answer - SDP Answer 物件
   */
  sendAnswer(answer) {
    try {
      this.sendMessage({
        type: 'send_answer',
        answer: answer
      });
    } catch (error) {
      console.error('發送 Answer 失敗:', error);
      throw error;
    }
  }
  
  /**
   * 發送 ICE 候選者
   * @param {Object} candidate - ICE 候選者物件
   */
  sendIceCandidate(candidate) {
    try {
      this.sendMessage({
        type: 'send_ice',
        candidate: candidate
      });
    } catch (error) {
      console.error('發送 ICE 候選者失敗:', error);
      throw error;
    }
  }
  /**
   * 嘗試重新連接到信令伺服器
   */
  tryReconnect() {
    // 標記為重連中
    this.isReconnecting = true;
    this.reconnectAttempts = 0;
    
    // 通知外部正在重連
    if (this.onReconnecting) {
      this.onReconnecting();
    }
    
    // 開始重連過程
    this.scheduleReconnect();
  }
  
  /**
   * 安排下一次重連 (使用指數退避算法)
   */
  scheduleReconnect() {
    // 如果超過最大重連次數，放棄重連
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`信令伺服器重連失敗: 已達最大嘗試次數 (${this.maxReconnectAttempts})`);
      this.handleReconnectFailure();
      return;
    }
    
    // 使用指數退避算法計算延遲時間
    const delay = this.calculateBackoffDelay();
    console.log(`安排第 ${this.reconnectAttempts + 1} 次信令伺服器重連，延遲 ${delay}ms`);
    
    // 清除之前的計時器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    // 增加重連嘗試次數
    this.reconnectAttempts++;
    
    // 設置新的重連計時器
    this.reconnectTimer = setTimeout(() => {
      this.connect(true).catch(error => {
        console.error('信令伺服器重連失敗:', error);
        this.scheduleReconnect();
      });
    }, delay);
  }
  
  /**
   * 計算退避延遲時間
   * @returns {number} 延遲時間(毫秒)
   */
  calculateBackoffDelay() {
    // 使用指數退避算法: baseDelay * 2^attempt + 隨機抖動
    const exponentialDelay = this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.random() * 1000; // 最多1秒的隨機抖動
    return Math.min(exponentialDelay + jitter, 30000); // 最大不超過30秒
  }
  
  /**
   * 處理重連成功
   */
  handleReconnectSuccess() {
    console.log('信令伺服器重連成功!');
    this.isReconnecting = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // 通知外部重連成功
    if (this.onReconnected) {
      this.onReconnected();
    }
  }
  
  /**
   * 處理重連失敗
   */
  handleReconnectFailure() {
    console.error('信令伺服器重連最終失敗');
    this.isReconnecting = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // 通知外部重連失敗
    if (this.onReconnectFailed) {
      this.onReconnectFailed();
    }
  }
  
  /**
   * 啟動心跳檢測機制
   */
  startHeartbeat() {
    // 先清除現有的心跳定時器
    this.stopHeartbeat();
    
    // 重置心跳計數
    this.missedHeartbeats = 0;
    
    // 設置新的心跳計時器
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);
    
    console.log(`已啟動心跳檢測 (間隔: ${this.heartbeatInterval}ms)`);
  }
  
  /**
   * 停止心跳檢測機制
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  /**
   * 發送心跳包
   */
  sendHeartbeat() {
    if (!this.isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('發送心跳失敗: WebSocket 未連接');
      this.missedHeartbeats++;
      
      if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
        console.warn(`連續 ${this.missedHeartbeats} 次心跳失敗，觸發重連機制`);
        this.stopHeartbeat();
        
        if (this.socket) {
          try {
            this.socket.close();
          } catch (e) {
            console.warn('關閉 WebSocket 失敗:', e);
          }
          this.socket = null;
        }
        
        this.isConnected = false;
        
        if (this.autoReconnect && !this.isReconnecting) {
          this.tryReconnect();
        }
      }
      return;
    }
    
    try {
      // 發送心跳包
      this.sendMessage({
        type: 'heartbeat',
        timestamp: Date.now()
      });
      
      // 增加未收到回應的心跳計數
      this.missedHeartbeats++;
      
      if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
        console.warn(`連續 ${this.missedHeartbeats} 次心跳沒有回應，觸發重連機制`);
        this.stopHeartbeat();
        
        if (this.socket) {
          try {
            this.socket.close();
          } catch (e) {
            console.warn('關閉 WebSocket 失敗:', e);
          }
          this.socket = null;
        }
        
        this.isConnected = false;
        
        if (this.autoReconnect && !this.isReconnecting) {
          this.tryReconnect();
        }
      }
    } catch (error) {
      console.error('發送心跳失敗:', error);
    }
  }
}
