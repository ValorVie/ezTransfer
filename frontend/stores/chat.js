import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import { useConnectionStore } from './connection';
import { WebRTCMessageService } from '../services/MessageService';
import { WindowSyncService } from '../services/WindowSyncService';

export const useChatStore = defineStore('chat', () => {
  // 狀態
  const messages = ref([]);
  const unreadCount = ref(0);
  const isMinimized = ref(true);

  // 獲取連接 store
  const connectionStore = useConnectionStore();
  
  // 服務實例 (使用 markRaw 避免 Vue 代理，這些對象不需要響應式)
  let messageService = null;
  let windowSync = null;

  // 初始化消息服務
  const initMessageService = () => {
    // 創建 WebRTC 消息服務實例
    messageService = markRaw(new WebRTCMessageService(connectionStore));
    // 註冊消息處理器
    messageService.registerMessageHandler(handleIncomingMessage);
    // 連接服務
    return messageService.connect();
  };
  
  // 初始化跨窗口同步
  const initWindowSync = () => {
    // 創建跨窗口同步服務
    windowSync = markRaw(new WindowSyncService());
    
    // 標記主窗口為源窗口
    windowSync.markAsSource();
    
    // 註冊消息處理器
    windowSync.on('new_message', (message) => {
      addMessageLocal(message);
    });
    
    windowSync.on('read_messages', () => {
      markAllAsRead();
    });
    
    // 處理同步請求
    windowSync.on('sync_request', () => {
      // 創建純JavaScript對象的深拷貝，去除Vue響應式屬性
      const messagesCopy = messages.value.map(msg => ({
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
        senderRole: msg.senderRole,
        read: msg.read || false
      }));
      
      // 發送所有消息進行同步
      windowSync.send('sync_messages', { messages: messagesCopy });
      windowSync.send('sync_unread', { count: unreadCount.value });
      windowSync.send('sync_minimized', { isMinimized: isMinimized.value });
    });
    
    // 處理接收同步數據
    windowSync.on('sync_messages', (data) => {
      if (data.messages && Array.isArray(data.messages)) {
        messages.value = data.messages;
      }
    });
    
    windowSync.on('sync_unread', (data) => {
      if (typeof data.count === 'number') {
        unreadCount.value = data.count;
      }
    });
    
    // 不再同步最小化狀態，每個窗口應該獨立控制
    windowSync.on('sync_minimized', (data) => {
      // 此處不進行處理，讓每個窗口保持獨立的展開/收起狀態
    });
  };
  
  // 添加新消息到列表 (僅本地)
  const addMessageLocal = (message) => {
    // 檢查是否已存在相同ID的消息 (避免重複)
    const existingIndex = messages.value.findIndex(m => m.id === message.id);
    if (existingIndex >= 0) {
      // 更新現有消息
      messages.value[existingIndex] = { ...message };
      return;
    }
    
    // 添加新消息
    messages.value.push({
      ...message,
      id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // 生成唯一ID
      read: !isMinimized.value || message.senderRole === connectionStore.role // 如果窗口打開或是自己發送的消息則標記為已讀
    });

    // 如果聊天窗口最小化且不是自己發送的消息，增加未讀消息數量
    if (isMinimized.value && message.senderRole !== connectionStore.role) {
      unreadCount.value += 1;
    }

    // 限制消息歷史記錄長度，防止佔用過多內存
    if (messages.value.length > 200) {
      messages.value = messages.value.slice(-200);
    }
  };
  
  // 添加消息並同步到其他窗口
  const addMessage = (message) => {
    addMessageLocal(message);
    
    // 同步到其他窗口
    if (windowSync) {
      windowSync.send('new_message', message);
    }
  };

  // 已處理的消息ID集合，用於去重
  const processedMessageIds = new Set();

  // 發送消息
  const sendMessage = (content, customMessageId = null) => {
    if (!content || !content.trim() || !messageService) return false;
    
    // 使用自定義ID或生成新ID
    const messageId = customMessageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const trimmedContent = content.trim();
    
    // 記錄此 ID 為已處理，避免後續重複處理
    processedMessageIds.add(messageId);
    
    // 使用消息服務發送
    const success = messageService.sendMessage(trimmedContent, messageId);
    
    if (success) {
      // 在這裡不添加消息到本地，因為消息會從 handleIncomingMessage 被處理
      // 即使是自己發送的消息，也會通過 WebRTC 數據通道的 loopback 收到
      console.log('消息發送成功，等待數據通道回送，ID:', messageId);
    }
    
    return success;
  };

  // 處理收到的消息
  const handleIncomingMessage = (message) => {
    if (message && message.type === 'chat_message') {
      // 檢查是否已處理過該消息ID，避免重複
      if (message.id && processedMessageIds.has(message.id)) {
        console.log(`跳過已處理的消息 ID: ${message.id}`);
        return true;
      }
      
      // 記錄已處理的消息ID
      if (message.id) {
        processedMessageIds.add(message.id);
        
        // 設置一個計時器清理舊的ID記錄，避免無限增長
        setTimeout(() => {
          processedMessageIds.delete(message.id);
        }, 60000); // 60秒後清理
      }
      
      addMessage(message);
      return true;
    }
    return false;
  };

  // 切換聊天窗口的最小化狀態
  const toggleMinimized = () => {
    isMinimized.value = !isMinimized.value;
    
    // 如果打開聊天窗口，標記所有消息為已讀並重置未讀計數
    if (!isMinimized.value) {
      markAllAsReadAndSync();
    }
    
    // 注意：不再同步最小化狀態，讓每個窗口保持獨立
  };
  
  // 標記所有消息為已讀並同步
  const markAllAsReadAndSync = () => {
    markAllAsRead();
    
    // 同步到其他窗口
    if (windowSync) {
      windowSync.send('read_messages', {});
    }
  };

  // 清空消息歷史
  const clearMessages = () => {
    messages.value = [];
    unreadCount.value = 0;
    
    // 同步到其他窗口
    if (windowSync) {
      windowSync.send('sync_messages', { messages: [] });
      windowSync.send('sync_unread', { count: 0 });
    }
  };

  // 初始化聊天功能
  const initChat = (options = {}) => {
    try {
      // 判斷是否為彈出窗口模式
      const isPopupMode = options.isPopupMode === true;
      
      if (!isPopupMode) {
        // 主視窗模式：初始化消息服務
        if (initMessageService()) {
          console.log('聊天消息服務初始化成功');
          // 將 messageService 暴露給外部使用
          window.messageService = messageService;
        } else {
          console.error('聊天消息服務初始化失敗');
          return false;
        }
      } else {
        // 彈出窗口模式：跳過消息服務初始化，僅依賴窗口同步
        console.log('彈出窗口模式：跳過消息服務初始化');
      }
      
      // 初始化跨窗口同步 (可選，在彈出窗口中可以禁用)
      if (options.enableWindowSync !== false) {
        initWindowSync();
        console.log('跨窗口同步服務初始化成功');
      }
      
      return true;
    } catch (error) {
      console.error('初始化聊天功能失敗:', error);
      return false;
    }
  };

  // 標記所有消息為已讀 (僅本地)
  const markAllAsRead = () => {
    messages.value.forEach(msg => {
      msg.read = true;
    });
    unreadCount.value = 0;
  };

  // 檢查是否有未讀消息
  const hasUnreadMessages = computed(() => unreadCount.value > 0);
  
  // 清理資源
  const cleanup = () => {
    if (messageService) {
      messageService.disconnect();
      messageService = null;
    }
    
    if (windowSync) {
      windowSync.destroy();
      windowSync = null;
    }
  };
  
  // 請求與主窗口同步
  const requestSync = () => {
    if (windowSync) {
      windowSync.requestSync();
    }
  };

  // 從另一個窗口接收消息（用於彈出窗口）
  const addMessageFromOtherWindow = (content, messageId = null) => {
    if (!content || !content.trim()) return false;
    
    // 使用提供的ID或生成新ID
    const actualMessageId = messageId || `msg_${Date.now()}_popup_${Math.random().toString(36).substr(2, 9)}`;
    
    // 檢查是否已處理過該消息ID
    if (processedMessageIds.has(actualMessageId)) {
      console.log(`跳過已處理的彈出窗口消息 ID: ${actualMessageId}`);
      return false;
    }
    
    console.log('從彈出窗口添加消息:', content, 'ID:', actualMessageId);
    console.log('當前角色:', connectionStore.role);
    
    // 記錄已處理的消息ID
    processedMessageIds.add(actualMessageId);
    
    // 創建消息對象
    const message = {
      id: actualMessageId,
      content: content.trim(),
      timestamp: Date.now(),
      senderRole: connectionStore.role,
      read: true,
      fromPopup: true // 標記此消息來自彈出窗口
    };
    
    // 添加到本地消息列表
    addMessageLocal(message);
    return true;
  };
  
  // 從主窗口同步聊天數據
  const syncFromMainWindow = (chatData) => {
    if (!chatData) return;
    
    // 同步消息
    if (chatData.messages && Array.isArray(chatData.messages)) {
      // 保留 senderRole 不變，確保消息的發送方顯示正確
      messages.value = chatData.messages.map(msg => ({
        ...msg,
        // 確保彈出窗口中訊息顯示正確所需的屬性
        read: msg.read || false
      }));
    }
    
    // 同步未讀數量
    if (typeof chatData.unreadCount === 'number') {
      unreadCount.value = chatData.unreadCount;
    }
    
    console.log('已從主窗口同步數據:',
      `${chatData.messages ? chatData.messages.length : 0} 條消息`,
      `${chatData.unreadCount || 0} 條未讀`);
      
    // 檢查角色是否正確同步
    console.log('同步後角色狀態:', connectionStore.role);
    
    // 輸出幾個消息示例進行確認
    if (chatData.messages && chatData.messages.length > 0) {
      console.log('消息示例:');
      chatData.messages.slice(-3).forEach((msg, idx) => {
        console.log(`消息 ${idx + 1}:`, {
          id: msg.id,
          content: msg.content.substring(0, 20) + (msg.content.length > 20 ? '...' : ''),
          senderRole: msg.senderRole,
          myRole: connectionStore.role,
          isMyMessage: msg.senderRole === connectionStore.role
        });
      });
    }
  };

  return {
    messages,
    unreadCount,
    isMinimized,
    sendMessage,
    handleIncomingMessage,
    toggleMinimized,
    clearMessages,
    initChat,
    markAllAsRead,
    markAllAsReadAndSync,
    hasUnreadMessages,
    cleanup,
    requestSync,
    addMessageFromOtherWindow,
    syncFromMainWindow,
    messageService  // 暴露消息服務，以便可以直接從彈出窗口訪問
  };
});