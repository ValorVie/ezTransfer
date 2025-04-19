<template>
  <div class="chat-wrapper" :class="{'minimized': chatStore.isMinimized}">
    <!-- 聊天標題欄 - 點擊可最小化/最大化 -->
    <div class="chat-header">
      <h3 @click="chatStore.toggleMinimized" style="cursor: pointer;">即時聊天</h3>
      <div class="header-actions">
        <span v-if="chatStore.unreadCount > 0" class="unread-badge">{{ chatStore.unreadCount }}</span>
        <button class="btn-icon-window" title="在新視窗開啟" @click="openInNewWindow">
          <i class="bi bi-box-arrow-up-right"></i>
        </button>
        <button class="btn-toggle" @click="chatStore.toggleMinimized">
          {{ chatStore.isMinimized ? '⬆️' : '⬇️' }}
        </button>
      </div>
    </div>
    
    <!-- 聊天主體區域 - 最小化時隱藏 -->
    <div v-show="!chatStore.isMinimized" class="chat-body">
      <!-- 消息區域 -->
      <div class="messages-container" ref="messagesContainer">
        <div v-if="chatStore.messages.length === 0" class="empty-state">
          <p>尚無消息，開始聊天吧！</p>
        </div>
        
        <div
          v-for="message in chatStore.messages"
          :key="message.id"
          class="message"
          :class="[message.senderRole === connectionStore.role ? 'sent' : 'received']"
        >
          <div class="message-content" v-html="renderMarkdown(message.content)"></div>
          <div class="message-time">{{ formatTime(message.timestamp) }}</div>
        </div>
      </div>
      
      <!-- 輸入區域 -->
      <div class="input-container">
        <div class="message-tools">
          <button @click="toggleEmojiPicker" class="btn-icon" title="插入表情符號">
            <span style="font-size: 0.9rem;">😊</span>
          </button>
          <button @click="toggleMarkdownHelp" class="btn-icon" title="Markdown 語法幫助">
            <span style="font-size: 0.8rem; display: inline-block;transform: translateX(3px);">M↓</span>
          </button>
        </div>
        
        <!-- 表情符號選擇器 -->
        <div v-show="showEmojiPicker" class="emoji-picker-container" ref="emojiPickerContainer">
          <div class="popup-header">
            <span>表情符號</span>
            <button class="btn-close-popup" @click="showEmojiPicker = false">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <!-- emoji-picker將在JavaScript中動態添加 -->
        </div>
        
        <!-- Markdown 幫助面板 -->
        <div v-if="showMarkdownHelp" class="markdown-help-panel">
          <div class="popup-header">
            <span>Markdown 語法</span>
            <button class="btn-close-popup" @click="showMarkdownHelp = false">
              <i class="bi bi-x"></i>
            </button>
          </div>
          <ul class="markdown-tips">
            <li><code>**粗體**</code> - <strong>粗體</strong></li>
            <li><code>*斜體*</code> - <em>斜體</em></li>
            <li><code>[連結](https://example.com)</code> - <a href="#">連結</a></li>
            <li><code>![圖片說明](圖片URL)</code> - 圖片</li>
            <li><code>```代碼塊```</code> - 代碼塊</li>
            <li><code>`行內代碼`</code> - <code>行內代碼</code></li>
            <li><code>> 引用</code> - 引用文字</li>
          </ul>
        </div>
        
        <textarea
          v-model="newMessage"
          placeholder="輸入消息... (支援 Markdown 語法, Shift+Enter 換行)"
          @keydown="handleKeyDown"
          ref="messageInput"
          rows="1"
          class="chat-textarea"
        ></textarea>
        <button @click="sendMessage" :disabled="!newMessage.trim()">發送</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useChatStore } from '~/stores/chat';
import { useConnectionStore } from '~/stores/connection';
import { useThemeStore } from '~/stores/theme';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

// 獲取 stores
const chatStore = useChatStore();
const connectionStore = useConnectionStore();
const themeStore = useThemeStore();

// 計算當前是否為暗色主題
const isDarkMode = computed(() => themeStore.isDark);
const iconColor = computed(() => isDarkMode.value ? '#e0e0e0' : 'inherit')

// 本地狀態
const newMessage = ref('');
const messagesContainer = ref(null);
const messageInput = ref(null);
const showEmojiPicker = ref(false);
const showMarkdownHelp = ref(false);
const emojiPickerContainer = ref(null);
let emojiPicker = null; // 將在mounted中初始化

// 初始化 Markdown 解析器
const md = new MarkdownIt({
  html: false,         // 禁用 HTML 標籤
  breaks: true,        // 將換行符轉換為 <br>
  linkify: true,       // 自動轉換 URL 為鏈接
  typographer: true    // 啟用一些語言中性的替換和引號
});

// 安全地渲染 Markdown
const renderMarkdown = (text) => {
  if (!text) return '';
  try {
    const rendered = md.render(text);
    return DOMPurify.sanitize(rendered);
  } catch (error) {
    console.error('Markdown 渲染錯誤:', error);
    return text; // 如果渲染失敗，返回原始文本
  }
};

// 切換表情符號選擇器顯示
const toggleEmojiPicker = () => {
  showEmojiPicker.value = !showEmojiPicker.value;
  if (showEmojiPicker.value) {
    showMarkdownHelp.value = false; // 關閉 Markdown 幫助
  }
};

// 切換 Markdown 幫助面板
const toggleMarkdownHelp = () => {
  showMarkdownHelp.value = !showMarkdownHelp.value;
  if (showMarkdownHelp.value) {
    showEmojiPicker.value = false; // 關閉表情符號選擇器
  }
};

// 處理表情符號選擇
const handleEmojiSelect = (event) => {
  const emoji = event.detail.unicode;
  
  // 在當前光標位置插入表情符號
  if (messageInput.value) {
    const cursorPosition = messageInput.value.selectionStart;
    const textBeforeCursor = newMessage.value.substring(0, cursorPosition);
    const textAfterCursor = newMessage.value.substring(cursorPosition);
    
    newMessage.value = textBeforeCursor + emoji + textAfterCursor;
    
    // 重設光標位置
    nextTick(() => {
      messageInput.value.focus();
      messageInput.value.selectionStart = cursorPosition + emoji.length;
      messageInput.value.selectionEnd = cursorPosition + emoji.length;
    });
    
    // 選擇表情符號後自動關閉選擇器
    showEmojiPicker.value = false;
  }
};

// 處理鍵盤事件
const handleKeyDown = (event) => {
  // 如果按下 Enter 但沒有按 Shift，則發送消息
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault(); // 阻止默認的換行行為
    sendMessage();
  }
  // 如果按下 Shift+Enter，則允許換行（默認行為）
};

// 在新視窗開啟聊天
const openInNewWindow = () => {
  // 使用 Nuxt 頁面路由打開聊天窗口
  const chatWindow = window.open('/chat-popup', 'chat_window', 'width=500,height=600');
  if (!chatWindow) {
    alert('無法開啟彈出視窗，請檢查您的瀏覽器設定是否允許彈出視窗。');
    return;
  }
  
  // 創建一個集合用於跟踪已處理的消息ID
  const processedMessageIds = new Set();
  
  // 設置一個函數用於清理過期的消息ID
  const cleanupProcessedIds = () => {
    // 每分鐘清理一次
    setInterval(() => {
      console.log(`清理過期的消息ID (當前數量: ${processedMessageIds.size})`);
      processedMessageIds.clear();
    }, 60000);
  };
  
  // 啟動清理
  cleanupProcessedIds();
  
  // 創建一個事件處理器來監聽新窗口的消息
  const messageHandler = (event) => {
    if (event.source !== chatWindow) return;
    
    const { type, content } = event.data;
    
    if (type === 'chat_popup_ready') {
      console.log('聊天窗口已準備就緒');
      
      // 發送當前聊天數據到彈出窗口進行初始同步
      setTimeout(() => {
        // 創建純JavaScript對象的深拷貝，去除Vue響應式屬性
        const messagesCopy = chatStore.messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          timestamp: msg.timestamp,
          senderRole: msg.senderRole,
          read: msg.read || false
        }));
        
        chatWindow.postMessage({
          type: 'sync_data',
          chatData: {
            messages: messagesCopy,
            unreadCount: chatStore.unreadCount
          }
        }, '*');
        console.log('已發送聊天數據到彈出窗口');
      }, 500); // 延遲確保彈出窗口已完成初始化
    }
    else if (type === 'chat_message') {
      // 從新窗口收到消息，使用主窗口的WebRTC連接發送出去
      console.log('收到彈出窗口發送的消息:', content);
      
      // 檢查消息ID，避免重複處理
      if (event.data.messageId && processedMessageIds.has(event.data.messageId)) {
        console.log('跳過重複消息 ID:', event.data.messageId);
        return;
      }
      
      // 記錄已處理的消息ID
      if (event.data.messageId) {
        processedMessageIds.add(event.data.messageId);
        console.log('記錄處理的消息 ID:', event.data.messageId);
      }
      
      if (connectionStore.status === 'connected') {
        // 使用主窗口的WebRTC連接發送消息
        if (chatStore.messageService) {
          // 使用接收到的消息ID或創建新ID
          const messageId = event.data.messageId || `msg_popup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // 直接發送消息
          const success = chatStore.sendMessage(content, messageId);
          console.log('主窗口發送彈出窗口消息結果:', success, 'ID:', messageId);
          
          // 如果成功，確保將消息同步回彈出窗口
          if (success) {
            setTimeout(() => {
              // 創建一個新的消息對象
              const syncMessage = {
                id: messageId,
                content: content.trim(),
                timestamp: Date.now(),
                senderRole: connectionStore.role,
                read: true
              };
              
              // 將消息同步回彈出窗口
              chatWindow.postMessage({
                type: 'new_message',
                message: syncMessage
              }, '*');
              
              console.log('已將消息同步回彈出窗口, ID:', messageId);
            }, 200); // 稍微延遲以確保先發送
          }
          
          // 如果成功，我們可以手動添加一個本地消息，確保彈出窗口同步
          if (success) {
            // 創建一個從當前用戶發送的消息
            const message = {
              id: messageId,
              content: content.trim(),
              timestamp: Date.now(),
              senderRole: connectionStore.role,
              read: true,
              fromMainWindow: true
            };
            
            // 添加到聊天記錄
            chatStore.addMessage(message);
          }
        } else {
          // 回退到使用 store 方法
          chatStore.sendMessage(content);
        }
      } else {
        console.warn('主窗口WebRTC未連接，無法發送消息');
        // 發送錯誤信息回彈出窗口
        chatWindow.postMessage({
          type: 'error',
          message: '目前沒有與對方的連接，無法發送消息'
        }, '*');
      }
    }
    else if (type === 'request_status') {
      // 彈出窗口請求連接狀態
      chatWindow.postMessage({
        type: 'connection_status',
        status: connectionStore.status,
        role: connectionStore.role || 'sender' // 確保始終有角色信息
      }, '*');
      console.log('已發送連接狀態到彈出窗口:', {
        status: connectionStore.status,
        role: connectionStore.role || 'sender'
      });
    }
  };
  
  // 註冊事件處理器
  window.addEventListener('message', messageHandler);
  
  // 檢測窗口關閉
  const checkWindowClosed = setInterval(() => {
    if (chatWindow.closed) {
      clearInterval(checkWindowClosed);
      window.removeEventListener('message', messageHandler);
      console.log('聊天窗口已關閉，清理資源');
    }
  }, 1000);
  
  // 監聽消息變化，將新消息同步到彈出窗口
  const messageWatcher = watch(() => chatStore.messages, (newMessages, oldMessages) => {
    if (chatWindow.closed) {
      // 彈出窗口已關閉，停止監聽
      messageWatcher();
      return;
    }
    
    if (newMessages.length > oldMessages.length) {
      // 有新消息，同步到彈出窗口
      const newMessage = newMessages[newMessages.length - 1];
      if (!newMessage.fromPopup) { // 避免發送來自彈出窗口的消息回彈出窗口
        // 創建純JavaScript對象的深拷貝，去除Vue響應式屬性
        const messageCopy = {
          id: newMessage.id,
          content: newMessage.content,
          timestamp: newMessage.timestamp,
          senderRole: newMessage.senderRole,
          read: newMessage.read || false
        };
        
        chatWindow.postMessage({
          type: 'new_message',
          message: messageCopy
        }, '*');
      }
    }
  }, { deep: true });
  
  // 返回清理函數，以便在組件銷毀時調用
  return () => {
    messageWatcher();
    window.removeEventListener('message', messageHandler);
    clearInterval(checkWindowClosed);
  };
};

// 格式化時間
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// 發送消息方法
const sendMessage = () => {
  if (!newMessage.value.trim()) return;
  
  const success = chatStore.sendMessage(newMessage.value);
  if (success) {
    newMessage.value = '';
    // 聚焦輸入框，方便繼續輸入
    if (messageInput.value) {
      messageInput.value.focus();
    }
  }
};

// 監視消息變化，自動滾動到最新消息
watch(() => chatStore.messages.length, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
});

// 當聊天窗口打開時聚焦輸入框
watch(() => chatStore.isMinimized, (isMinimized) => {
  if (!isMinimized) {
    nextTick(() => {
      if (messageInput.value) {
        messageInput.value.focus();
      }
    });
  }
});

// 初始化
onMounted(() => {
  // 初始化聊天功能 (主窗口模式)
  chatStore.initChat({
    enableWindowSync: true // 啟用跨窗口同步
  });
  
  // 動態導入並初始化emoji-picker-element
  import('emoji-picker-element').then(() => {
    // 確保container存在
    if (emojiPickerContainer.value) {
      // 創建emoji-picker元素
      emojiPicker = document.createElement('emoji-picker');
      // 添加到容器
      emojiPickerContainer.value.appendChild(emojiPicker);
      // 添加事件監聽器
      emojiPicker.addEventListener('emoji-click', handleEmojiSelect);
    }
  }).catch(error => {
    console.error('無法加載表情符號選擇器:', error);
  });
});

// 組件銷毀時清理
onUnmounted(() => {
  // 清理emoji picker事件監聽器
  if (emojiPicker) {
    emojiPicker.removeEventListener('emoji-click', handleEmojiSelect);
    if (emojiPickerContainer.value && emojiPickerContainer.value.contains(emojiPicker)) {
      emojiPickerContainer.value.removeChild(emojiPicker);
    }
    emojiPicker = null;
  }
  
  // 清理聊天資源
  chatStore.cleanup();
});
</script>

<style scoped>
.chat-wrapper {
  position: fixed;
  bottom: 0;
  right: 20px;
  width: 320px;
  border-radius: 8px 8px 0 0;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.2);
  background-color: v-bind('isDarkMode ? "#2c2c2c" : "#fff"');
  color: v-bind('isDarkMode ? "#e0e0e0" : "#212529"');
  transition: all 0.3s ease;
  z-index: 1000;
  overflow: hidden;
  max-height: 50vh;
  display: flex;
  flex-direction: column;
}

.chat-wrapper.minimized {
  max-height: 40px;
}

.chat-header {
  padding: 8px 15px;
  background-color: v-bind('isDarkMode ? "#1a1a1a" : "#007bff"');
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-header h3 {
  margin: 0;
  font-size: 1rem;
}

.header-actions {
  display: flex;
  align-items: center;
}

.unread-badge {
  background-color: #f03e3e;
  color: white;
  border-radius: 50%;
  min-width: 20px;
  height: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 0.75rem;
  margin-right: 10px;
  padding: 0 4px;
}

.btn-toggle {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  padding: 0;
  font-size: 1rem;
}

.chat-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 300px;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: #888;
  text-align: center;
  padding: 20px;
}

.message {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 12px;
  position: relative;
  margin-bottom: 4px;
  word-wrap: break-word;
}

.message.sent {
  align-self: flex-end;
  background-color: v-bind('isDarkMode ? "#0056b3" : "#007bff"');
  color: white;
  border-bottom-right-radius: 4px;
}

.message.received {
  align-self: flex-start;
  background-color: v-bind('isDarkMode ? "#3e3e3e" : "#f1f3f5"');
  color: v-bind('isDarkMode ? "#e0e0e0" : "#212529"');
  border-bottom-left-radius: 4px;
}

.message-content {
  margin-bottom: 4px;
}

.message-time {
  font-size: 0.7rem;
  text-align: right;
  opacity: 0.8;
}

.input-container {
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px;
  border-top: 1px solid v-bind('isDarkMode ? "#444" : "#e5e5e5"');
}

.message-tools {
  position: absolute;
  top: -30px;
  left: 10px;
  display: flex;
  gap: 5px;
}

.btn-icon {
  background: v-bind('isDarkMode ? "#333" : "#f1f3f5"');
  border: none;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.btn-icon:hover {
  opacity: 1;
}

.btn-icon-window {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  padding: 0 5px;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon-window:hover {
  opacity: 0.8;
}

::v-deep emoji-picker {
  --emoji-size: 1.0rem; /* 依照需要改小，例如 1rem、0.8rem */
  max-height: 25vh;
  --input-padding: 0.2rem 0.4rem;
  --input-font-size: 0.8rem;
  --input-line-height: 1;
}

.emoji-picker-container {
  position: absolute;
  bottom: 100%;
  left: 0;
  z-index: 1000;
  max-height: 40vh;        /* 使用視窗高度限制，而非固定px */
  background-color: v-bind('isDarkMode ? "#333" : "#fff"');
  border: 1px solid v-bind('isDarkMode ? "#444" : "#e5e5e5"');
  border-radius: 5px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
}

.markdown-help-panel {
  position: absolute;
  bottom: 100%;
  left: 40px;
  width: 280px;
  max-height: 300px;
  overflow-y: auto;
  background-color: v-bind('isDarkMode ? "#333" : "#fff"');
  border: 1px solid v-bind('isDarkMode ? "#444" : "#e5e5e5"');
  border-radius: 5px;
  padding: 10px;
  z-index: 100;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
}

.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 10px;
  border-bottom: 1px solid v-bind('isDarkMode ? "#444" : "#e5e5e5"');
  font-weight: bold;
  font-size: 0.9rem;
}

.btn-close-popup {
  background: none;
  border: none;
  color: v-bind('isDarkMode ? "#e0e0e0" : "#212529"');
  cursor: pointer;
  padding: 2px;
  margin: 0;
  font-size: 1rem;
  line-height: 1;
  opacity: 0.7;
}

.btn-close-popup:hover {
  opacity: 1;
  background-color: transparent;
}

.markdown-tips {
  list-style-type: none;
  padding-left: 0;
  margin: 0;
  font-size: 0.8rem;
}

.markdown-tips li {
  margin-bottom: 5px;
}

.chat-textarea {
  flex: 1;
  resize: none;
  border: 1px solid v-bind('isDarkMode ? "#444" : "#dee2e6"');
  border-radius: 5px;
  padding: 8px;
  font-size: 0.9rem;
  min-height: 38px;
  max-height: 150px;
  background-color: v-bind('isDarkMode ? "#222" : "#fff"');
  color: v-bind('isDarkMode ? "#e0e0e0" : "#212529"');
  margin-right: 8px;
}

button {
  color: white;
  background-color: v-bind('isDarkMode ? "#0056b3" : "#007bff"');
  border: none;
  padding: 8px 16px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background-color 0.2s;
}

button:hover {
  background-color: v-bind('isDarkMode ? "#004494" : "#0069d9"');
}

button:disabled {
  background-color: v-bind('isDarkMode ? "#444" : "#6c757d"');
  cursor: not-allowed;
}

/* Markdown 樣式 */
.message-content :deep(a) {
  color: v-bind('isDarkMode ? "#8ab4f8" : "#0d6efd"');
  text-decoration: underline;
}

.message-content :deep(code) {
  padding: 0.2em 0.4em;
  background-color: v-bind('isDarkMode ? "#444" : "rgba(0, 0, 0, 0.05)"');
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.9em;
}

.message-content :deep(pre) {
  background-color: v-bind('isDarkMode ? "#333" : "#f6f8fa"');
  border-radius: 3px;
  padding: 0.5em;
  overflow-x: auto;
  margin: 0.5em 0;
  font-size: 0.9em;
}

.message-content :deep(blockquote) {
  border-left: 4px solid v-bind('isDarkMode ? "#555" : "#ddd"');
  padding-left: 1em;
  margin-left: 0;
  color: v-bind('isDarkMode ? "#aaa" : "#666"');
}

.message-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 5px;
}
</style>