<template>
  <div class="chat-window">
    <div class="chat-header">
      <h3>ezTransfer 聊天</h3>
      <div class="header-actions" v-if="showClose">
        <button class="btn-close" title="關閉視窗" @click="handleClose">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>
    
    <div class="chat-body">
      <!-- 消息區域 -->
      <div class="messages-container" ref="messagesContainer">
        <div v-if="chatStore.messages.length === 0" class="empty-state">
          <p>尚無消息，開始聊天吧！</p>
        </div>
        
        <div
          v-for="message in chatStore.messages"
          :key="message.id"
          class="message"
          :class="{'sent': message.senderRole === connectionStore.role, 'received': message.senderRole !== connectionStore.role}"
          @click="logMessageDetails(message)"
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

// 定義props
const props = defineProps({
  showClose: {
    type: Boolean,
    default: false
  }
});

// 定義事件
const emit = defineEmits(['close']);

// 獲取 stores
const chatStore = useChatStore();
const connectionStore = useConnectionStore();
const themeStore = useThemeStore();

// 計算當前是否為暗色主題
const isDarkMode = computed(() => themeStore.isDark);

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

// 生成唯一消息 ID
const generateMessageId = () => {
  // 使用時間戳和隨機字符串組合成唯一ID
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// 發送消息方法
const sendMessage = () => {
  if (!newMessage.value.trim()) return;
  
  const messageContent = newMessage.value.trim();
  console.log('ChatWindow 嘗試發送訊息:', messageContent);
  
  // 創建唯一消息ID
  const messageId = generateMessageId();
  
  // 判斷是否為彈出窗口
  if (window.opener) {
    console.log('彈出窗口模式，通過 postMessage 發送，ID:', messageId);
    
    // 直接通過 postMessage 發送給主窗口
    window.opener.postMessage({
      type: 'chat_message',
      content: messageContent,
      messageId: messageId,
      timestamp: Date.now(),
      senderRole: connectionStore.role
    }, '*');
    
    // 不在本地添加消息，等待從主窗口同步回來
    // 這樣避免了重複顯示
    console.log('消息已發送到主窗口，等待同步回來', messageId);
    
    // 清空輸入框
    newMessage.value = '';
    if (messageInput.value) {
      messageInput.value.focus();
    }
  } else {
    // 主窗口直接使用 WebRTC 發送
    const success = chatStore.sendMessage(messageContent, messageId);
    console.log('主窗口發送訊息結果:', success);
    
    if (success) {
      newMessage.value = '';
      // 聚焦輸入框，方便繼續輸入
      if (messageInput.value) {
        messageInput.value.focus();
      }
    }
  }
};

// 格式化時間
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// 處理關閉按鈕點擊
const handleClose = () => {
  emit('close');
};

// 監視消息變化，自動滾動到最新消息
watch(() => chatStore.messages.length, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
});

// 初始化
onMounted(() => {
  // 如果是在彈出窗口中，請求與主窗口同步
  if (window.opener) {
    // 記錄當前角色，調試用
    console.log('ChatWindow 初始化，當前角色:', connectionStore.role);
    
    // 嘗試同步數據
    chatStore.requestSync();
    
    // 確保正確顯示聊天氣泡
    console.log('確認消息樣式是否正確應用，自己的角色:', connectionStore.role);
  }
  
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
});
// 用於調試
const logMessageDetails = (message) => {
  console.log('訊息詳情:', {
    id: message.id,
    content: message.content,
    senderRole: message.senderRole,
    myRole: connectionStore.role,
    isMyMessage: message.senderRole === connectionStore.role,
    timestamp: new Date(message.timestamp).toLocaleString(),
    fromPopup: message.fromPopup || false
  });
};
</script>

<style scoped>
.chat-window {
  width: 100%;
  height: 100vh; /* 使用視窗高度單位 */
  display: flex;
  flex-direction: column;
  background-color: v-bind('isDarkMode ? "#2c2c2c" : "#fff"');
  color: v-bind('isDarkMode ? "#e0e0e0" : "#212529"');
  overflow: hidden;
  position: absolute; /* 絕對定位以覆蓋整個視窗 */
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
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

.btn-close {
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
  min-height: 0;
  overflow: hidden;
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
  align-self: flex-end !important;
  background-color: v-bind('isDarkMode ? "#0056b3" : "#007bff"');
  color: white;
  border-bottom-right-radius: 4px;
  margin-left: auto;
  margin-right: 0;
}

.message.received {
  align-self: flex-start !important;
  background-color: v-bind('isDarkMode ? "#3e3e3e" : "#f1f3f5"');
  color: v-bind('isDarkMode ? "#e0e0e0" : "#212529"');
  border-bottom-left-radius: 4px;
  margin-left: 0;
  margin-right: auto;
}

.message-content {
  margin-bottom: 4px;
  max-width: 100%;
  overflow-wrap: break-word;
  word-wrap: break-word;
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
  min-height: 60px;
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