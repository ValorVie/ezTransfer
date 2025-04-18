import { useRuntimeConfig } from '#imports';

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
        console.log('ICE 連接狀態:', this.peerConnection.iceConnectionState);
        
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(this.peerConnection.iceConnectionState);
        }
      };
      
      // 設置連接狀態變更事件處理
      this.peerConnection.onconnectionstatechange = () => {
        console.log('連接狀態:', this.peerConnection.connectionState);
        
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange(this.peerConnection.connectionState);
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
    };
    
    // 數據通道關閉
    this.dataChannel.onclose = () => {
      console.log('數據通道已關閉');
      if (this.onDataChannelClose) {
        this.onDataChannelClose();
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
}