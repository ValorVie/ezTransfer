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
    
    // 連接超時處理
    this.connectionTimeout = null;
    
    // 從環境變數獲取連接超時設定（毫秒）
    this.timeoutDuration = config.public.connectionTimeout || 10000; // 默認 10 秒
  }
  
  /**
   * 連接到信令伺服器
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        // 檢查是否已經連接
        if (this.isConnected && this.socket) {
          resolve();
          return;
        }
        
        // 建立帶有 token 的 WebSocket URL
        const wsUrl = `${this.signalingUrl}?token=${encodeURIComponent(this.token)}`;
        console.log('嘗試連接到 WebSocket:', wsUrl);
        
        // 創建 WebSocket 連接
        this.socket = new WebSocket(wsUrl);
        
        // 設置連接超時
        this.connectionTimeout = setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('連接超時'));
            this.disconnect();
          }
        }, this.timeoutDuration);
        
        // WebSocket 事件處理
        this.socket.onopen = () => {
          clearTimeout(this.connectionTimeout);
          this.isConnected = true;
          console.log('已連接到信令伺服器');
          resolve();
        };
        
        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };
        
        this.socket.onerror = (error) => {
          console.error('WebSocket 錯誤:', error);
          if (this.onError) {
            this.onError(error);
          }
          if (!this.isConnected) {
            reject(new Error('連接失敗'));
          }
        };
        
        this.socket.onclose = () => {
          clearTimeout(this.connectionTimeout);
          this.isConnected = false;
          console.log('信令伺服器連接已關閉');
          
          // 通知對等方斷開連接
          if (this.onPeerDisconnected) {
            this.onPeerDisconnected();
          }
        };
      } catch (error) {
        clearTimeout(this.connectionTimeout);
        console.error('連接到信令伺服器失敗:', error);
        reject(error);
      }
    });
  }
  
  /**
   * 斷開與信令伺服器的連接
   */
  disconnect() {
    clearTimeout(this.connectionTimeout);
    
    if (this.socket) {
      // 關閉 WebSocket 連接
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }
      this.socket = null;
    }
    
    this.isConnected = false;
  }
  
  /**
   * 處理從伺服器接收的訊息
   * @param {string} data - 接收到的訊息數據
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      const messageType = message.type;
      
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
}
