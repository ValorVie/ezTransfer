<template>
  <div class="receive-page">
    <!-- 聊天界面 -->
    <ChatInterface v-if="connectionStore.status === 'connected'" />
    <div class="text-center mb-4">
      <h1>接收檔案</h1>
      <p class="text-secondary mb-4">取得連接代碼，分享給發送者以接收檔案</p>
    </div>

    <div class="row justify-content-center">
      <div class="col-md-8 col-lg-6">
        <div class="card shadow-sm">
          <div class="card-body p-4">
            <ConnectionStatus 
              :status="connectionStore.status" 
              :errorMessage="connectionStore.errorMessage" 
              class="mb-4" 
            />
            
            <template v-if="connectionStore.status === 'disconnected'">
              <div class="text-center mb-4">
                <button 
                  @click="startReceiving" 
                  class="btn btn-primary btn-lg"
                  :disabled="connectionStore.isLoading"
                >
                  <i class="bi bi-qr-code me-2"></i>
                  <span v-if="connectionStore.isLoading">
                    <i class="bi bi-arrow-repeat spin me-2"></i>取得連接代碼中...
                  </span>
                  <span v-else>取得連接代碼</span>
                </button>
              </div>
            </template>
            
            <template v-else-if="connectionStore.status === 'awaiting_connection' && connectionStore.connectionCode">
              <div class="text-center mb-4">
                <h4>您的連接代碼</h4>
                <p class="text-secondary small mb-3">將此代碼提供給發送方以建立連接</p>
                <div class="connection-code my-4">{{ connectionStore.connectionCode }}</div>
                <button 
                  @click="copyCodeToClipboard" 
                  class="btn btn-outline-primary"
                >
                  <i class="bi bi-clipboard me-2"></i>複製代碼
                </button>
              </div>
              
              <div class="alert alert-info d-flex align-items-center">
                <i class="bi bi-info-circle me-2"></i>
                <div>等待發送方連接中，請勿關閉此視窗...</div>
              </div>
            </template>
            
            <template v-else-if="connectionStore.status === 'connected'">
              <div class="text-center mb-4">
                <div class="alert alert-success">
                  <i class="bi bi-check-circle me-2"></i>連接成功！等待檔案傳輸...
                </div>
              </div>
            </template>
            
            <!-- 傳輸進度區域 -->
            <div v-if="transferStore.isReceiving || transferStore.isProcessingQueue">
              <!-- 整體進度 -->
              <div v-if="transferStore.fileQueue.length > 1" class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <span>總進度 ({{ transferStore.currentQueueIndex + 1 }}/{{ transferStore.fileQueue.length }})</span>
                  <span>{{ transferStore.overallProgressPercentage }}%</span>
                </div>
                <div class="progress mb-3">
                  <div 
                    class="progress-bar bg-success" 
                    role="progressbar" 
                    :style="{ width: `${transferStore.overallProgressPercentage}%` }" 
                    :aria-valuenow="transferStore.overallProgressPercentage" 
                    aria-valuemin="0" 
                    aria-valuemax="100"
                  ></div>
                </div>
                
                <div v-if="transferStore.remainingFiles > 0" class="small text-muted mb-3">
                  剩餘 {{ transferStore.remainingFiles }} 個檔案等待接收
                </div>
              </div>
              
              <!-- 傳輸控制按鈕 -->
              <div class="d-flex justify-content-end mb-2">
                <div class="btn-group" role="group">
                  <button
                    v-if="!transferStore.isPaused"
                    @click="pauseTransfer"
                    class="btn btn-sm btn-outline-warning me-2"
                    title="暫停傳輸"
                  >
                    <i class="bi bi-pause-fill me-1"></i>暫停
                  </button>
                  <button
                    v-else
                    @click="resumeTransfer"
                    class="btn btn-sm btn-outline-success me-2"
                    title="恢復傳輸"
                  >
                    <i class="bi bi-play-fill me-1"></i>恢復
                  </button>
                  <button
                    @click="cancelCurrentTransfer"
                    class="btn btn-sm btn-outline-danger"
                    title="取消當前傳輸"
                  >
                    <i class="bi bi-x-circle me-1"></i>取消
                  </button>
                </div>
              </div>
              
              <!-- 當前檔案進度 -->
              <FileTransferProgress
                v-if="transferStore.currentFile"
                :fileName="transferStore.currentFile.name"
                :fileSize="transferStore.currentFile.size"
                :received="transferStore.bytesReceived"
                :speed="transferStore.transferSpeed"
                :progress="transferStore.progressPercentage"
              />
              
              <!-- 待接收檔案列表 -->
              <div v-if="transferStore.isProcessingQueue && transferStore.fileQueue.length > (transferStore.currentQueueIndex + 1)" class="mt-3">
                <h6>待接收檔案</h6>
                <div class="pending-files" style="max-height: 200px; overflow-y: auto;">
                  <div
                    v-for="(file, index) in transferStore.fileQueue.slice(transferStore.currentQueueIndex + 1)"
                    :key="index"
                    class="file-item d-flex align-items-center py-2 border-bottom"
                  >
                    <i class="bi bi-file-earmark file-icon me-2"></i>
                    <div class="file-info flex-grow-1">
                      <div class="file-name">{{ file.name }}</div>
                      <div class="file-meta small text-muted">{{ formatFileSize(file.size) }}</div>
                    </div>
                    <div class="file-actions">
                      <button
                        @click="cancelQueuedFile(transferStore.currentQueueIndex + 1 + index)"
                        class="btn btn-sm btn-outline-danger ms-2"
                        title="取消這個檔案的傳輸"
                      >
                        <i class="bi bi-x-circle"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 已取消檔案列表 -->
            <template v-if="transferStore.cancelledFiles.length > 0">
              <div class="mt-4">
                <h5>已取消檔案</h5>
                <div class="cancelled-files">
                  <div
                    v-for="(file, index) in transferStore.cancelledFiles"
                    :key="index"
                    class="file-item d-flex align-items-center py-2 border-bottom"
                  >
                    <i class="bi bi-file-earmark-x file-icon me-2 text-danger"></i>
                    <div class="file-info flex-grow-1">
                      <div class="file-name">{{ file.name }}</div>
                      <div class="file-meta small text-muted">
                        {{ formatFileSize(file.size) }} - 
                        <span class="text-danger">已取消</span>
                        <span v-if="file.cancelledAt" class="ms-2">
                          ({{ new Date(file.cancelledAt).toLocaleTimeString() }})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            
            <template v-if="transferStore.completedFiles.length > 0">
              <div class="mt-4">
                <h5>已接收檔案</h5>
                <ReceivedFilesList :files="transferStore.completedFiles" />
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import { useConnectionStore } from '~/stores/connection';
import { useTransferStore } from '~/stores/transfer';
import { useChatStore } from '~/stores/chat';

const connectionStore = useConnectionStore();
const transferStore = useTransferStore();

// 當組件掛載時重置當前連接狀態
onMounted(() => {
  connectionStore.reset();
  transferStore.reset();
});

// 組件銷毀前斷開連接
onBeforeUnmount(() => {
  connectionStore.disconnect();
});

// 開始接收檔案流程
const startReceiving = async () => {
  await connectionStore.startAsReceiver();
};

// 取消當前傳輸
const cancelCurrentTransfer = () => {
  transferStore.cancelCurrentTransfer();
};

// 暫停當前傳輸
const pauseTransfer = () => {
  transferStore.pauseTransfer();
};

// 恢復當前傳輸
const resumeTransfer = () => {
  transferStore.resumeTransfer();
};

// 取消指定檔案的傳輸
const cancelQueuedFile = (index) => {
  transferStore.cancelFileTransfer(index);
};

// 格式化檔案大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 複製連接代碼到剪貼簿
const copyCodeToClipboard = () => {
  if (connectionStore.connectionCode) {
    navigator.clipboard.writeText(connectionStore.connectionCode)
      .then(() => {
        // 可以在這裡添加複製成功的提示
        alert('代碼已複製到剪貼簿');
      })
      .catch(err => {
        console.error('無法複製代碼：', err);
      });
  }
};
</script>

<style scoped>
.receive-page {
  animation: fadeIn 0.6s ease-in-out;
}

.connection-code {
  font-family: 'Courier New', monospace;
  font-size: 2rem;
  letter-spacing: 0.5rem;
  font-weight: bold;
  padding: 0.5rem;
  background-color: #f8f9fa;
  border-radius: 0.25rem;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 1s linear infinite;
  display: inline-block;
}
</style>