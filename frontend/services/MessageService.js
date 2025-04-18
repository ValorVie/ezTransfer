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
  }
  
  registerMessageHandler(handler) {
    this.messageHandlers.push(handler);
  }
  
  sendMessage(content, messageId) {
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
      // 創建消息對象
      const message = {
        type: 'chat_message',
        senderRole: this.connectionStore.role,
        content: content.trim(),
        timestamp: Date.now(),
        id: messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
      
      // 發送消息
      dataChannel.send(JSON.stringify(message));
      return true;
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
        
        if (message.type === 'chat_message') {
          // 通知所有註冊的處理器
          this.messageHandlers.forEach(handler => handler(message));
          return true;
        } else if (originalHandler) {
          // 不是聊天消息，交給原處理器
          originalHandler(data, channel);
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
    // 清理處理器
    this.messageHandlers = [];
  }
}