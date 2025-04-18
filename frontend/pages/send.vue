<template>
  <div class="send-page">
    <!-- 聊天界面 -->
    <ChatInterface v-if="connectionStore.status === 'connected'" />
    <div class="text-center mb-4">
      <h1>傳送檔案</h1>
      <p class="text-secondary mb-4">輸入連接代碼將檔案傳送給接收者</p>
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
              <form @submit.prevent="connectToReceiver" class="mb-4">
                <div class="form-group mb-3">
                  <label for="connectionCode" class="form-label">連接代碼</label>
                  <div class="input-group">
                    <input 
                      type="text" 
                      id="connectionCode" 
                      v-model="connectionCode" 
                      class="form-control form-control-lg text-center connection-code-input"
                      placeholder="輸入 6 位數字代碼"
                      :maxlength="6"
                      pattern="[0-9]{6}"
                      :disabled="connectionStore.isLoading"
                      required
                    />
                  </div>
                  <div class="form-text">請輸入接收方提供的 6 位數字連接代碼</div>
                </div>
                
                <div class="d-grid gap-2">
                  <button 
                    type="submit" 
                    class="btn btn-primary btn-lg"
                    :disabled="!isValidCode || connectionStore.isLoading"
                  >
                    <span v-if="connectionStore.isLoading">
                      <i class="bi bi-arrow-repeat spin me-2"></i>連接中...
                    </span>
                    <span v-else>
                      <i class="bi bi-link-45deg me-2"></i>連接
                    </span>
                  </button>
                </div>
              </form>
            </template>
            
            <template v-else-if="connectionStore.status === 'connecting'">
              <div class="alert alert-info d-flex align-items-center">
                <i class="bi bi-hourglass-split me-2"></i>
                <div>正在建立連接，請稍候...</div>
              </div>
            </template>
            
            <template v-else-if="connectionStore.status === 'connected'">
              <div class="alert alert-success mb-4">
                <i class="bi bi-check-circle me-2"></i>連接成功！現在可以開始傳送檔案
              </div>
              
              <div class="file-selection mb-4">
                <label for="fileInput" class="form-label">選擇要傳送的檔案</label>
                <div 
                  class="drop-zone" 
                  :class="{ 'active': isDragging }"
                  @dragover.prevent="isDragging = true"
                  @dragleave.prevent="isDragging = false"
                  @drop.prevent="onFileDrop"
                >
                  <div v-if="selectedFiles.length === 0" class="text-center py-4">
                    <i class="bi bi-cloud-arrow-up" style="font-size: 3rem;"></i>
                    <p class="mb-2 mt-3">拖放檔案至此區域，或</p>
                    <button 
                      @click="triggerFileInput"
                      type="button" 
                      class="btn btn-outline-primary"
                    >
                      <i class="bi bi-folder me-2"></i>瀏覽檔案
                    </button>
                    <input 
                      type="file" 
                      id="fileInput" 
                      ref="fileInput" 
                      @change="onFileSelected" 
                      style="display: none;"
                      multiple
                    />
                  </div>
                  
                  <div v-else class="selected-files py-3">
                    <div class="selected-files-header d-flex justify-content-between align-items-center mb-3">
                      <h6 class="mb-0">已選擇 {{ selectedFiles.length }} 個檔案</h6>
                      <button 
                        @click="selectedFiles = []" 
                        class="btn btn-sm btn-outline-danger"
                        :disabled="transferStore.isSending || transferStore.isProcessingQueue"
                      >
                        <i class="bi bi-trash me-1"></i>清除全部
                      </button>
                    </div>
                    
                    <div class="file-items-container mb-3" style="max-height: 200px; overflow-y: auto;">
                      <div 
                        v-for="(file, index) in selectedFiles" 
                        :key="index" 
                        class="file-item d-flex align-items-center py-2 border-bottom"
                      >
                        <i class="bi bi-file-earmark file-icon me-2"></i>
                        <div class="file-info flex-grow-1">
                          <div class="file-name">{{ file.name }}</div>
                          <div class="file-meta small text-muted">{{ formatFileSize(file.size) }}</div>
                        </div>
                        <button 
                          @click="removeFile(index)" 
                          class="btn btn-sm btn-outline-danger ms-2"
                          :disabled="transferStore.isSending || transferStore.isProcessingQueue"
                        >
                          <i class="bi bi-x"></i>
                        </button>
                      </div>
                    </div>
                    
                    <div class="d-grid">
                      <button 
                        @click="startFileTransfer"
                        class="btn btn-primary"
                        :disabled="transferStore.isSending || transferStore.isProcessingQueue || selectedFiles.length === 0"
                      >
                        <span v-if="transferStore.isSending || transferStore.isProcessingQueue">
                          <i class="bi bi-arrow-repeat spin me-2"></i>傳送中...
                        </span>
                        <span v-else>
                          <i class="bi bi-send me-2"></i>傳送所有檔案
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- 傳輸進度 -->
              <div v-if="transferStore.isProcessingQueue || transferStore.isSending">
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
                    剩餘 {{ transferStore.remainingFiles }} 個檔案等待傳輸
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
                  :sent="transferStore.bytesSent"
                  :speed="transferStore.transferSpeed"
                  :progress="transferStore.progressPercentage"
                />
              </div>
              
              <!-- 待傳輸檔案列表 -->
              <div v-if="transferStore.isProcessingQueue && transferStore.fileQueue.length > (transferStore.currentQueueIndex + 1)" class="mt-3">
                <h6>待傳輸檔案</h6>
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
              
              <div v-if="transferStore.completedFiles.length > 0" class="mt-4">
                <h5>已傳送檔案</h5>
                <SentFilesList :files="transferStore.completedFiles" />
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useConnectionStore } from '~/stores/connection';
import { useTransferStore } from '~/stores/transfer';
import { useChatStore } from '~/stores/chat';

const connectionStore = useConnectionStore();
const transferStore = useTransferStore();

const connectionCode = ref('');
const selectedFiles = ref([]);
const isDragging = ref(false);
const fileInput = ref(null);

const isValidCode = computed(() => {
  return /^\d{6}$/.test(connectionCode.value);
});

// 當組件掛載時重置當前連接狀態
onMounted(() => {
  connectionStore.reset();
  transferStore.reset();
});

// 組件銷毀前斷開連接
onBeforeUnmount(() => {
  connectionStore.disconnect();
});

// 連接到接收者
const connectToReceiver = async () => {
  if (isValidCode.value) {
    await connectionStore.startAsSender(connectionCode.value);
  }
};

// 觸發檔案選擇
const triggerFileInput = () => {
  if (fileInput.value) {
    fileInput.value.click();
  }
};

// 處理檔案選擇事件
const onFileSelected = (event) => {
  const files = event.target.files;
  if (files.length > 0) {
    // 將 FileList 轉換為數組
    selectedFiles.value = Array.from(files);
  }
};

// 處理檔案拖放事件
const onFileDrop = (event) => {
  isDragging.value = false;
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    // 將 FileList 轉換為數組
    selectedFiles.value = Array.from(files);
  }
};

// 從選擇列表中移除檔案
const removeFile = (index) => {
  selectedFiles.value.splice(index, 1);
};

// 從傳輸隊列中移除檔案
const removeFromQueue = (index) => {
  transferStore.removeFileFromQueue(index);
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

// 取消特定檔案傳輸
const cancelQueuedFile = (index) => {
  transferStore.cancelFileTransfer(index);
};

// 開始檔案傳輸
const startFileTransfer = async () => {
  if (selectedFiles.value.length > 0 && connectionStore.status === 'connected') {
    try {
      // 使用新的多檔案傳輸功能
      await transferStore.sendFiles(selectedFiles.value);
    } catch (error) {
      console.error('傳送檔案失敗:', error);
      // 可以在這裡添加錯誤提示
    }
  }
};

// 格式化檔案大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
</script>

<style scoped>
.send-page {
  animation: fadeIn 0.6s ease-in-out;
}

.connection-code-input {
  font-family: 'Courier New', monospace;
  font-size: 1.75rem;
  letter-spacing: 0.5rem;
}

.file-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.file-icon {
  font-size: 1.2rem;
  color: #6c757d;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 0.5rem 0;
}

.file-info {
  margin-left: 0.5rem;
  flex-grow: 1;
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