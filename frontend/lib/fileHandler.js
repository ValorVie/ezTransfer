import { useRuntimeConfig } from '#imports';

/**
 * 檔案處理器類
 * 負責處理檔案的讀取、分塊、發送和組裝
 */
export class FileHandler {
  constructor() {
    // 獲取環境變數配置
    const config = useRuntimeConfig();
    
    // 事件回調
    this.onProgress = null;        // 傳輸進度更新
    this.onSendComplete = null;    // 檔案發送完成
    this.onReceiveComplete = null; // 檔案接收完成
    this.onReceiveStart = null;    // 檔案接收開始
    this.onError = null;           // 錯誤處理
    
    // 新增檔案隊列相關事件回調
    this.onQueueProgress = null;      // 整體隊列進度更新
    this.onFileStart = null;          // 開始處理隊列中的新檔案
    this.onQueueComplete = null;      // 整個檔案隊列處理完成
    this.onTransferCancelled = null;  // 檔案傳輸被取消
    this.onQueueUpdated = null;       // 檔案隊列更新
    this.onPerformanceReport = null;  // 新增: 性能報告回調
    this.onQueueInfo = null;          // 新增: 接收方收到完整檔案隊列信息
    
    // 暫停/恢復相關事件回調
    this.onTransferPaused = null;     // 傳輸暫停事件
    this.onTransferResumed = null;    // 傳輸恢復事件
    
    // 傳輸狀態常量
    this.transferState = {
      IDLE: 'idle',
      SENDING: 'sending',
      RECEIVING: 'receiving',
      PAUSED: 'paused',
      COMPLETED: 'completed',
      FAILED: 'failed'
    };
    
    // 檔案接收狀態
    this.isReceiving = false;
    this.isSending = false;
    this.isPaused = false;
    this.previousState = null; // 用於恢復暫停前的狀態
    this.currentState = this.transferState.IDLE;
    this.receivedSize = 0;
    this.fileSize = 0;
    this.fileName = '';
    this.fileType = '';
    this.fileChunks = [];
    this.pausePosition = 0; // 暫停位置，用於恢復
    this.sentSize = 0; // 已發送大小，用於暫停和恢復
    
    // 新增檔案隊列相關屬性
    this.fileQueue = [];              // 檔案隊列
    this.currentQueueIndex = -1;      // 當前處理的檔案索引
    this.totalQueueSize = 0;          // 隊列中所有檔案的總大小
    this.processedQueueSize = 0;      // 已處理的檔案大小總計
    this.dataChannel = null;          // 保存數據通道引用，以便取消傳輸
    
    // 傳輸參數設定 (從環境變數獲取)
    this.chunkSize = parseInt(config.public.chunkSize) || 64 * 1024; // 默認 64KB 的塊大小
    
    // 優化參數
    this.bufferThreshold = 10 * 1024 * 1024; // 10MB 緩衝阈值
    
    // 新增: 自適應塊大小控制
    this.adaptiveChunkSize = true; // 是否啟用自適應塊大小調整
    this.minChunkSize = 16 * 1024; // 最小塊大小 (16KB)
    this.maxChunkSize = 128 * 1024; // 最大塊大小 (128KB)
    this.currentBandwidth = 0; // 當前測量的帶寬 (bytes/s)
    this.smoothingFactor = 0.7; // 平滑因子，用於避免帶寬測量的劇烈波動
    
    // 新增: 性能測量屬性
    this.performanceStats = {
      startTime: 0,
      chunks: 0,
      totalBytes: 0,
      avgSpeed: 0,
      peakSpeed: 0,
      recentSpeeds: [], // 最近幾次傳輸速度的記錄
      bottlenecks: [] // 傳輸瓶頸記錄
    };

    this.webRTCManagerInstance = null; // 用於儲存 WebRTCManager 實例
    this._bufferedAmountLowResolve = null; // 用於解析等待 buffer 降低的 Promise
  }
  
  /**
   * 設定檔案隊列
   * @param {File[]} files - 要傳送的檔案陣列
   */
  setFileQueue(files) {
    this.fileQueue = [...files];
    this.currentQueueIndex = -1;
    this.totalQueueSize = files.reduce((total, file) => total + file.size, 0);
    this.processedQueueSize = 0;
  }
  
  /**
   * 開始處理檔案隊列
   * @param {RTCDataChannel} dataChannel - WebRTC 數據通道
   * @param {Object} webRTCManagerInstance - WebRTCManager 的實例
   */
  async processFileQueue(dataChannel, webRTCManagerInstance) {
    if (this.fileQueue.length === 0) {
      if (webRTCManagerInstance) {
        webRTCManagerInstance.onDataChannelBufferedAmountLow = null;
      }
      return;
    }
    
    this.dataChannel = dataChannel;
    this.webRTCManagerInstance = webRTCManagerInstance;

    if (this.webRTCManagerInstance) {
      this.webRTCManagerInstance.onDataChannelBufferedAmountLow = () => {
        console.log('[FileHandler] Received onDataChannelBufferedAmountLow from WebRTCManager');
        if (this._bufferedAmountLowResolve) {
          this._bufferedAmountLowResolve();
          this._bufferedAmountLowResolve = null; // 清除解析器
        }
      };
    }
    this.currentQueueIndex = 0;
    
    // 初始化性能統計
    this.startPerformanceMeasurement();
    
    // 新增：先發送整個檔案隊列的資訊給接收方
    console.log('發送完整檔案隊列資訊');
    if (dataChannel && dataChannel.readyState === 'open') {
      // 發送隊列資訊
      const queueInfo = {
        type: 'queue_info',
        totalFiles: this.fileQueue.length,
        totalSize: this.totalQueueSize,
        files: this.fileQueue.map(file => ({
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream'
        }))
      };
      
      // 發送隊列資訊
      dataChannel.send(JSON.stringify(queueInfo));
      console.log('已發送隊列資訊:', queueInfo);
    }
    
    // 短暫延遲，確保接收方已處理隊列資訊
    await new Promise(resolve => setTimeout(resolve, 200));
    
    await this.processNextFile(dataChannel);
  }
  
  /**
   * 處理隊列中的下一個檔案
   * @param {RTCDataChannel} dataChannel - WebRTC 數據通道
   */
  async processNextFile(dataChannel) {
    if (this.currentQueueIndex >= this.fileQueue.length) {
      console.log('所有檔案處理完成');
      // 所有檔案處理完成
      this.completePerformanceMeasurement(); // 完成性能測量

      // 清理 WebRTCManager 的回呼
      if (this.webRTCManagerInstance) {
        this.webRTCManagerInstance.onDataChannelBufferedAmountLow = null;
        console.log('[FileHandler] Cleared onDataChannelBufferedAmountLow callback on queue completion.');
      }
      
      if (this.onQueueComplete) {
        this.onQueueComplete(this.fileQueue);
      }
      return;
    }
    
    const currentFile = this.fileQueue[this.currentQueueIndex];
    
    // 檢查當前檔案是否已被標記為取消
    if (currentFile && currentFile.cancelled) {
      console.log('跳過已取消的檔案:', currentFile.name);
      
      // 跳到下一個檔案
      this.currentQueueIndex++;
      return this.processNextFile(dataChannel);
    }
    
    // 檢查當前檔案的處理邏輯
    if (!currentFile) {
      console.error('檔案不存在，跳過處理');
      this.currentQueueIndex++;
      return this.processNextFile(dataChannel);
    }
    
    console.log('開始處理檔案:', currentFile.name);
    
    // 判斷是發送方還是接收方模式
    const isSenderMode = typeof currentFile.slice === 'function';
    
    // 通知開始處理新檔案
    if (this.onFileStart) {
      this.onFileStart(currentFile, this.currentQueueIndex, this.fileQueue.length);
    }
    
    if (isSenderMode) {
      // 發送方模式：發送當前檔案
      console.log('以發送方模式處理檔案:', currentFile.name);
      this.isSending = true;
      await this.sendFile(currentFile, dataChannel);
    } else {
      // 接收方模式：若在接收方，不需要做特別處理，等待發送方開始傳輸
      console.log('以接收方模式等待檔案:', currentFile.name);
      
      // 在接收方模式下，我們不需要做特別處理，
      // 因為實際的檔案接收會由 handleIncomingData 和 startFileReception 處理
      // 這裡只是確保狀態正確
      
      // 由於我們沒有實際啟動接收邏輯，直接增加索引並處理下一個檔案
      if (!this.isReceiving) {
        // 檢查是否已經在接收中
        this.currentQueueIndex++;
        
        // 以更短的延遲繼續處理，避免立刻處理導致的堆疊問題
        setTimeout(() => {
          this.processNextFile(dataChannel);
        }, 50);
      }
    }
  }
  
  /**
   * 自適應調整塊大小
   * 根據測量的帶寬動態調整塊大小，以優化傳輸效率
   */
  adjustChunkSize() {
    if (!this.adaptiveChunkSize || this.currentBandwidth <= 0) return;
    
    // 目標：確保每個塊的傳輸時間在合理範圍內 (約 100ms)
    const targetTime = 0.1; // 理想傳輸時間 (秒)
    const idealChunkSize = this.currentBandwidth * targetTime;
    
    // 平滑調整：避免大幅波動
    const newSize = (1 - this.smoothingFactor) * this.chunkSize + 
                   this.smoothingFactor * idealChunkSize;
    
    // 安全限制在最小和最大塊大小之間
    let newChunkSize = Math.max(
      this.minChunkSize, 
      Math.min(this.maxChunkSize, newSize)
    );
    
    // 避免頻繁的微小調整
    if (Math.abs(newChunkSize - this.chunkSize) / this.chunkSize > 0.2) {
      this.chunkSize = Math.floor(newChunkSize);
      console.log(`調整塊大小至: ${this.chunkSize} bytes, 帶寬: ${Math.round(this.currentBandwidth / 1024)} KB/s`);
    }
  }
  
  /**
   * 開始性能測量
   */
  startPerformanceMeasurement() {
    this.performanceStats = {
      startTime: performance.now(),
      chunks: 0,
      totalBytes: 0,
      avgSpeed: 0,
      peakSpeed: 0,
      recentSpeeds: [],
      bottlenecks: []
    };
    console.log('開始性能測量');
  }
  
  /**
   * 記錄性能數據
   * @param {number} chunkSize - 數據塊大小
   * @param {number} sendTime - 發送耗時 (毫秒)
   */
  recordPerformanceData(chunkSize, sendTime) {
    const stats = this.performanceStats;
    stats.chunks++;
    stats.totalBytes += chunkSize;
    
    // 計算當前速度 (bytes/s)
    const speedInSeconds = chunkSize / (sendTime / 1000);
    
    // 記錄最近的速度
    stats.recentSpeeds.push(speedInSeconds);
    if (stats.recentSpeeds.length > 10) {
      stats.recentSpeeds.shift(); // 保留最近 10 個記錄
    }
    
    // 計算平均速度
    const avgRecentSpeed = stats.recentSpeeds.reduce((sum, speed) => sum + speed, 0) / 
                         stats.recentSpeeds.length;
    
    // 平滑更新當前帶寬估計
    this.currentBandwidth = avgRecentSpeed;
    
    // 更新峰值速度
    if (speedInSeconds > stats.peakSpeed) {
      stats.peakSpeed = speedInSeconds;
    }
    
    // 計算平均速度
    const elapsedTime = (performance.now() - stats.startTime) / 1000; // 秒
    if (elapsedTime > 0) {
      stats.avgSpeed = stats.totalBytes / elapsedTime;
    }
    
    // 檢測瓶頸 (速度低於平均的 50%)
    if (speedInSeconds < stats.avgSpeed * 0.5 && stats.chunks > 5) {
      stats.bottlenecks.push({
        time: new Date(),
        chunkIndex: stats.chunks,
        speed: speedInSeconds,
        avgSpeed: stats.avgSpeed,
        bufferAmount: this.dataChannel ? this.dataChannel.bufferedAmount : 0
      });
    }
    
    // 定期輸出性能數據到控制台
    if (stats.chunks % 50 === 0) {
      this.logPerformanceData('傳輸進行中');
    }
  }
  
  /**
   * 完成性能測量
   */
  completePerformanceMeasurement() {
    const stats = this.performanceStats;
    const elapsedTime = (performance.now() - stats.startTime) / 1000; // 秒
    
    // 計算最終平均速度
    if (elapsedTime > 0) {
      stats.avgSpeed = stats.totalBytes / elapsedTime;
    }
    
    // 輸出完整性能報告
    this.logPerformanceData('傳輸完成');
    
    // 如果性能報告回調存在，則執行
    if (this.onPerformanceReport) {
      this.onPerformanceReport(stats);
    }
  }
  
  /**
   * 記錄性能數據到控制台
   * @param {string} status - 狀態描述
   */
  logPerformanceData(status, extraInfo = null) {
    const stats = this.performanceStats;
    const elapsedTime = ((performance.now() - stats.startTime) / 1000).toFixed(2);
    
    console.log(`[性能報告] ${status}:`, {
      時間: `${elapsedTime}秒`,
      平均速度: `${this.formatSpeed(stats.avgSpeed)}`,
      峰值速度: `${this.formatSpeed(stats.peakSpeed)}`,
      塊數: stats.chunks,
      總大小: `${this.formatFileSize(stats.totalBytes)}`,
      瓶頸數: stats.bottlenecks.length,
      目前塊大小: `${this.formatFileSize(this.chunkSize)}`,
      ...(extraInfo ? extraInfo : {})
    });
  }
  
  /**
   * 格式化傳輸速度
   * @param {number} bytesPerSecond - 每秒字節數
   * @returns {string} 格式化後的速度字符串
   */
  formatSpeed(bytesPerSecond) {
    if (bytesPerSecond === 0) return '0 B/s';
    
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const digitGroups = Math.floor(Math.log10(bytesPerSecond) / Math.log10(1024));
    
    return `${(bytesPerSecond / Math.pow(1024, digitGroups)).toFixed(2)} ${units[digitGroups]}`;
  }
  
  /**
   * 格式化檔案大小
   * @param {number} bytes - 字節數
   * @returns {string} 格式化後的大小字符串
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const digitGroups = Math.floor(Math.log10(bytes) / Math.log10(1024));
    
    return `${(bytes / Math.pow(1024, digitGroups)).toFixed(2)} ${units[digitGroups]}`;
  }
  
  /**
   * 發送檔案
   * @param {File} file - 要發送的檔案
   * @param {RTCDataChannel} dataChannel - WebRTC 數據通道
   */
  async sendFile(file, dataChannel) {
    try {
      if (!file || !dataChannel) {
        throw new Error('檔案或數據通道無效');
      }
      
      if (dataChannel.readyState !== 'open') {
        throw new Error('數據通道尚未開啟');
      }
      
      // 檔案開始傳輸前重置性能測量 (僅對單個檔案)
      if (this.currentQueueIndex === 0) {
        this.startPerformanceMeasurement();
      }
      
      const totalChunks = Math.ceil(file.size / this.chunkSize);
      this.isSending = true; // 確保 isSending 設置為 true

      // 傳送檔案元數據
      const metadata = {
        type: 'metadata',
        name: file.name,
        size: file.size,
        fileType: file.type,
        queueIndex: this.currentQueueIndex,
        queueTotal: this.fileQueue.length,
        totalChunks: totalChunks // <--- 確保 totalChunks 已發送
      };
      
      // 發送檔案元數據
      dataChannel.send(JSON.stringify(metadata));
      
      // 讀取並發送檔案數據塊
      let offset = 0;
      this.sentSize = 0;
      let sequenceNumber = 0; // <--- 初始化序號
      
      // 循環讀取檔案並發送塊
      while (offset < file.size && this.isSending) {
        // 如果傳輸被暫停，等待恢復
        if (this.isPaused) {
          await new Promise(resolve => {
            const checkPauseStatus = () => {
              if (!this.isPaused) {
                resolve();
              } else {
                setTimeout(checkPauseStatus, 100);
              }
            };
            setTimeout(checkPauseStatus, 100);
          });
          
          // 如果等待過程中傳輸被取消，則中止
          if (!this.isSending) break;
        }
        
        // 計算當前塊的大小
        const currentChunkSize = Math.min(this.chunkSize, file.size - offset);
        
        // 從檔案中讀取數據塊
        const chunkBlob = file.slice(offset, offset + currentChunkSize);
        
        // 等待數據通道的緩衝區清空到合理水平
        if (dataChannel.bufferedAmount > this.bufferThreshold) {
          if (this.webRTCManagerInstance && typeof this.webRTCManagerInstance.onDataChannelBufferedAmountLow === 'function') {
            console.log(`[FileHandler] Buffer full (${dataChannel.bufferedAmount} > ${this.bufferThreshold}), waiting for bufferedamountlow event...`);
            
            // 檢查是否已經有一個正在等待的 Promise
            if (!this._bufferedAmountLowResolve) {
              const waitPromise = new Promise(resolve => {
                this._bufferedAmountLowResolve = resolve;
              });
              // 安全超時，以防事件因故未觸發
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => {
                  if (this._bufferedAmountLowResolve) { // 只有在尚未解決時才 reject
                    reject(new Error('Timeout waiting for bufferedamountlow event'));
                  }
                }, 10000) // 10 秒超時
              );

              try {
                await Promise.race([waitPromise, timeoutPromise]);
              } catch (e) {
                console.warn(`[FileHandler] ${e.message}. Continuing, but this might indicate an issue.`);
              } finally {
                // 無論成功、失敗或超時，都清除 resolve 回調
                this._bufferedAmountLowResolve = null;
              }
            } else {
              // 如果已經在等待，則短暫延遲，避免重複創建 Promise
              console.log('[FileHandler] Already waiting for bufferedamountlow, delaying slightly.');
              await new Promise(resolve => setTimeout(resolve, 50));
            }

            if (!this.isSending) { // 檢查在等待後是否仍處於發送狀態
              console.log('[FileHandler] Sending cancelled while waiting for buffer.');
              break;
            }
            console.log('[FileHandler] Buffer has space or timeout/error, resuming send.');
          } else {
            console.warn('[FileHandler] WebRTCManager instance or onDataChannelBufferedAmountLow callback not available. Using a short timeout as fallback.');
            await new Promise(resolve => setTimeout(resolve, 100)); // 簡單的回退機制
          }
        }
        
        // 如果在等待過程中傳輸被取消或暫停，則中止或等待
        if (!this.isSending) break;
        if (this.isPaused) continue;
        
        // 測量發送時間
        const sendStartTime = performance.now();
        
        try {
          // 發送數據塊
          await this.sendChunk(chunkBlob, sequenceNumber, dataChannel);
        } catch (chunkError) {
          console.error(`[FileHandler] Error sending chunk seq ${sequenceNumber} for ${file.name}:`, chunkError);
          this.isSending = false; // Stop sending loop
          if (this.onError) {
            this.onError(chunkError, {
              fileName: file.name,
              queueIndex: this.currentQueueIndex,
              sequenceNumber: sequenceNumber,
              stage: 'sendFile_sendChunk_catch'
            });
          }
          // No need to call processNextFile here, the outer catch or finally block in sendFile will handle it
          // or the loop condition !this.isSending will terminate it.
          break; // Exit the while loop
        }
        
        // 記錄發送完成時間
        const sendEndTime = performance.now();
        const sendTime = sendEndTime - sendStartTime;
        
        // 記錄性能數據並調整塊大小
        this.recordPerformanceData(currentChunkSize, sendTime);
        this.adjustChunkSize();
        
        // 更新偏移量和已發送大小
        offset += currentChunkSize;
        this.sentSize += currentChunkSize;
        sequenceNumber++; // <--- 遞增序號
        
        // 回調進度
        if (this.onProgress) {
          this.onProgress(this.sentSize, file.size);
        }
        
        // 更新整體隊列進度
        this.updateQueueProgress(this.sentSize);
      }
      
      // 如果傳輸未被取消，發送完成訊息
      if (this.isSending) {
        // 傳送完成的消息
        const completeMessage = {
          type: 'complete',
          queueIndex: this.currentQueueIndex
        };
        dataChannel.send(JSON.stringify(completeMessage));
        
        // 更新已處理大小
        this.processedQueueSize += file.size;
        
        // 發送完成回調
        if (this.onSendComplete) {
          this.onSendComplete({
            name: file.name,
            size: file.size,
            type: file.type,
            queueIndex: this.currentQueueIndex,
            totalQueue: this.fileQueue.length
          });
        }
        
        // 處理隊列中的下一個檔案
        this.currentQueueIndex++;
        this.processNextFile(dataChannel); // 直接調用，processNextFile 會處理隊列完成的情況
        
      } else {
        // 如果傳輸被取消
        console.log(`檔案 ${file.name} 的傳輸已被取消。`);
        if (this.onTransferCancelled) {
          this.onTransferCancelled({
            name: file.name,
            queueIndex: this.currentQueueIndex
          });
        }
        // 即使取消，也嘗試處理下一個檔案 (如果有的話)
        this.currentQueueIndex++; // 確保索引增加
        this.processNextFile(dataChannel);
      }
      
    } catch (error) {
      console.error(`[FileHandler] Error sending file ${file ? file.name : 'unknown file'}:`, error.message);
      this.isSending = false;
      this.currentState = this.transferState.FAILED;
      
      // Ensure file status in queue is updated if possible
      const currentFileInQueue = this.fileQueue[this.currentQueueIndex];
      if (file && currentFileInQueue && currentFileInQueue.name === file.name) {
          currentFileInQueue.status = 'failed';
          currentFileInQueue.error = error.message; // Store error message
      } else if (file) {
        // If the file isn't in the queue at the current index (e.g., queue structure changed or index is off)
        // still try to log an error for the intended file.
        console.warn(`[FileHandler] File ${file.name} (intended index ${this.currentQueueIndex}) not found or mismatched in queue for error status update.`);
      }


      if (this.onError) {
        this.onError(error, {
          fileName: file ? file.name : '未知檔案',
          queueIndex: this.currentQueueIndex,
          stage: 'sendFile_outerCatch',
          message: error.message // Pass along the error message
        });
      }
      
      // Critical: Check if dataChannel itself is still valid before trying to use it for processNextFile
      // If the error was due to the channel closing, processNextFile might also fail or hang.
      if (dataChannel && dataChannel.readyState === 'open') {
        console.log(`[FileHandler] Attempting to process next file after error with ${file ? file.name : 'unknown file'}.`);
        this.currentQueueIndex++;
        this.processNextFile(dataChannel);
      } else {
        console.error(`[FileHandler] Data channel is not open (state: ${dataChannel ? dataChannel.readyState : 'null'}) after error with ${file ? file.name : 'unknown file'}. Halting further queue processing.`);
        // Optionally, trigger a more global queue failure event if the channel is dead.
        if (this.onQueueComplete && this.fileQueue.length > 0) {
            // Mark remaining files as failed if appropriate
            for (let i = this.currentQueueIndex; i < this.fileQueue.length; i++) {
                if (this.fileQueue[i] && this.fileQueue[i].status !== 'completed' && this.fileQueue[i].status !== 'cancelled') {
                    this.fileQueue[i].status = 'failed';
                    this.fileQueue[i].error = 'Data channel closed during transfer';
                }
            }
            this.onQueueComplete(this.fileQueue, true); // Pass a flag indicating queue failed
        }
      }
    }
  }
  
  /**
   * 更新隊列處理進度
   * @param {number} currentFileProgress - 當前檔案處理進度
   */
  updateQueueProgress(currentFileProgress) {
    if (!this.onQueueProgress || this.fileQueue.length === 0) return;
    
    // 計算已處理的大小
    let processed = this.processedQueueSize;
    
    // 加上當前檔案的處理進度
    if (this.currentQueueIndex < this.fileQueue.length) {
      processed += currentFileProgress;
    }
    
    // 回調整體進度
    this.onQueueProgress(processed, this.totalQueueSize);
  }
  
  /**
   * 發送單個數據塊
   * @param {Blob} chunk - 檔案數據塊
   * @param {RTCDataChannel} dataChannel - WebRTC 數據通道
   */
  async sendChunk(chunkBlob, sequenceNumber, dataChannel) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        const arrayBufferChunkData = event.target.result; // 原始資料塊的 ArrayBuffer
        try {
          const headerSize = 4; // 4 位元組用於存儲 Uint32 的序號
          
          // 創建組合緩衝區 (序號標頭 + 資料塊)
          const combinedBuffer = new ArrayBuffer(headerSize + arrayBufferChunkData.byteLength);
          const view = new DataView(combinedBuffer);
          
          // 寫入序號 (使用小端字節序 Little Endian)
          // 參數: offset, value, littleEndian (true/false)
          view.setUint32(0, sequenceNumber, true);
          
          // 複製原始資料塊數據到組合緩衝區中標頭之後的位置
          const chunkBytes = new Uint8Array(arrayBufferChunkData);
          const combinedBytesView = new Uint8Array(combinedBuffer, headerSize); // 創建一個從標頭之後開始的視圖
          combinedBytesView.set(chunkBytes);
          
          // 發送組合後的 ArrayBuffer
          console.log(`[FileHandler] Before send chunk seq ${sequenceNumber}. Blob: ${chunkBlob.size}, Buffer: ${combinedBuffer.byteLength}, DC state: ${dataChannel.readyState}, Buffered: ${dataChannel.bufferedAmount}`);
          if (dataChannel.readyState === 'open') {
            try {
              dataChannel.send(combinedBuffer);
              console.log(`[FileHandler] After send chunk seq ${sequenceNumber}. DC state: ${dataChannel.readyState}, Buffered: ${dataChannel.bufferedAmount}`);
              resolve();
            } catch (sendError) {
              console.error(`[FileHandler] Error during dataChannel.send for seq ${sequenceNumber} (state: ${dataChannel.readyState}, buffered: ${dataChannel.bufferedAmount}):`, sendError);
              reject(sendError);
            }
          } else {
            const errorMsg = `[FileHandler] Data channel closed before attempting send for chunk ${sequenceNumber}. State: ${dataChannel.readyState}`;
            console.error(errorMsg);
            reject(new Error(errorMsg));
          }
        } catch (error) { // Catches errors from buffer creation or FileReader result processing
          console.error(`[FileHandler] Error processing chunk data for seq ${sequenceNumber} before send:`, error);
          reject(error);
        }
      };
      
      reader.onerror = (error) => {
        reject(error);
      };
      
      reader.readAsArrayBuffer(chunkBlob);
    });
  }
  
  /**
   * 處理接收到的數據
   * @param {Object|ArrayBuffer} data - 接收到的數據
   * @param {RTCDataChannel} dataChannel - 數據通道引用
   */
  handleIncomingData(data, dataChannel) {
    try {
      // 保存數據通道引用，以便接收方也能發送控制訊息
      if (dataChannel && !this.dataChannel) {
        this.dataChannel = dataChannel;
        console.log('[FileHandler] Receiver: Stored data channel reference.');
      }

      // 如果是字符串或 JSON 物件，解析為元數據或控制消息
      if (typeof data === 'string') {
        const message = JSON.parse(data);
        console.log('[FileHandler] Received message:', message.type);
        
        if (message.type === 'metadata') {
          this.startFileReception(message);
        } else if (message.type === 'complete') {
          this.completeFileReception(message.queueIndex);
        } else if (message.type === 'cancel') {
          this.handleCancelMessage(message);
        } else if (message.type === 'control') {
          this.handleControlMessage(message);
        } else if (message.type === 'queue_info') {
          this.handleQueueInfo(message);
        }
      }
      // 如果是 ArrayBuffer，則為檔案數據塊
      else if (data instanceof ArrayBuffer) {
        if (this.isPaused) {
          console.log('[FileHandler] Received ArrayBuffer chunk while paused, ignoring. Size:', data.byteLength);
          return;
        }
        // console.log('[FileHandler] Received ArrayBuffer. Type:', typeof data, 'ByteLength:', data ? data.byteLength : 'N/A');

        const headerSize = 4; // 4 bytes for Uint32 sequence number
        if (!data || data.byteLength < headerSize) {
          console.error('[FileHandler] Received data chunk is too small or invalid. ByteLength:', data ? data.byteLength : 'N/A');
          if (this.onError) this.onError(new Error('Received invalid data chunk (too small)'), { stage: 'handleIncomingData' });
          return;
        }

        const view = new DataView(data);
        const seq = view.getUint32(0, true); // true for little-endian
        // const actualChunkData = data.slice(headerSize); // REMOVED: Avoid slice
        
        // console.log('[FileHandler] Extracted sequence number. Seq:', seq, 'Original buffer length:', data.byteLength);

        // Pass the original buffer and the offset to receiveChunk
        this.receiveChunk({ seq, originalBuffer: data, offset: headerSize });
      }
    } catch (error) {
      console.error('[FileHandler] Error processing incoming data:', error);
      if (this.onError) {
        this.onError(error, { stage: 'handleIncomingData_outerCatch' });
      }
    }
  }
  
  /**
   * 開始接收檔案
   * @param {Object} metadata - 檔案元數據
   */
  startFileReception(metadata) {
    console.log('[FileHandler] Starting file reception. Metadata:', JSON.stringify(metadata));
    this.isReceiving = true;
    this.receivedSize = 0;
    this.fileSize = metadata.size;
    this.fileName = metadata.name;
    this.fileType = metadata.fileType;
    
    this.totalFileChunks = Number(metadata.totalChunks);
    if (isNaN(this.totalFileChunks) || this.totalFileChunks <= 0) {
      console.warn(`[FileHandler] Invalid or missing totalChunks in metadata for ${this.fileName}. Received: ${metadata.totalChunks}. Calculating based on size.`);
      this.totalFileChunks = (this.fileSize > 0) ? Math.max(1, Math.ceil(this.fileSize / this.chunkSize)) : 0;
      if (isNaN(this.totalFileChunks) || this.totalFileChunks < 0) {
          console.error(`[FileHandler] CRITICAL: Could not determine a valid totalFileChunks for ${this.fileName}. Size: ${this.fileSize}. Calculated totalChunks: ${this.totalFileChunks}`);
          this.totalFileChunks = 0; // Final fallback
          if (this.onError) this.onError(new Error('Invalid totalChunks in metadata'), {fileName: this.fileName, metadata, stage: 'startFileReception'});
      }
    }

    this.receivedChunkCount = 0;
    this.fileChunks = new Array(this.totalFileChunks || 0); // Initialize with correct length or empty if 0 chunks
    console.log(`[FileHandler] Initialized for ${this.fileName}: totalFileChunks = ${this.totalFileChunks}, receivedChunkCount = ${this.receivedChunkCount}, fileChunks array length: ${this.fileChunks.length}`);

    // 設置隊列相關資訊
    if (metadata.queueIndex !== undefined) {
      this.currentQueueIndex = metadata.queueIndex;
      // Ensure fileQueue entry exists if receiving metadata for a specific file
      if (this.fileQueue[metadata.queueIndex] === undefined || this.fileQueue[metadata.queueIndex] === null) {
         if (this.fileQueue.length === 0 && metadata.queueTotal) { // If queue was empty, initialize based on queueTotal
            this.fileQueue = Array(metadata.queueTotal).fill(null);
         }
         // Ensure the specific slot is an object
         this.fileQueue[metadata.queueIndex] = this.fileQueue[metadata.queueIndex] || {};
         Object.assign(this.fileQueue[metadata.queueIndex], {
            name: metadata.name,
            size: metadata.size,
            type: metadata.fileType,
            totalChunks: this.totalFileChunks, // Store for UI if needed
            receivedSize: 0,
            receivedChunkCount: 0,
            status: 'receiving'
         });
      } else { // File entry might exist from queue_info, update it
         Object.assign(this.fileQueue[metadata.queueIndex], {
            totalChunks: this.totalFileChunks,
            receivedSize: 0, // Reset for this specific file reception
            receivedChunkCount: 0, // Reset for this specific file reception
            status: 'receiving'
         });
      }
    }
    
    // 檔案接收開始時啟動性能測量 (only for the first file in a potential queue)
    if (this.currentQueueIndex === 0 && (!this.performanceStats || this.performanceStats.startTime === 0)) {
      this.startPerformanceMeasurement();
    }
    
    console.log('[FileHandler] Ready to receive file:', this.fileName, 'Size:', this.fileSize, 'Total Chunks:', this.totalFileChunks);
    
    if (this.onReceiveStart) {
      this.onReceiveStart({
        name: this.fileName,
        size: this.fileSize,
        type: this.fileType,
        queueIndex: this.currentQueueIndex,
        queueTotal: this.fileQueue.length,
        totalChunks: this.totalFileChunks
      });
    }
    
    if (this.onFileStart) { // This might be redundant if onReceiveStart covers it
      this.onFileStart({
        name: this.fileName,
        size: this.fileSize,
        type: this.fileType,
        totalChunks: this.totalFileChunks
      }, this.currentQueueIndex, this.fileQueue.length);
    }
  }
  
  /**
   * 接收檔案數據塊
   * @param {object} chunkObject - 包含序號、原始 ArrayBuffer 和偏移量的物件
   *                           { seq: number, originalBuffer: ArrayBuffer, offset: number }
   */
  receiveChunk(chunkObject) {
    if (!chunkObject || typeof chunkObject.originalBuffer === 'undefined' || typeof chunkObject.offset === 'undefined') {
      console.error('[FileHandler] CRITICAL: receiveChunk called with invalid chunkObject. Seq:', chunkObject ? chunkObject.seq : 'N/A');
      if (this.onError) this.onError(new Error('Received invalid chunk object structure'), {fileName: this.fileName, sequenceNumber: chunkObject ? chunkObject.seq : 'N/A', stage: 'receiveChunk_guard'});
      return;
    }

    if (!(chunkObject.originalBuffer instanceof ArrayBuffer)) {
      console.error('[FileHandler] CRITICAL: chunkObject.originalBuffer is not an ArrayBuffer. Type:', typeof chunkObject.originalBuffer, 'Seq:', chunkObject.seq);
       if (this.onError) this.onError(new Error('Received chunk originalBuffer is not ArrayBuffer'), {fileName: this.fileName, sequenceNumber: chunkObject.seq, stage: 'receiveChunk_type_check'});
      return;
    }
    
    const { seq, originalBuffer, offset } = chunkObject;
    // Create a view of the actual chunk data without copying, using the offset.
    // The length of the data is originalBuffer.byteLength - offset.
    const chunkDataView = new Uint8Array(originalBuffer, offset);
    const chunkDataLength = originalBuffer.byteLength - offset;

    if (!this.isReceiving || this.isPaused) {
      console.warn(`[FileHandler] Ignoring chunk seq ${seq} for ${this.fileName} because not receiving or paused. isReceiving: ${this.isReceiving}, isPaused: ${this.isPaused}`);
      return;
    }
    
    try {
      if (seq >= this.totalFileChunks) {
        console.error(`[FileHandler] Received chunk with sequence number ${seq} out of bounds for ${this.fileName}. Expected max ${this.totalFileChunks - 1}.`);
        if (this.onError) this.onError(new Error('Received chunk with out-of-bounds sequence number'), {fileName: this.fileName, sequenceNumber: seq, totalChunks: this.totalFileChunks, stage: 'receiveChunk_bounds'});
        return;
      }

      if (this.fileChunks[seq] === undefined) {
        // Store the Uint8Array view. When assembling the file, these views can be used.
        // If the final blob needs a contiguous ArrayBuffer, concatenation will be needed at that stage.
        this.fileChunks[seq] = chunkDataView;
        this.receivedChunkCount++; // Increment only for new chunks
        this.receivedSize += chunkDataLength;
        
        // console.log(`[FileHandler] Chunk ${seq}/${this.totalFileChunks - 1} received for ${this.fileName}. Size: ${chunkDataLength}. Total received: ${this.receivedSize}/${this.fileSize}. Count: ${this.receivedChunkCount}/${this.totalFileChunks}`);

        if (this.fileQueue[this.currentQueueIndex]) {
          this.fileQueue[this.currentQueueIndex].receivedSize = this.receivedSize;
          this.fileQueue[this.currentQueueIndex].receivedChunkCount = this.receivedChunkCount;
        }
        
        if (this.onProgress) {
          this.onProgress(this.receivedSize, this.fileSize, this.receivedChunkCount, this.totalFileChunks);
        }
        
        this.updateQueueProgress(this.receivedSize); // This uses this.processedQueueSize + current file progress
        
        // For performance, actual processing time is negligible here, focus on throughput.
        // this.recordPerformanceData(data.byteLength, 1); // Minimal time assumption
      } else {
        console.warn(`[FileHandler] Duplicate chunk seq ${seq} received for ${this.fileName}. Ignoring.`);
      }
      
    } catch (error) {
      console.error(`[FileHandler] Error processing received chunk seq ${seq} for ${this.fileName}:`, error);
      if (this.onError) {
        this.onError(error, { fileName: this.fileName, sequenceNumber: seq, stage: 'receiveChunk_innerCatch' });
      }
    }
  }
  
  /**
   * 完成檔案接收
   * @param {number} queueIndex - 檔案在隊列中的索引
   */
  completeFileReception(queueIndex) {
    if (!this.isReceiving) {
      console.warn(`嘗試完成檔案接收，但目前不在接收狀態。隊列索引: ${queueIndex}`);
      return;
    }
    
    // 確保是當前正在處理的檔案完成
    if (queueIndex !== this.currentQueueIndex) {
      console.warn(`收到非當前處理檔案的完成信號。期望索引: ${this.currentQueueIndex}, 收到: ${queueIndex}`);
      return;
    }
    
    console.log(`[FileHandler] Checking chunk completion for ${this.fileName} (Q_idx ${queueIndex}). Received: ${this.receivedChunkCount}, Expected: ${this.totalFileChunks}`);
    // 檢查 receivedChunkCount 和 totalFileChunks
    if (this.receivedChunkCount !== this.totalFileChunks) {
      // 當啟用自適應塊大小時，totalFileChunks 可能與實際接收的塊數不同。
      // 這不一定表示錯誤，只要所有數據都已接收。
      // 後續的文件大小驗證將是最終的檢查。
      console.warn(`檔案 ${this.fileName} (隊列索引 ${queueIndex}) 接收到的塊數 (${this.receivedChunkCount}) 與元數據中的預期塊數 (${this.totalFileChunks}) 不符。這在自適應塊大小調整時是正常的。將繼續進行檔案組裝和大小驗證。`);
    }

    // 日誌：檢查 receivedChunkCount 和 fileChunks 狀態 (這是我們之前嘗試添加的，現在應該能執行到)
    console.log(`[FileHandler] Before checking missing chunks. receivedChunkCount: ${this.receivedChunkCount}, fileChunks.length: ${this.fileChunks.length}`);
    const undefinedIndices = [];
    for (let k = 0; k < Math.min(this.receivedChunkCount, this.fileChunks.length); k++) {
      if (this.fileChunks[k] === undefined) {
        undefinedIndices.push(k);
      }
      if (undefinedIndices.length >= 10) break;
    }
    if (undefinedIndices.length > 0) {
      console.log(`[FileHandler] Indices in fileChunks (up to receivedChunkCount) that are undefined: ${undefinedIndices.join(', ')}`);
    }
    
    // 遍歷 this.fileChunks 陣列，確保 0 到 this.receivedChunkCount - 1 的所有索引都有資料
    // 當使用自適應塊大小時，this.receivedChunkCount 是實際接收到的塊數。
    for (let i = 0; i < this.receivedChunkCount; i++) {
      if (this.fileChunks[i] === undefined) {
        console.error(`檔案 ${this.fileName} (隊列索引 ${queueIndex}) 缺少塊序號 ${i}! 檔案損壞.`);
        if (this.onError) {
          this.onError(new Error(`缺少塊序號 ${i}`), {
            fileName: this.fileName,
            missingChunkIndex: i,
            queueIndex: queueIndex
          });
        }
        this.isReceiving = false;
        this.currentState = this.transferState.FAILED;
        if (this.fileQueue[queueIndex]) {
          this.fileQueue[queueIndex].status = 'failed';
        }
        this.currentQueueIndex++;
        this.processNextFile(this.dataChannel);
        return;
      }
    }
    
    console.log(`檔案 ${this.fileName} (隊列索引 ${queueIndex}) 所有塊接收完成，總大小: ${this.receivedSize}`);
    this.isReceiving = false;
    this.currentState = this.transferState.COMPLETED; // 標記為完成
    
    try {
      // 日誌：檢查 fileChunks 狀態
      console.log(`[FileHandler] Preparing to create Blob. fileChunks.length: ${this.fileChunks.length}. First chunk is ArrayBuffer: ${this.fileChunks[0] instanceof ArrayBuffer}`);
      
      // 合併所有接收到的數據塊
      // 重要：只使用實際接收到的塊 (0 到 receivedChunkCount - 1)
      const actualFileChunks = this.fileChunks.slice(0, this.receivedChunkCount);
      const receivedFile = new Blob(actualFileChunks, { type: this.fileType });
      
      // 日誌：比較 Blob 大小和預期文件大小
      console.log(`[FileHandler] Blob created. receivedFile.size: ${receivedFile.size}, this.fileSize (expected): ${this.fileSize}`);
      
      // 檢查檔案大小是否匹配 (可選，因為塊檢查更嚴格)
      if (receivedFile.size !== this.fileSize) {
        console.warn(`檔案大小不匹配! 期望: ${this.fileSize}, 實際: ${receivedFile.size}. 總塊數: ${this.totalFileChunks}, 接收塊數: ${this.receivedChunkCount}`);
        // 可以在這裡觸發錯誤或警告
        if (this.onError) {
          this.onError(new Error('檔案大小不匹配'), {
            fileName: this.fileName,
            expectedSize: this.fileSize,
            actualSize: receivedFile.size
          });
        }
      }
      
      // 更新已處理的隊列大小
      this.processedQueueSize += this.fileSize;
      
      // 更新 fileQueue 中對應檔案的狀態
      if (this.fileQueue[queueIndex]) {
        this.fileQueue[queueIndex].status = 'completed';
        this.fileQueue[queueIndex].blob = receivedFile; // 可以選擇存儲 Blob
      }
      
      // 觸發接收完成事件
      if (this.onReceiveComplete) {
        console.log(`[FileHandler] Triggering onReceiveComplete for ${this.fileName}`);
        this.onReceiveComplete({
          name: this.fileName,
          size: receivedFile.size,
          type: this.fileType,
          blob: receivedFile,
          queueIndex: queueIndex,
          queueTotal: this.fileQueue.length
        });
      }
      
      // 重置部分狀態為下一個檔案準備 (大部分狀態在 startFileReception 中重置)
      this.fileChunks = [];
      this.totalFileChunks = 0;
      this.receivedChunkCount = 0;
      
      // 處理隊列中的下一個檔案
      this.currentQueueIndex++;
      this.processNextFile(this.dataChannel); // 確保傳遞 dataChannel
      
    } catch (error) {
      console.error('合併檔案失敗:', error);
      this.currentState = this.transferState.FAILED;
      if (this.onError) {
        this.onError(error, { fileName: this.fileName, stage: 'completeFileReception' });
      }
    }
  }
  
  /**
   * 取消當前檔案傳輸
   * @returns {boolean} 取消是否成功
   */
  cancelCurrentTransfer() {
    console.log('嘗試取消當前傳輸:', {
      isReceiving: this.isReceiving,
      isSending: this.isSending,
      currentIndex: this.currentQueueIndex
    });
    
    // 若正在傳輸，強制標記為完成
    if (this.isReceiving || this.isSending) {
      try {
        // 獲取當前檔案信息，優先從隊列中獲取，確保在發送方也能顯示正確信息
        let fileInfo;
        
        if (this.currentQueueIndex >= 0 && this.currentQueueIndex < this.fileQueue.length && this.fileQueue[this.currentQueueIndex]) {
          // 優先從檔案隊列中獲取信息
          const queueFile = this.fileQueue[this.currentQueueIndex];
          fileInfo = {
            name: queueFile.name || this.fileName || 'unknown',
            size: queueFile.size || this.fileSize || 0,
            type: queueFile.type || this.fileType || '',
            index: this.currentQueueIndex
          };
        } else {
          // 若隊列中沒有，使用當前檔案信息
          fileInfo = {
            name: this.fileName || 'unknown',
            size: this.fileSize || 0,
            type: this.fileType || '',
            index: this.currentQueueIndex
          };
        }
        
        console.log('取消檔案:', fileInfo);
        
        // 如果有有效檔案，將其標記為已取消
        if (this.currentQueueIndex >= 0 && this.currentQueueIndex < this.fileQueue.length) {
          this.fileQueue[this.currentQueueIndex] = {
            ...fileInfo,
            cancelled: true  // 標記為已取消
          };
        }
        
        // 重置傳輸狀態
        this.isReceiving = false;
        this.isSending = false;
        this.isPaused = false;
        
        // 清空檔案區塊緩存
        this.fileChunks = [];
        this.receivedSize = 0;
        this.sentSize = 0;
// 如果正在等待緩衝區，解決 Promise 並清除
        if (this._bufferedAmountLowResolve) {
          this._bufferedAmountLowResolve(); // 解決任何正在等待的 Promise
          this._bufferedAmountLowResolve = null; // 清除回調
          console.log('[FileHandler] Resolved and cleared _bufferedAmountLowResolve due to transfer cancellation.');
        }

        // 清理 WebRTCManager 的回呼
        if (this.webRTCManagerInstance) {
          this.webRTCManagerInstance.onDataChannelBufferedAmountLow = null;
          console.log('[FileHandler] Cleared onDataChannelBufferedAmountLow callback on WebRTCManager due to transfer cancellation.');
        }
        
        // 通知取消事件
        if (this.onTransferCancelled) {
          this.onTransferCancelled(fileInfo);
        }
        
        console.log('當前傳輸已成功取消');
        return true;
      } catch (error) {
        console.error('取消當前傳輸時出錯:', error);
        return false;
      }
    }
    
    console.log('沒有正在進行的傳輸可取消');
    return false;
  }
  
  /**
   * 取消特定檔案的傳輸
   * @param {number} fileIndex - 要取消傳輸的檔案索引
   * @returns {boolean} 取消是否成功
   */
  cancelFileTransfer(fileIndex) {
    console.log('嘗試取消檔案傳輸, 索引:', fileIndex, '當前索引:', this.currentQueueIndex);
    
    // 如果是當前正在傳輸的檔案，使用現有的取消方法
    if (fileIndex === this.currentQueueIndex) {
      const result = this.cancelCurrentTransfer();
      console.log('取消當前檔案傳輸結果:', result);
      return result;
    }
    
    // 如果是隊列中尚未處理的檔案
    if (fileIndex >= 0 && fileIndex < this.fileQueue.length) {
      console.log('取消隊列中的檔案:', fileIndex);
      
      try {
        // 獲取檔案信息
        const removedFile = this.fileQueue[fileIndex];
        
        if (!removedFile) {
          console.error('找不到要取消的檔案:', fileIndex);
          return false;
        }
        
        // 記錄檔案信息用於通知
        const fileInfo = {
          name: removedFile.name || 'unknown',
          size: removedFile.size || 0,
          type: removedFile.type || '',
          index: fileIndex
        };
        
        // 將檔案標記為已取消，而不是刪除它
        // 這可以防止索引變化導致的問題
        this.fileQueue[fileIndex] = {
          ...fileInfo,
          cancelled: true  // 標記為已取消
        };
        
        // 更新隊列總大小
        this.totalQueueSize -= fileInfo.size;
        
        // 通知取消事件
        if (this.onTransferCancelled) {
          this.onTransferCancelled(fileInfo);
        }
        
        // 通知隊列更新
        if (this.onQueueUpdated) {
          this.onQueueUpdated(this.fileQueue, this.currentQueueIndex);
        }
        
        console.log('檔案已成功標記為取消');
        return true;
      } catch (error) {
        console.error('取消檔案時出錯:', error);
        return false;
      }
    }
    
    console.warn('無效的檔案索引:', fileIndex);
    return false;
  }
  
  /**
   * 暫停當前傳輸
   * @returns {boolean} 暫停是否成功
   */
  pauseTransfer() {
    console.log('嘗試暫停傳輸:', { isSending: this.isSending, isReceiving: this.isReceiving });
    
    // 只能暫停正在傳輸中的檔案
    if (this.isSending || this.isReceiving) {
      // 保存當前狀態
      this.previousState = this.isSending ? this.transferState.SENDING : this.transferState.RECEIVING;
      this.currentState = this.transferState.PAUSED;
      this.isPaused = true;
      
      // 保存當前位置，用於恢復
      this.pausePosition = this.isSending ? this.sentSize : this.receivedSize;
      
      // 發送暫停控制訊息 - 無論傳送方或接收方都發送
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        const pauseMessage = {
          type: 'control',
          action: 'pause',
          fileIndex: this.currentQueueIndex,
          position: this.pausePosition
        };
        
        // 確保訊息被發送
        try {
          this.dataChannel.send(JSON.stringify(pauseMessage));
          console.log('已發送暫停訊息:', pauseMessage);
        } catch (error) {
          console.error('發送暫停訊息失敗:', error);
        }
      } else {
        console.warn('無法發送暫停訊息，數據通道未開啟');
      }
      
      // 觸發暫停事件
      if (this.onTransferPaused) {
        this.onTransferPaused({
          name: this.fileName,
          size: this.fileSize,
          type: this.fileType,
          position: this.pausePosition,
          index: this.currentQueueIndex
        });
      }
      
      return true;
    }
    
    return false;
  }
  
  /**
   * 恢復暫停的傳輸
   * @returns {boolean} 恢復是否成功
   */
  resumeTransfer() {
    // 新增日誌，記錄恢復傳輸時的狀態
    console.log('嘗試恢復傳輸，目前狀態:', {
      isPaused: this.isPaused,
      previousState: this.previousState,
      pausePosition: this.pausePosition,
      currentQueueIndex: this.currentQueueIndex
    });
    
    // 只能恢復處於暫停狀態的傳輸
    if (this.isPaused && this.previousState) {
      // 恢復先前的狀態
      this.currentState = this.previousState;
      this.isPaused = false;
      
      if (this.previousState === this.transferState.SENDING) {
        this.isSending = true;
      } else if (this.previousState === this.transferState.RECEIVING) {
        this.isReceiving = true;
      }
      
      // 發送恢復控制訊息
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        const resumeMessage = {
          type: 'control',
          action: 'resume',
          fileIndex: this.currentQueueIndex,
          position: this.pausePosition
        };
        this.dataChannel.send(JSON.stringify(resumeMessage));
        console.log('已發送恢復訊息:', resumeMessage);
      }
      
      // 觸發恢復事件
      if (this.onTransferResumed) {
        this.onTransferResumed({
          name: this.fileName,
          size: this.fileSize,
          type: this.fileType,
          position: this.pausePosition,
          index: this.currentQueueIndex
        });
      }
      
      // 如果是發送方，從暫停位置繼續發送
      if (this.previousState === this.transferState.SENDING &&
          this.currentQueueIndex < this.fileQueue.length) {
        
        console.log('發送方恢復傳輸，暫時仍會從頭開始傳送');
        // 注意：根據需求確認，從頭開始傳送可能是預期的行為
        // 若希望從暫停點開始傳送，需要修改sendFile方法支援從指定位置開始
        
        // 保留現有的重新發送邏輯，但添加更明確的註解和日誌
        const currentFile = this.fileQueue[this.currentQueueIndex];
        if (this.dataChannel) {
          setTimeout(() => {
            // 未來優化：修改此處以支援從暫停位置恢復
            // 需要修改 sendFile 函數接受起始位置參數
            this.sendFile(currentFile, this.dataChannel);
          }, 100);
        }
      }
      
      return true;
    }
    
    return false;
  }
  
  /**
   * 處理控制訊息
   * @param {Object} message - 控制訊息
   */
  handleControlMessage(message) {
    if (message.type !== 'control') return;
    
    console.log('收到控制訊息:', message, '目前狀態:', {
      isPaused: this.isPaused,
      isSending: this.isSending,
      isReceiving: this.isReceiving,
      currentState: this.currentState
    });
    
    switch (message.action) {
      case 'pause':
        console.log('收到暫停請求');
        // 對方請求暫停傳輸，所有類型的傳輸都應該暫停
        this.isPaused = true;
        
        // 保存當前狀態以便後續恢復
        if (this.isSending) {
          this.previousState = this.transferState.SENDING;
        } else if (this.isReceiving) {
          this.previousState = this.transferState.RECEIVING;
        } else {
          this.previousState = this.currentState;
        }
        
        this.currentState = this.transferState.PAUSED;
        this.pausePosition = message.position;
        
        console.log('已設置暫停狀態:', {
          isPaused: this.isPaused,
          previousState: this.previousState,
          currentState: this.currentState
        });
        
        // 觸發暫停事件
        if (this.onTransferPaused) {
          this.onTransferPaused({
            name: this.fileName,
            size: this.fileSize,
            type: this.fileType,
            position: this.pausePosition,
            index: this.currentQueueIndex
          });
        }
        break;
        
      case 'resume':
        console.log('收到恢復請求');
        // 對方請求恢復傳輸
        this.isPaused = false;
        
        // 恢復到先前的狀態
        if (this.previousState) {
          this.currentState = this.previousState;
          
          if (this.previousState === this.transferState.SENDING) {
            this.isSending = true;
            this.isReceiving = false;
          } else if (this.previousState === this.transferState.RECEIVING) {
            this.isReceiving = true;
            this.isSending = false;
          }
          
          console.log('已恢復狀態:', {
            isPaused: this.isPaused,
            currentState: this.currentState,
            isSending: this.isSending,
            isReceiving: this.isReceiving
          });
        }
        
        // 觸發恢復事件
        if (this.onTransferResumed) {
          this.onTransferResumed({
            name: this.fileName,
            size: this.fileSize,
            type: this.fileType,
            position: message.position,
            index: this.currentQueueIndex
          });
        }
        
        // 如果是發送方，繼續發送
        if (this.previousState === this.transferState.SENDING &&
            this.currentQueueIndex < this.fileQueue.length) {
          console.log('發送方繼續發送檔案');
          const currentFile = this.fileQueue[this.currentQueueIndex];
          if (this.dataChannel) {
            setTimeout(() => {
              this.sendFile(currentFile, this.dataChannel);
            }, 100);
          }
        }
        break;
        
      default:
        console.warn('未處理的控制訊息類型:', message.action);
    }
  }
  
  /**
   * 從隊列中移除指定檔案
   * @param {number} index - 要移除的檔案索引
   * @returns {boolean} - 移除是否成功
   */
  removeFromQueue(index) {
    // 不允許移除正在處理的檔案
    if (index === this.currentQueueIndex) {
      return false;
    }
    
    // 確保索引有效
    if (index >= 0 && index < this.fileQueue.length) {
      // 計算要移除的檔案大小
      const fileSize = this.fileQueue[index].size;
      
      // 從隊列中移除檔案
      this.fileQueue.splice(index, 1);
      
      // 更新隊列總大小
      this.totalQueueSize -= fileSize;
      
      // 如果移除的檔案在當前處理的檔案之前，需要調整索引
      if (index < this.currentQueueIndex) {
        this.currentQueueIndex--;
      }
      
      // 通知隊列更新事件
      if (this.onQueueUpdated) {
        this.onQueueUpdated(this.fileQueue, this.currentQueueIndex);
      }
      
      return true;
    }
    
    return false;
  }
  
  /**
   * 發送取消傳輸的訊息
   * @param {RTCDataChannel} dataChannel - WebRTC 數據通道
   */
  sendCancelMessage(dataChannel) {
    if (!dataChannel || dataChannel.readyState !== 'open') return;
    
    // 發送取消傳輸的控制訊息
    const cancelMessage = {
      type: 'cancel',
      fileName: this.fileName,
      index: this.currentQueueIndex
    };
    
    dataChannel.send(JSON.stringify(cancelMessage));
  }
  
  /**
   * 處理取消傳輸訊息
   * @param {Object} message - 取消訊息物件
   */
  handleCancelMessage(message) {
    // 新增日誌以追蹤問題
    console.log('收到取消訊息:', message, '目前狀態:', {
      isReceiving: this.isReceiving,
      isSending: this.isSending,
      fileName: this.fileName,
      queueIndex: this.currentQueueIndex
    });
    
    // 修改條件：放寬匹配條件，確保接收方的取消消息能被正確處理
    // 原本只檢查檔案名稱，現在改為也檢查索引
    if (this.isReceiving &&
        (this.fileName === message.fileName ||
         this.currentQueueIndex === message.index)) {
      console.log('符合取消條件，執行取消操作');
      // 取消當前傳輸
      this.cancelCurrentTransfer();
      
      // 處理下一個檔案（如果有的話）
      this.currentQueueIndex++;
      if (this.currentQueueIndex < this.fileQueue.length && this.dataChannel) {
        setTimeout(() => {
          this.processNextFile(this.dataChannel);
        }, 200);
      }
    } else {
      console.log('不符合取消條件，檢查是否為發送方需要取消');
      // 如果是發送方收到取消訊息，也需要處理
      if (this.isSending) {
        console.log('發送方收到取消訊息，執行取消操作');
        this.cancelCurrentTransfer();
        
        // 確保發送方也處理下一個檔案
        console.log('發送方準備處理下一個檔案');
        this.currentQueueIndex++;
        if (this.currentQueueIndex < this.fileQueue.length && this.dataChannel) {
          setTimeout(() => {
            this.processNextFile(this.dataChannel);
          }, 300);
        } else {
          console.log('沒有更多檔案需要處理或數據通道不可用');
        }
      }
    }
  }
  
  /**
   * 處理接收到的檔案隊列資訊
   * @param {Object} message - 隊列資訊訊息
   */
  handleQueueInfo(message) {
    console.log('處理檔案隊列資訊:', message);
    
    if (!message.files || !Array.isArray(message.files)) {
      console.error('隊列資訊格式錯誤:', message);
      return;
    }
    
    // 更新檔案隊列和總大小
    this.fileQueue = message.files.map(file => ({
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream'
    }));
    
    this.totalQueueSize = message.totalSize ||
                         this.fileQueue.reduce((total, file) => total + file.size, 0);
    
    console.log('檔案隊列已更新:', {
      fileCount: this.fileQueue.length,
      totalSize: this.formatFileSize(this.totalQueueSize)
    });
    
    // 觸發隊列資訊事件
    if (this.onQueueInfo) {
      this.onQueueInfo({
        files: [...this.fileQueue],
        totalSize: this.totalQueueSize,
        totalFiles: this.fileQueue.length
      });
    }
    
    // 同時也觸發隊列更新事件
    if (this.onQueueUpdated) {
      this.onQueueUpdated(this.fileQueue, this.currentQueueIndex);
    }
  }
  
  /**
   * 觸發檔案下載
   * @param {Blob} blob - 檔案數據
   * @param {string} fileName - 檔案名稱
   */
  static triggerDownload(blob, fileName) {
    // 創建 URL 物件
    const url = URL.createObjectURL(blob);
    
    // 創建下載連結
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    
    // 添加到文檔並點擊
    document.body.appendChild(a);
    a.click();
    
    // 清理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
}