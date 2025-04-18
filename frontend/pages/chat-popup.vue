<template>
  <ChatWindow :showClose="true" @close="() => window.close()" />
</template>

<script setup>
import ChatWindow from '~/components/ChatWindow.vue'

// 初始化聊天功能
import { useChatStore } from '~/stores/chat';
import { useConnectionStore } from '~/stores/connection';
import { onMounted, onUnmounted, watch } from 'vue';

const chatStore = useChatStore();
const connectionStore = useConnectionStore();

onMounted(() => {
  // 設置窗口標題
  document.title = 'ezTransfer 聊天';
  
  // 輸出連接角色，確認其初始值
  console.log('彈出窗口初始化前連接角色:', connectionStore.role);
  
  // 初始化聊天功能 (彈出窗口模式)
  const success = chatStore.initChat({
    enableWindowSync: true, // 啟用跨窗口同步
    isPopupMode: true // 標記為彈出窗口模式，避免初始化WebRTC
  });
  
  if (success) {
    console.log('彈出窗口初始化完成');
    console.log('初始化後連接角色:', connectionStore.role);
    
    // 主動請求同步數據
    setTimeout(() => {
      chatStore.requestSync();
      console.log('已發送同步請求');
      
      // 確認請求同步後的角色設置
      console.log('同步請求後連接角色:', connectionStore.role);
    }, 300); // 稍微延遲以確保主窗口已經準備好
  } else {
    console.error('彈出窗口初始化失敗');
  }
  
  // 初始化後通知主窗口
  if (window.opener) {
    window.opener.postMessage({ type: 'chat_popup_ready' }, '*');
    console.log('已通知主窗口彈出視窗準備就緒');
    
    // 立即請求連接狀態
    window.opener.postMessage({ type: 'request_status' }, '*');
    console.log('已請求連接狀態');
    
    // 稍後再請求一次連接狀態，以防第一次請求丟失
    setTimeout(() => {
      window.opener.postMessage({ type: 'request_status' }, '*');
      console.log('再次請求連接狀態');
    }, 800);
    
    // 添加一個檢查點，確認消息顯示是否正確
    setTimeout(() => {
      if (chatStore.messages.length > 0) {
        console.log('檢查消息顯示：');
        chatStore.messages.slice(-3).forEach((msg, idx) => {
          console.log(`消息 ${idx + 1}:`, {
            id: msg.id,
            content: msg.content.substring(0, 20) + (msg.content.length > 20 ? '...' : ''),
            senderRole: msg.senderRole,
            myRole: connectionStore.role,
            isMyMessage: msg.senderRole === connectionStore.role,
            cssClass: msg.senderRole === connectionStore.role ? 'sent' : 'received'
          });
        });
      } else {
        console.log('目前沒有消息可以檢查');
      }
    }, 1500);
  }
  
  // 監聽來自主窗口的消息
  window.addEventListener('message', handleMessage);
});

// 避免重複處理的消息ID集合
const processedMessageIds = new Set();

// 確保接收到的訊息被追踪
const trackReceivedMessage = (messageId) => {
  if (messageId) {
    processedMessageIds.add(messageId);
    // 5分鐘後刪除，避免集合無限增長
    setTimeout(() => {
      processedMessageIds.delete(messageId);
    }, 300000);
  }
};

// 監視消息變化，但只用於調試和UI更新
watch(() => chatStore.messages, (newMessages, oldMessages) => {
  // 檢查是否有新消息
  if (newMessages.length > oldMessages.length) {
    const lastMessage = newMessages[newMessages.length - 1];
    console.log('新增消息，ID:', lastMessage.id);
    
    // 記錄消息ID
    trackReceivedMessage(lastMessage.id);
  }
}, { deep: true });

onUnmounted(() => {
  // 清理資源
  chatStore.cleanup();
  window.removeEventListener('message', handleMessage);
});

// 處理來自主窗口的消息
const handleMessage = (event) => {
  if (event.source === window.opener && event.data) {
    const { type, content, message } = event.data;
    
    console.log('彈出窗口收到訊息:', event.data);
    console.log('當前連接角色:', connectionStore.role);
    
    if (type === 'chat_message') {
      // 從主窗口收到新消息，顯示在彈出窗口中
      console.log('彈出窗口收到主窗口消息:', content);
      
      // 更新聊天記錄（避免通過WindowSyncService重複接收）
      if (!chatStore.messages.some(m => m.content === content && m.timestamp > Date.now() - 5000)) {
        chatStore.addMessageFromOtherWindow(content);
      }
    } else if (type === 'sync_data') {
      // 接收同步的整個聊天歷史
      console.log('接收到同步的聊天數據');
      chatStore.syncFromMainWindow(event.data.chatData);
    } else if (type === 'new_message') {
      // 接收單個新消息
      console.log('接收到主窗口的新消息, ID:', message.id);
      
      // 檢查是否已處理過該消息
      if (message.id && processedMessageIds.has(message.id)) {
        console.log('跳過已處理的消息 ID:', message.id);
        return;
      }
      
      // 檢查是否已存在於消息列表中
      if (!chatStore.messages.some(m => m.id === message.id)) {
        // 添加到消息列表
        chatStore.messages.push(message);
        console.log('消息已添加到本地列表');
        
        // 記錄已處理的消息ID
        trackReceivedMessage(message.id);
      } else {
        console.log('消息已存在於列表中，不重複添加');
      }
    } else if (type === 'error') {
      // 顯示錯誤消息
      console.error('主窗口報告錯誤:', event.data.message);
      alert('錯誤: ' + event.data.message);
    } else if (type === 'connection_status') {
      // 更新連接狀態
      console.log('接收到連接狀態更新:', event.data.status);
      console.log('接收到角色更新:', event.data.role);
      
      // 使用新方法更新狀態
      if (event.data.status) {
        connectionStore.setStatus(event.data.status);
      }
      
      // 確保角色設置正確
      if (event.data.role) {
        console.log(`角色設置已從 ${connectionStore.role} 更改為 ${event.data.role}`);
        // 使用新方法設置角色
        const success = connectionStore.setRole(event.data.role);
        console.log('角色更新結果:', success);
        console.log('更新後的角色:', connectionStore.role);
        
        // 強制更新視圖以確保消息顯示正確
        setTimeout(() => {
          if (chatStore.messages.length > 0) {
            console.log('強制更新後的消息顯示狀態:');
            chatStore.messages.slice(-3).forEach((msg, idx) => {
              console.log(`消息 ${idx + 1}:`, {
                content: msg.content.substring(0, 20) + (msg.content.length > 20 ? '...' : ''),
                senderRole: msg.senderRole,
                myRole: connectionStore.role,
                isMyMessage: msg.senderRole === connectionStore.role,
                cssClass: msg.senderRole === connectionStore.role ? 'sent' : 'received'
              });
            });
          }
        }, 100);
      }
    }
  }
};

</script>

<style>
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
}
</style>