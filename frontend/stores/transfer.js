import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useConnectionStore } from './connection';
import { FileHandler } from '~/lib/fileHandler';

export const useTransferStore = defineStore('transfer', () => {
  // 傳輸狀態
  const isSending = ref(false);
  const isReceiving = ref(false);
  const isPaused = ref(false);
  const currentFile = ref(null);
  const bytesSent = ref(0);
  const bytesReceived = ref(0);
  const transferStartTime = ref(0);
  const lastUpdateTime = ref(0);
  const transferSpeed = ref(0);
  const completedFiles = ref([]);
  
  // 新增已取消檔案列表
  const cancelledFiles = ref([]);
  
  // 新增隊列相關狀態
  const fileQueue = ref([]);                 // 檔案隊列
  const currentQueueIndex = ref(-1);         // 當前處理的檔案索引
  const totalQueueSize = ref(0);             // 隊列總大小
  const processedQueueSize = ref(0);         // 已處理的大小
  const isProcessingQueue = ref(false);      // 是否正在處理隊列
  
  // 連接 store
  const connectionStore = useConnectionStore();
  
  // 檔案處理器
  let fileHandler = null;
  
  // 計算傳輸進度百分比
  const progressPercentage = computed(() => {
    if (!currentFile.value) return 0;
    
    const totalBytes = currentFile.value.size;
    const transferredBytes = isSending.value ? bytesSent.value : bytesReceived.value;
    
    if (totalBytes === 0) return 100;
    return Math.floor((transferredBytes / totalBytes) * 100);
  });
  
  // 計算整體進度百分比
  const overallProgressPercentage = computed(() => {
    if (totalQueueSize.value === 0) return 0;
    return Math.floor((processedQueueSize.value / totalQueueSize.value) * 100);
  });
  
  // 計算剩餘檔案數量
  const remainingFiles = computed(() => {
    if (fileQueue.value.length === 0) return 0;
    
    // 計算未處理且未取消的檔案數量
    const valid = fileQueue.value.filter((file, index) => 
      index > currentQueueIndex.value && !file.cancelled
    ).length;
    
    // 如果當前正在傳輸，則加上當前檔案
    return valid + (isSending.value || isReceiving.value ? 1 : 0);
  });
  
  // 重置狀態
  const reset = () => {
    isSending.value = false;
    isReceiving.value = false;
    isPaused.value = false;
    currentFile.value = null;
    bytesSent.value = 0;
    bytesReceived.value = 0;
    transferStartTime.value = 0;
    lastUpdateTime.value = 0;
    transferSpeed.value = 0;
    
    // 重置隊列狀態
    fileQueue.value = [];
    currentQueueIndex.value = -1;
    totalQueueSize.value = 0;
    processedQueueSize.value = 0;
    isProcessingQueue.value = false;
    
    // 不重置 completedFiles 和 cancelledFiles，保留歷史記錄
  };
  
  // 初始化檔案處理器
  const initializeFileHandler = () => {
    if (fileHandler) return;
    
    fileHandler = new FileHandler();
    
    // 設置檔案處理器事件處理函數
    setupFileHandlerEvents();
  };
  
  // 設置檔案處理器事件
  const setupFileHandlerEvents = () => {
    if (!fileHandler) return;
    
    // 傳輸進度更新
    fileHandler.onProgress = (transferred, total) => {
      if (isSending.value) {
        bytesSent.value = transferred;
      } else if (isReceiving.value) {
        bytesReceived.value = transferred;
      }
      
      // 計算傳輸速度
      const now = Date.now();
      if (now - lastUpdateTime.value >= 1000) { // 每秒更新一次速度
        const elapsed = (now - transferStartTime.value) / 1000; // 轉換為秒
        transferSpeed.value = Math.floor(transferred / elapsed);
        lastUpdateTime.value = now;
      }
    };
    
    // 新增：接收到檔案隊列資訊
    fileHandler.onQueueInfo = (queueInfo) => {
      console.log('收到完整檔案隊列資訊:', queueInfo);
      
      // 更新檔案隊列
      fileQueue.value = queueInfo.files;
      totalQueueSize.value = queueInfo.totalSize;
      
      // 標記正在處理隊列
      isProcessingQueue.value = true;
      
      console.log('更新後檔案隊列:', fileQueue.value);
    };
    
    // 傳輸暫停事件處理
    fileHandler.onTransferPaused = (fileInfo) => {
      isPaused.value = true;
      console.log('檔案傳輸已暫停:', fileInfo.name);
    };
    
    // 傳輸恢復事件處理
    fileHandler.onTransferResumed = (fileInfo) => {
      isPaused.value = false;
      console.log('檔案傳輸已恢復:', fileInfo.name);
    };
    
    // 檔案接收完成
    fileHandler.onReceiveComplete = (fileData) => {
      isReceiving.value = false;
      
      // 添加到已完成檔案列表
      completedFiles.value.push({
        name: fileData.name,
        size: fileData.size,
        type: fileData.type,
        blob: fileData.blob,
        receivedAt: Date.now(),
        status: 'received'
      });
      
      // 更新已處理大小
      processedQueueSize.value += fileData.size;
      
      // 重置傳輸狀態
      currentFile.value = null;
      bytesReceived.value = 0;
      transferSpeed.value = 0;
    };
    
    // 檔案傳送完成
    fileHandler.onSendComplete = (fileInfo) => {
      isSending.value = false;
      
      // 添加到已完成檔案列表
      completedFiles.value.push({
        name: fileInfo.name,
        size: fileInfo.size,
        type: fileInfo.type,
        sentAt: Date.now(),
        status: 'sent',
        queueIndex: fileInfo.queueIndex
      });
      
      // 更新已處理大小
      processedQueueSize.value += fileInfo.size;
      
      // 重置傳輸狀態
      currentFile.value = null;
      bytesSent.value = 0;
      transferSpeed.value = 0;
    };
    
    // 檔案接收開始
    fileHandler.onReceiveStart = (fileInfo) => {
      isReceiving.value = true;
      currentFile.value = fileInfo;
      bytesReceived.value = 0;
      transferStartTime.value = Date.now();
      lastUpdateTime.value = Date.now();
    };
    
    // 開始處理隊列中的新檔案
    fileHandler.onFileStart = (file, index, total) => {
      currentFile.value = file;
      currentQueueIndex.value = index;
      
      // 設置傳輸狀態
      if (connectionStore.role === 'sender') {
        isSending.value = true;
        bytesSent.value = 0;
      } else {
        isReceiving.value = true;
        bytesReceived.value = 0;
      }
      
      transferStartTime.value = Date.now();
      lastUpdateTime.value = Date.now();
    };
    
    // 整體隊列進度更新
    fileHandler.onQueueProgress = (processed, total) => {
      processedQueueSize.value = processed;
    };
    
    // 所有檔案處理完成
    fileHandler.onQueueComplete = (files) => {
      isProcessingQueue.value = false;
      fileQueue.value = [];
      currentQueueIndex.value = -1;
    };
    
    // 取消傳輸事件處理
    fileHandler.onTransferCancelled = (fileInfo) => {
      // 更新狀態
      if (isSending.value) {
        isSending.value = false;
      } else if (isReceiving.value) {
        isReceiving.value = false;
      }
      
      // 添加到已取消檔案列表而不是已完成列表
      cancelledFiles.value.push({
        name: fileInfo.name,
        size: fileInfo.size || 0,
        type: fileInfo.type || '',
        cancelledAt: Date.now(),
        status: 'cancelled',
        queueIndex: fileInfo.index
      });
      
      // 重置當前檔案狀態
      currentFile.value = null;
      bytesSent.value = 0;
      bytesReceived.value = 0;
      transferSpeed.value = 0;
    };
    
    // 檔案傳送錯誤
    fileHandler.onError = (error) => {
      console.error('檔案傳輸錯誤:', error);
      reset();
    };
  };
  
  // 傳送單個檔案
  const sendFile = async (file) => {
    try {
      if (!file || isSending.value || isReceiving.value) return;
      
      const webRTCManager = connectionStore.getWebRTCManager();
      if (!webRTCManager || !webRTCManager.isConnected()) {
        throw new Error('尚未建立連接，無法傳送檔案');
      }
      
      // 初始化檔案處理器
      initializeFileHandler();
      
      // 設置傳輸狀態
      isSending.value = true;
      currentFile.value = file;
      bytesSent.value = 0;
      transferStartTime.value = Date.now();
      lastUpdateTime.value = Date.now();
      
      // 開始檔案傳輸
      await fileHandler.sendFile(file, webRTCManager.getDataChannel());
      
      return true;
    } catch (error) {
      console.error('傳送檔案失敗:', error);
      isSending.value = false;
      throw error;
    }
  };
  
  // 傳送多個檔案
  const sendFiles = async (files) => {
    try {
      if (!files || files.length === 0 || isSending.value || isReceiving.value) return;
      
      const webRTCManager = connectionStore.getWebRTCManager();
      if (!webRTCManager || !webRTCManager.isConnected()) {
        throw new Error('尚未建立連接，無法傳送檔案');
      }
      
      // 初始化檔案處理器
      initializeFileHandler();
      
      // 設置檔案隊列
      fileQueue.value = [...files];
      totalQueueSize.value = files.reduce((total, file) => total + file.size, 0);
      processedQueueSize.value = 0;
      currentQueueIndex.value = -1;
      isProcessingQueue.value = true;
      
      // 設置檔案處理器的隊列
      fileHandler.setFileQueue(files);
      
      // 開始處理隊列
      await fileHandler.processFileQueue(webRTCManager.getDataChannel());
      
      return true;
    } catch (error) {
      console.error('傳送檔案失敗:', error);
      isProcessingQueue.value = false;
      reset();
      throw error;
    }
  };
  
  // 取消當前傳輸
  const cancelCurrentTransfer = () => {
    if (!fileHandler) return false;
    
    const webRTCManager = connectionStore.getWebRTCManager();
    if (!webRTCManager || !webRTCManager.isConnected()) {
      return false;
    }
    
    console.log('準備取消傳輸，當前索引:', currentQueueIndex.value);
    
    try {
      // 通知對方取消傳輸
      fileHandler.sendCancelMessage(webRTCManager.getDataChannel());
      
      // 儲存當前檔案資訊，以便在取消後仍能存取
      const currentFileInfo = currentFile.value ? { ...currentFile.value } : null;
      
      // 取消本地傳輸
      const cancelled = fileHandler.cancelCurrentTransfer();
      console.log('取消傳輸結果:', cancelled);
      
      if (cancelled) {
        // 添加延遲，讓取消操作有時間完成
        setTimeout(() => {
          // 檢查剩餘檔案，排除已取消的檔案
          const remainingValidFiles = fileQueue.value.filter((file, idx) =>
            idx > currentQueueIndex.value && !file.cancelled
          );
          
          console.log('剩餘有效檔案:', remainingValidFiles.length);
          
          if (remainingValidFiles.length > 0) {
            // 自動繼續處理剩餘檔案，不再詢問用戶
            console.log('自動繼續處理剩餘檔案');
            
            // 確保仍在處理隊列模式
            isProcessingQueue.value = true;
            
            // 重置傳輸狀態，但保留檔案隊列
            currentQueueIndex.value++;
            
            // 確保前一個檔案被標記為已取消
            if (currentFileInfo && currentQueueIndex.value > 0) {
              fileQueue.value[currentQueueIndex.value - 1] = {
                ...currentFileInfo,
                cancelled: true
              };
            }
            
            // 更新UI以反映正在處理的檔案
            currentFile.value = fileQueue.value[currentQueueIndex.value];
            
            // 繼續處理下一個檔案，降低延遲時間以更快處理
            setTimeout(() => {
              fileHandler.processNextFile(webRTCManager.getDataChannel());
            }, 200); // 從500ms減少到200ms
          } else {
            // 沒有剩餘有效檔案
            console.log('沒有剩餘有效檔案，結束處理');
            isProcessingQueue.value = false;
          }
        }, 200);
      } else {
        // 如果沒有正在傳輸的檔案可取消，則重置狀態，回到選擇檔案狀態
        console.log('沒有正在傳輸的檔案，回到選擇檔案狀態');
        reset();
      }
      
      return cancelled;
    } catch (error) {
      console.error('取消傳輸時出錯:', error);
      return false;
    }
  };
  
  // 從隊列中移除指定檔案
  const removeFileFromQueue = (index) => {
    if (!fileHandler) return false;
    
    // 如果是當前正在傳輸的檔案，需要先取消當前傳輸
    if (index === currentQueueIndex.value && (isSending.value || isReceiving.value)) {
      return false; // 不允許移除正在傳輸的檔案，需要先取消當前傳輸
    }
    
    // 從檔案處理器中移除
    const removed = fileHandler.removeFromQueue(index);
    
    if (removed) {
      // 從 store 的隊列中也移除
      const removedFileSize = fileQueue.value[index].size;
      fileQueue.value.splice(index, 1);
      totalQueueSize.value -= removedFileSize;
      
      // 調整索引
      if (index < currentQueueIndex.value) {
        currentQueueIndex.value--;
      }
    }
    
    return removed;
  };
  
  // 取消特定檔案的傳輸
  const cancelFileTransfer = (index) => {
    if (!fileHandler) return false;
    
    const webRTCManager = connectionStore.getWebRTCManager();
    if (!webRTCManager || !webRTCManager.isConnected()) {
      return false;
    }
    
    // 如果是當前正在傳輸的檔案，則使用現有的取消方法
    if (index === currentQueueIndex.value) {
      return cancelCurrentTransfer();
    }
    
    // 使用新的 cancelFileTransfer 方法取消特定檔案
    const cancelled = fileHandler.cancelFileTransfer(index);
    
    if (cancelled) {
      // 從 store 的隊列中也移除
      if (index < fileQueue.value.length) {
        fileQueue.value.splice(index, 1);
        // 不需要調整總大小，因為 fileHandler.cancelFileTransfer 會處理
      }
    }
    
    return cancelled;
  };
  
  // 暫停當前傳輸
  const pauseTransfer = () => {
    if (!fileHandler) return false;
    
    // 不能暫停已經暫停的傳輸
    if (isPaused.value) return false;
    
    const webRTCManager = connectionStore.getWebRTCManager();
    if (!webRTCManager || !webRTCManager.isConnected()) {
      return false;
    }
    
    // 使用 FileHandler 的暫停方法
    const paused = fileHandler.pauseTransfer();
    
    if (paused) {
      isPaused.value = true;
    }
    
    return paused;
  };
  
  // 恢復當前傳輸
  const resumeTransfer = () => {
    if (!fileHandler) return false;
    
    // 只能恢復已暫停的傳輸
    if (!isPaused.value) return false;
    
    const webRTCManager = connectionStore.getWebRTCManager();
    if (!webRTCManager || !webRTCManager.isConnected()) {
      return false;
    }
    
    // 使用 FileHandler 的恢復方法
    const resumed = fileHandler.resumeTransfer();
    
    if (resumed) {
      isPaused.value = false;
    }
    
    return resumed;
  };
  
  // 在接收方初始化接收處理
  const initializeReceiver = () => {
    try {
      const webRTCManager = connectionStore.getWebRTCManager();
      if (!webRTCManager) {
        throw new Error('尚未建立 WebRTC 連接');
      }
      
      // 初始化檔案處理器
      initializeFileHandler();
      
      // 設置接收檔案的處理函數
      webRTCManager.onDataChannelMessage = (data, dataChannel) => {
        // 傳遞數據通道引用，確保接收方可以發送控制訊息
        fileHandler.handleIncomingData(data, dataChannel);
      };
      
      return true;
    } catch (error) {
      console.error('初始化接收處理失敗:', error);
      return false;
    }
  };
  
  // 監聽連接狀態變化，自動初始化接收處理
  watch(
    () => connectionStore.status,
    (newStatus) => {
      if (newStatus === 'connected') {
        initializeReceiver();
      }
    }
  );
  
  // 暴露給外部使用的 API
  return {
    // 狀態
    isSending,
    isReceiving,
    isPaused,
    currentFile,
    bytesSent,
    bytesReceived,
    transferSpeed,
    completedFiles,
    cancelledFiles,  // 新增：已取消檔案列表
    progressPercentage,
    
    // 新增隊列相關狀態
    fileQueue,
    currentQueueIndex,
    totalQueueSize,
    processedQueueSize,
    overallProgressPercentage,
    isProcessingQueue,
    remainingFiles,
    
    // 方法
    reset,
    sendFile,
    sendFiles,
    cancelCurrentTransfer,
    cancelFileTransfer,
    removeFileFromQueue,
    pauseTransfer,
    resumeTransfer,
    initializeReceiver
  };
});
