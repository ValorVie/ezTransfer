// 抽象消息服務接口
export class MessageService {
  // 註冊消息處理器
  registerMessageHandler(handler) {}
  
  // 發送消息
  sendMessage(content, messageId) {}
  
  // 連接服務
  connect() {}
  
  // 斷開連接
  disconnect() {}
}

// WebRTC 實現
export class WebRTCMessageService extends MessageService {
  constructor(connectionStore) {
    super();
    this.connectionStore = connectionStore;
    this.messageHandlers = [];
    
    // 消息可靠性保障相關
    this.pendingMessages = new Map(); // 等待確認的消息隊列，鍵是消息ID，值是消息對象
    this.maxRetries = 5;              // 最大重試次數
    this.ackTimeout = 3000;           // 確認超時時間(毫秒)
    this.retryDelay = 1000;           // 重試延遲(毫秒)
    this.retryTimers = new Map();     // 重試計時器，鍵是消息ID，值是計時器ID
  }
  
  registerMessageHandler(handler) {
    this.messageHandlers.push(handler);
  }
  
  /**
   * 發送消息，支援可靠性保障
   * @param {string} content - 消息內容
   * @param {string} messageId - 消息ID（可選）
   * @param {boolean} requireAck - 是否需要確認(默認為true)
   * @returns {boolean} 是否發送成功
   */
  sendMessage(content, messageId, requireAck = true) {
    const webRTCManager = this.connectionStore.getWebRTCManager();
    if (!webRTCManager || !webRTCManager.isConnected()) {
      console.error('WebRTC 連接未建立，無法發送消息');
      return false;
    }
    
    const dataChannel = webRTCManager.getDataChannel();
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('數據通道未開啟，無法發送消息');
      return false;
    }
    
    try {
      // 生成消息ID（如果未提供）
      const msgId = messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 創建消息對象
      const message = {
        type: 'chat_message',
        senderRole: this.connectionStore.role,
        content: content.trim(),
        timestamp: Date.now(),
        id: msgId,
        requireAck: requireAck  // 標記是否需要確認
      };
      
      // 發送消息
      const success = this._sendRawMessage(message);
      
      if (success && requireAck) {
        // 添加到等待確認的隊列
        this.pendingMessages.set(msgId, {
          ...message,
          retries: 0,
          sentAt: Date.now()
        });
        
        // 設置確認超時計時器
        this._setAckTimeout(msgId);
      }
      
      return success;
    } catch (error) {
      console.error('發送消息失敗:', error);
      return false;
    }
  }
  
  connect() {
    const webRTCManager = this.connectionStore.getWebRTCManager();
    if (!webRTCManager) {
      console.error('WebRTC管理器未初始化，無法啟動聊天功能');
      return false;
    }
    
    // 儲存原有的消息處理器，以確保不破壞其他功能
    const originalHandler = webRTCManager.onDataChannelMessage;
    
    // 設置自定義消息處理器
    webRTCManager.onDataChannelMessage = (data, channel) => {
      try {
        // 嘗試解析為JSON以檢查是否是聊天消息
        const message = typeof data === 'string' ? JSON.parse(data) : data;
        
        switch (message.type) {
          case 'chat_message':
            // 發送確認消息（如果需要確認）
            if (message.requireAck) {
              this._sendAck(message.id, channel);
            }
            
            // 通知所有註冊的處理器
            this.messageHandlers.forEach(handler => handler(message));
            return true;
            
          case 'message_ack':
            // 處理消息確認
            this._handleAck(message.messageId);
            return true;
            
          default:
            // 不是我們處理的消息類型，交給原處理器
            if (originalHandler) {
              originalHandler(data, channel);
            }
            break;
        }
      } catch (error) {
        // 解析失敗，可能是檔案數據塊，交給原處理器
        if (originalHandler) {
          originalHandler(data, channel);
        }
      }
    };
    return true;
  }
  
  disconnect() {
    // 清理所有計時器
    this.retryTimers.forEach(timerId => clearTimeout(timerId));
    this.retryTimers.clear();
    this.pendingMessages.clear();
    
    // 清理處理器
    this.messageHandlers = [];
  }
  
  /**
   * 發送原始消息
   * @private
   * @param {Object} message - 消息對象
   * @returns {boolean} 是否發送成功
   */
  _sendRawMessage(message) {
    try {
      const webRTCManager = this.connectionStore.getWebRTCManager();
      if (!webRTCManager || !webRTCManager.isConnected()) {
        return false;
      }
      
      const dataChannel = webRTCManager.getDataChannel();
      if (!dataChannel || dataChannel.readyState !== 'open') {
        return false;
      }
      
      dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('發送原始消息失敗:', error);
      return false;
    }
  }
  
  /**
   * 發送消息確認(ACK)
   * @private
   * @param {string} messageId - 要確認的消息ID
   * @param {RTCDataChannel} channel - 數據通道
   */
  _sendAck(messageId, channel) {
    try {
      if (!channel || channel.readyState !== 'open') {
        console.warn('無法發送確認，數據通道未開啟');
        return;
      }
      
      const ackMessage = {
        type: 'message_ack',
        messageId: messageId,
        timestamp: Date.now()
      };
      
      channel.send(JSON.stringify(ackMessage));
      console.log(`已發送確認: ${messageId}`);
    } catch (error) {
      console.error('發送確認失敗:', error);
    }
  }
  
  /**
   * 處理收到的確認消息
   * @private
   * @param {string} messageId - 收到確認的消息ID
   */
  _handleAck(messageId) {
    // 從待確認隊列中移除
    if (this.pendingMessages.has(messageId)) {
      console.log(`收到消息確認: ${messageId}`);
      this.pendingMessages.delete(messageId);
      
      // 清除相關計時器
      if (this.retryTimers.has(messageId)) {
        clearTimeout(this.retryTimers.get(messageId));
        this.retryTimers.delete(messageId);
      }
    }
  }
  
  /**
   * 設置確認超時計時器
   * @private
   * @param {string} messageId - 消息ID
   */
  _setAckTimeout(messageId) {
    // 清除之前的計時器（如果有）
    if (this.retryTimers.has(messageId)) {
      clearTimeout(this.retryTimers.get(messageId));
    }
    
    // 設置新的超時計時器
    const timerId = setTimeout(() => {
      this._handleAckTimeout(messageId);
    }, this.ackTimeout);
    
    this.retryTimers.set(messageId, timerId);
  }
  
  /**
   * 處理確認超時
   * @private
   * @param {string} messageId - 消息ID
   */
  _handleAckTimeout(messageId) {
    // 檢查消息是否還在待確認隊列中
    const pendingMsg = this.pendingMessages.get(messageId);
    if (!pendingMsg) return;
    
    // 檢查重試次數
    if (pendingMsg.retries >= this.maxRetries) {
      console.error(`消息 ${messageId} 達到最大重試次數，放棄重試`);
      this.pendingMessages.delete(messageId);
      this.retryTimers.delete(messageId);
      return;
    }
    
    // 增加重試計數
    pendingMsg.retries += 1;
    console.log(`消息 ${messageId} 確認超時，嘗試重傳 (${pendingMsg.retries}/${this.maxRetries})`);
    
    // 重新發送消息
    const success = this._sendRawMessage(pendingMsg);
    
    if (success) {
      // 更新發送時間
      pendingMsg.sentAt = Date.now();
      this.pendingMessages.set(messageId, pendingMsg);
      
      // 重新設置超時計時器，使用指數退避算法增加延遲
      const backoffDelay = this.ackTimeout * Math.pow(1.5, pendingMsg.retries);
      const nextTimerId = setTimeout(() => {
        this._handleAckTimeout(messageId);
      }, backoffDelay);
      
      this.retryTimers.set(messageId, nextTimerId);
    } else {
      // 發送失敗，可能連接已斷開
      console.error(`消息 ${messageId} 重傳失敗，可能連接已斷開`);
      this.pendingMessages.delete(messageId);
      this.retryTimers.delete(messageId);
    }
  }
}