import { useRuntimeConfig } from '#imports';
import { ConnectionMonitor } from './connectionMonitor';

/**
 * WebRTC 管理器類
 * 負責處理 WebRTC 連接和數據通道
 */
export class WebRTCManager {
  constructor(options = {}) {
    // 配置
    this.isInitiator = options.isInitiator || false;  // 是否為發起方 (sender)
    
    // 使用傳入的 iceServers 配置或從環境變數設定
    if (options.iceServers) {
      this.iceServers = options.iceServers;
    } else {
      // 獲取環境變數配置
      const config = useRuntimeConfig();
      
      // 默認 STUN 伺服器（如環境變數未設定則使用 Google 的）
      const stunUri = config.public.stunUri || 'stun:stun.l.google.com:19302';
      
      this.iceServers = [{ urls: stunUri }];
      
      // 如果配置了 TURN 伺服器，則添加
      if (config.public.turnUri) {
        this.iceServers.push({
          urls: config.public.turnUri,
          username: config.public.turnUsername,
          credential: config.public.turnPassword,
          credentialType: 'password'
        });
      }
    }
    
    // 對等連接
    this.peerConnection = null;
    
    // 數據通道
    this.dataChannel = null;
    
    // 信令客戶端
    this.signalingClient = null;
    
    // 事件處理函數
    this.onDataChannelOpen = null;       // 當數據通道開啟時
    this.onDataChannelClose = null;      // 當數據通道關閉時
    this.onDataChannelMessage = null;    // 當數據通道接收訊息時
    this.onDataChannelError = null;      // 當數據通道發生錯誤時
    this.onConnectionStateChange = null; // 當連接狀態變更時
    this.onReconnecting = null;          // 當嘗試重新連接時
    this.onReconnected = null;           // 當重新連接成功時
    this.onReconnectFailed = null;       // 當重新連接失敗時
    this.onConnectionQualityChange = null; // 當連接質量變更時
    
    // 重連相關設置
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;  // 最大重連嘗試次數
    this.reconnectBaseDelay = options.reconnectBaseDelay || 1000;    // 基礎重連延遲(毫秒)
    this.isReconnecting = false;         // 是否正在嘗試重連
    this.reconnectAttempts = 0;          // 當前重連嘗試次數
    this.reconnectTimer = null;          // 重連計時器
    this.lastIceConnectionState = null;  // 上一次的 ICE 連接狀態
    this.lastConnectionState = null;     // 上一次的連接狀態
    
    // 存儲舊的連接信息，用於重連時恢復
    this.storedSessionInfo = {
      localDescription: null,
      remoteDescription: null
    };
    
    // 連接監測相關設置
    this.enableConnectionMonitoring = options.enableConnectionMonitoring !== false; // 默認啟用
    this.connectionMonitor = null;
    this.connectionQuality = 'unknown';
    this.adaptiveSettings = {}; // 自適應設置
    
    // 初始化
    this.initialize();
  }
  
  /**
   * 初始化 WebRTC 連接
   */
  initialize() {
    try {
      // 創建對等連接
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers
      });
      
      // 設置 ICE 候選事件處理
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.handleIceCandidate(event.candidate);
        }
      };
      
      // 設置 ICE 連接狀態變更事件處理
      this.peerConnection.oniceconnectionstatechange = () => {
        const iceState = this.peerConnection.iceConnectionState;
        console.log('ICE 連接狀態:', iceState);
        
        // 檢測連接不穩定或斷開的狀態
        if (iceState === 'disconnected' || iceState === 'failed' || iceState === 'closed') {
          this.handleConnectionIssue('ice', iceState);
        } else if (iceState === 'connected' || iceState === 'completed') {
          // 如果之前有連接問題但現在恢復了
          if (this.lastIceConnectionState === 'disconnected' || this.lastIceConnectionState === 'failed') {
            if (this.isReconnecting) {
              this.handleReconnectSuccess();
            }
          }
        }
        
        // 更新上一次狀態
        this.lastIceConnectionState = iceState;
        
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(iceState);
        }
      };
      
      // 設置連接狀態變更事件處理
      this.peerConnection.onconnectionstatechange = () => {
        const connState = this.peerConnection.connectionState;
        console.log('連接狀態:', connState);
        
        // 檢測連接不穩定或斷開的狀態
        if (connState === 'disconnected' || connState === 'failed' || connState === 'closed') {
          this.handleConnectionIssue('connection', connState);
        } else if (connState === 'connected') {
          // 如果之前有連接問題但現在恢復了
          if (this.lastConnectionState === 'disconnected' || this.lastConnectionState === 'failed') {
            if (this.isReconnecting) {
              this.handleReconnectSuccess();
            }
          }
        }
        
        // 更新上一次狀態
        this.lastConnectionState = connState;
        
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(connState);
        }
      };
      
      // 如果是發起方，則創建數據通道
      if (this.isInitiator) {
        this.createDataChannel();
      } else {
        // 如果是接收方，則監聽數據通道
        this.peerConnection.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannel();
        };
      }
      
      console.log('WebRTC 管理器初始化完成', this.iceServers);
    } catch (error) {
      console.error('初始化 WebRTC 失敗:', error);
      throw error;
    }
  }
  
  /**
   * 創建數據通道
   */
  createDataChannel() {
    try {
      // 獲取環境變數配置
      const config = useRuntimeConfig();
      const devMode = config.public.devMode;
      
      // 配置數據通道選項
      const dataChannelOptions = {
        ordered: true,       // 保證訊息順序
        maxRetransmits: 10   // 最大重傳次數
        // 注意：不能同時設置 maxRetransmits 和 maxPacketLifeTime
        // 這兩個參數是互斥的，只能使用其中一個
      };
      
      // 開發模式下可以使用更寬鬆的設置
      if (devMode) {
        console.log('開發模式：使用寬鬆的數據通道設置');
        dataChannelOptions.maxRetransmits = 30;
      }
      
      // 創建數據通道
      this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', dataChannelOptions);
      
      // 設置數據通道事件處理
      this.setupDataChannel();
      
      // 如果啟用了連接監測，初始化監測器
      if (this.enableConnectionMonitoring) {
        this.initializeConnectionMonitor();
      }
      
      return this.dataChannel;
    } catch (error) {
      console.error('創建數據通道失敗:', error);
      throw error;
    }
  }
  
  /**
   * 設置數據通道事件處理
   */
  setupDataChannel() {
    if (!this.dataChannel) return;
    
    // 數據通道開啟
    this.dataChannel.onopen = () => {
      console.log('數據通道已開啟');
      if (this.onDataChannelOpen) {
        this.onDataChannelOpen();
      }
      
      // 如果啟用了連接監測，開始監測
      if (this.enableConnectionMonitoring && this.connectionMonitor) {
        this.connectionMonitor.startMonitoring();
      }
    };
    
    // 數據通道關閉
    this.dataChannel.onclose = () => {
      console.log('數據通道已關閉');
      if (this.onDataChannelClose) {
        this.onDataChannelClose();
      }
      
      // 停止連接監測
      if (this.connectionMonitor) {
        this.connectionMonitor.stopMonitoring();
      }
    };
    
    // 數據通道訊息
    this.dataChannel.onmessage = (event) => {
      // 處理接收到的數據
      if (this.onDataChannelMessage) {
        // 傳遞數據和數據通道引用，確保接收方可以發送控制訊息
        this.onDataChannelMessage(event.data, this.dataChannel);
      }
    };
    
    // 數據通道錯誤
    this.dataChannel.onerror = (error) => {
      console.error('數據通道錯誤:', error);
      if (this.onDataChannelError) {
        this.onDataChannelError(error);
      }
    };
  }
  
  /**
   * 處理 ICE 候選者
   * @param {Object} candidate - ICE 候選者物件
   */
  handleIceCandidate(candidate) {
    if (this.signalingClient) {
      this.signalingClient.sendIceCandidate(candidate);
    }
  }
  
  /**
   * 連接信令客戶端
   * @param {Object} signalingClient - 信令客戶端實例
   */
  connectSignaling(signalingClient) {
    this.signalingClient = signalingClient;
  }
  
  /**
   * 創建 Offer (發起方調用)
   */
  async createOffer() {
    try {
      if (!this.peerConnection) {
        throw new Error('對等連接尚未初始化');
      }
      
      // 創建 Offer
      const offer = await this.peerConnection.createOffer();
      
      // 設定本地描述
      await this.peerConnection.setLocalDescription(offer);
      
      // 儲存本地描述，用於重連時恢復
      this.storedSessionInfo.localDescription = offer;
      
      // 發送 Offer 到信令伺服器
      if (this.signalingClient) {
        this.signalingClient.sendOffer(offer);
      }
      
      console.log('已創建並發送 Offer');
    } catch (error) {
      console.error('創建 Offer 失敗:', error);
      throw error;
    }
  }
  
  /**
   * 處理接收到的 Offer (接收方調用)
   * @param {Object} offer - SDP Offer 物件
   */
  async handleOffer(offer) {
    try {
      if (!this.peerConnection) {
        throw new Error('對等連接尚未初始化');
      }
      
      // 設定遠端描述
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      // 創建 Answer
      const answer = await this.peerConnection.createAnswer();
      
      // 設定本地描述
      await this.peerConnection.setLocalDescription(answer);
      
      // 發送 Answer 到信令伺服器
      if (this.signalingClient) {
        this.signalingClient.sendAnswer(answer);
      }
      
      console.log('已處理 Offer 並發送 Answer');
    } catch (error) {
      console.error('處理 Offer 失敗:', error);
      throw error;
    }
  }
  
  /**
   * 處理接收到的 Answer (發起方調用)
   * @param {Object} answer - SDP Answer 物件
   */
  async handleAnswer(answer) {
    try {
      if (!this.peerConnection) {
        throw new Error('對等連接尚未初始化');
      }
      
      // 設定遠端描述
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      
      // 儲存遠端描述，用於重連時恢復
      this.storedSessionInfo.remoteDescription = answer;
      
      console.log('已處理 Answer');
    } catch (error) {
      console.error('處理 Answer 失敗:', error);
      throw error;
    }
  }
  
  /**
   * 添加 ICE 候選者
   * @param {Object} candidate - ICE 候選者物件
   */
  async addIceCandidate(candidate) {
    try {
      if (!this.peerConnection) {
        throw new Error('對等連接尚未初始化');
      }
      
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      
      console.log('已添加 ICE 候選者');
    } catch (error) {
      console.error('添加 ICE 候選者失敗:', error);
      throw error;
    }
  }
  
  /**
   * 檢查是否已連接
   * @returns {boolean} 是否已連接
   */
  isConnected() {
    if (!this.peerConnection) return false;
    
    const connState = this.peerConnection.connectionState;
    const iceState = this.peerConnection.iceConnectionState;
    
    return (
      connState === 'connected' || 
      iceState === 'connected' || 
      iceState === 'completed'
    );
  }
  
  /**
   * 獲取數據通道
   * @returns {RTCDataChannel} 數據通道實例
   */
  getDataChannel() {
    return this.dataChannel;
  }
  
  /**
   * 關閉連接
   */
  close() {
    // 停止連接監測
    if (this.connectionMonitor) {
      this.connectionMonitor.stopMonitoring();
      this.connectionMonitor = null;
    }
    
    // 關閉數據通道
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    // 關閉對等連接
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    console.log('WebRTC 連接已關閉');
  }
  
  /**
   * 初始化連接監測器
   */
  initializeConnectionMonitor() {
    // 如果已經有監測器，先停止並清理
    if (this.connectionMonitor) {
      this.connectionMonitor.stopMonitoring();
      this.connectionMonitor = null;
    }
    
    // 創建新的連接監測器
    this.connectionMonitor = new ConnectionMonitor({
      peerConnection: this.peerConnection,
      dataChannel: this.dataChannel,
      onQualityChange: (quality, stats) => {
        this.handleConnectionQualityChange(quality, stats);
      },
      monitorInterval: 5000, // 5秒監測一次
      minSamples: 3          // 最少需要3個樣本才能評估質量
    });
    
    console.log('已初始化連接監測器');
  }
  
  /**
   * 處理連接質量變化
   * @param {string} quality - 新的連接質量
   * @param {Object} stats - 連接統計信息
   */
  handleConnectionQualityChange(quality, stats) {
    console.log(`連接質量變化: ${this.connectionQuality} -> ${quality}`);
    
    // 更新連接質量
    this.connectionQuality = quality;
    
    // 應用自適應設置
    if (stats && stats.recommendedSettings) {
      this.adaptiveSettings = stats.recommendedSettings;
      this.applyAdaptiveSettings();
    }
    
    // 通知外部
    if (this.onConnectionQualityChange) {
      this.onConnectionQualityChange(quality, stats);
    }
  }
  
  /**
   * 應用自適應設置
   */
  applyAdaptiveSettings() {
    // 根據連接質量應用不同的設置
    const settings = this.adaptiveSettings;
    
    if (!settings) return;
    
    console.log('應用自適應設置:', settings);
    
    // 這裡可以根據連接質量調整不同的參數
    // 例如，在數據通道上設置自定義屬性，供應用層參考使用
    if (this.dataChannel) {
      this.dataChannel.adaptiveSettings = settings;
    }
  }
  
  /**
   * 獲取當前連接質量
   * @returns {string} 連接質量
   */
  getConnectionQuality() {
    return this.connectionQuality;
  }
  
  /**
   * 獲取連接統計信息
   * @returns {Object|null} 連接統計信息
   */
  getConnectionStats() {
    return this.connectionMonitor ? this.connectionMonitor.getStats() : null;
  }
  
  /**
   * 處理連接問題 (斷開或失敗)
   * @param {string} type - 問題來源類型 ('ice' 或 'connection')
   * @param {string} state - 具體狀態
   */
  handleConnectionIssue(type, state) {
    // 如果連接已關閉 (close() 被調用)，不執行重連
    if (state === 'closed' || !this.peerConnection) {
      return;
    }
    
    // 如果已經在重連中，不重複觸發
    if (this.isReconnecting) {
      return;
    }
    
    console.log(`檢測到連接問題 (${type}): ${state}，準備嘗試重連`);
    this.tryReconnect();
  }
  
  /**
   * 嘗試重新連接
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
      console.error(`重連失敗: 已達最大嘗試次數 (${this.maxReconnectAttempts})`);
      this.handleReconnectFailure();
      return;
    }
    
    // 使用指數退避算法計算延遲時間
    const delay = this.calculateBackoffDelay();
    console.log(`安排第 ${this.reconnectAttempts + 1} 次重連，延遲 ${delay}ms`);
    
    // 清除之前的計時器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    // 設置新的重連計時器
    this.reconnectTimer = setTimeout(() => {
      this.executeReconnect();
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
    return exponentialDelay + jitter;
  }
  
  /**
   * 執行重連操作
   */
  async executeReconnect() {
    try {
      console.log(`執行第 ${this.reconnectAttempts + 1} 次重連嘗試`);
      this.reconnectAttempts++;
      
      // 檢查信令客戶端連接狀態
      if (this.signalingClient && !this.signalingClient.isConnected) {
        // 如果信令伺服器斷開，先重連信令
        await this.signalingClient.connect().catch(err => {
          console.error('信令伺服器重連失敗:', err);
          throw new Error('信令伺服器重連失敗');
        });
      }
      
      // 關閉舊連接但不重置狀態
      this.closeConnectionsForReconnect();
      
      // 重新創建連接
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers
      });
      
      // 重新設置事件處理
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.handleIceCandidate(event.candidate);
        }
      };
      
      // 重新設置 ICE 連接狀態變更處理
      this.peerConnection.oniceconnectionstatechange = () => {
        const iceState = this.peerConnection.iceConnectionState;
        console.log('ICE 連接狀態 (重連中):', iceState);
        
        this.lastIceConnectionState = iceState;
        
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(iceState);
        }
        
        if (iceState === 'connected' || iceState === 'completed') {
          this.handleReconnectSuccess();
        }
      };
      
      // 重新設置連接狀態變更處理
      this.peerConnection.onconnectionstatechange = () => {
        const connState = this.peerConnection.connectionState;
        console.log('連接狀態 (重連中):', connState);
        
        this.lastConnectionState = connState;
        
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(connState);
        }
        
        if (connState === 'connected') {
          this.handleReconnectSuccess();
        } else if (connState === 'failed') {
          // 如果這次嘗試失敗了，安排下一次重連
          this.scheduleReconnect();
        }
      };
      
      // 如果是接收方，設置數據通道處理
      if (!this.isInitiator) {
        this.peerConnection.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannel();
        };
      }
      
      // 如果是發起方，重新創建數據通道
      if (this.isInitiator) {
        this.createDataChannel();
        
        // 發送新的 Offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        // 儲存新的本地描述
        this.storedSessionInfo.localDescription = offer;
        
        // 發送 Offer 到信令伺服器
        if (this.signalingClient) {
          this.signalingClient.sendOffer(offer);
          console.log('已在重連過程中發送新的 Offer');
        }
      }
      
    } catch (error) {
      console.error('重連嘗試失敗:', error);
      
      // 如果這次嘗試失敗了，安排下一次重連
      this.scheduleReconnect();
    }
  }
  
  /**
   * 處理重連成功
   */
  handleReconnectSuccess() {
    if (!this.isReconnecting) return;
    
    console.log('WebRTC 重連成功!');
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // 重新初始化連接監測器
    if (this.enableConnectionMonitoring && this.dataChannel) {
      this.initializeConnectionMonitor();
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
    console.error('WebRTC 重連最終失敗');
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
   * 為重連關閉連接，但不完全重置
   * 不同於 close()，這個方法保留一些狀態以便重連
   */
  closeConnectionsForReconnect() {
    // 關閉數據通道
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    // 關閉對等連接
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    console.log('WebRTC 連接已關閉 (為重連做準備)');
  }
}