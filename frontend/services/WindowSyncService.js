/**
 * 跨窗口狀態同步服務
 * 使用 BroadcastChannel API 實現不同窗口之間的通信
 */
export class WindowSyncService {
  constructor(channelName = 'ez-transfer-chat') {
    this.channelName = channelName;
    this.channel = null;
    this.handlers = new Map();
    this.isSourceWindow = false;
    
    try {
      // 檢查 BroadcastChannel API 是否可用
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(channelName);
        
        // 設置消息處理器
        this.channel.onmessage = (event) => {
          const { type, data } = event.data;
          if (this.handlers.has(type)) {
            this.handlers.get(type).forEach(handler => handler(data));
          }
        };
        
        console.log(`已創建跨窗口同步通道: ${channelName}`);
      } else {
        // 如果 BroadcastChannel 不可用，使用 localStorage 作為備用方案
        console.warn('BroadcastChannel API 不可用，使用 localStorage 作為備用');
        this.setupLocalStorageFallback();
      }
    } catch (error) {
      console.error('初始化跨窗口同步服務失敗:', error);
      this.setupLocalStorageFallback();
    }
  }
  
  /**
   * 設置 localStorage 備用方案
   * 在不支持 BroadcastChannel 的瀏覽器中使用
   */
  setupLocalStorageFallback() {
    // 使用 localStorage 和 storage 事件作為備用方案
    this.storagePrefix = `${this.channelName}_msg_`;
    
    // 監聽 storage 事件
    window.addEventListener('storage', (event) => {
      // 檢查是否是我們的消息
      if (event.key && event.key.startsWith(this.storagePrefix)) {
        try {
          const message = JSON.parse(event.newValue);
          const { type, data } = message;
          
          if (this.handlers.has(type)) {
            this.handlers.get(type).forEach(handler => handler(data));
          }
        } catch (error) {
          console.error('處理跨窗口消息失敗:', error);
        }
      }
    });
  }
  
  /**
   * 註冊特定類型消息的處理器
   * @param {string} type - 消息類型
   * @param {Function} handler - 處理函數
   */
  on(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type).push(handler);
  }
  
  /**
   * 發送消息到所有窗口
   * @param {string} type - 消息類型
   * @param {any} data - 消息數據
   */
  send(type, data) {
    const message = { type, data };
    
    try {
      // 使用 BroadcastChannel 發送（如果可用）
      if (this.channel) {
        this.channel.postMessage(message);
      } 
      // 使用 localStorage 備用方案
      else {
        const timestamp = Date.now();
        const key = `${this.storagePrefix}${timestamp}`;
        localStorage.setItem(key, JSON.stringify(message));
        
        // 清理舊消息（避免 localStorage 占用過多空間）
        setTimeout(() => {
          localStorage.removeItem(key);
        }, 1000);
      }
    } catch (error) {
      console.error('發送跨窗口消息失敗:', error);
    }
  }
  
  /**
   * 將此窗口標記為數據源窗口
   * 可用於主窗口和彈出窗口的角色區分
   */
  markAsSource() {
    this.isSourceWindow = true;
    this.send('window_info', { isSource: true });
  }
  
  /**
   * 檢查窗口是否為源窗口
   * @returns {boolean} 是否為源窗口
   */
  isSource() {
    return this.isSourceWindow;
  }
  
  /**
   * 請求從源窗口同步數據
   * 可用於彈出窗口初始化時
   */
  requestSync() {
    this.send('sync_request', { timestamp: Date.now() });
  }
  
  /**
   * 清理資源
   */
  destroy() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    
    this.handlers.clear();
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageListener);
    }
    
    console.log('跨窗口同步服務已關閉');
  }
}