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
    this.bufferThreshold = 2 * 1024 * 1024; // 2MB 緩衝阈值
    
    // 新增: 自適應塊大小控制
    this.adaptiveChunkSize = true; // 是否啟用自適應塊大小調整
    this.minChunkSize = 16 * 1024; // 最小塊大小 (16KB)
    this.maxChunkSize = 256 * 1024; // 最大塊大小 (256KB)
    this.currentBandwidth = 0; // 當前測量的帶寬 (bytes/s)
    this.smoothingFactor = 0.3; // 平滑因子，用於避免帶寬測量的劇烈波動
    
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
   */
  async processFileQueue(dataChannel) {
    if (this.fileQueue.length === 0) return;
    
    this.dataChannel = dataChannel;
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
      
      // 傳送檔案元數據
      const metadata = {
        type: 'metadata',
        name: file.name,
        size: file.size,
        fileType: file.type,
        queueIndex: this.currentQueueIndex,
        queueTotal: this.fileQueue.length
      };
      
      // 發送檔案元數據
      dataChannel.send(JSON.stringify(metadata));
      
      // 讀取並發送檔案數據塊
      let offset = 0;
      this.sentSize = 0;
      
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
        const chunkSize = Math.min(this.chunkSize, file.size - offset);
        
        // 從檔案中讀取數據塊
        const chunk = file.slice(offset, offset + chunkSize);
        
        // 等待數據通道的緩衝區清空到合理水平
        if (dataChannel.bufferedAmount > this.bufferThreshold) {
          await new Promise(resolve => {
            const checkBufferedAmount = () => {
              if (dataChannel.bufferedAmount < this.bufferThreshold / 2) { // 等到緩衝減少一半再繼續
                resolve();
              } else {
                setTimeout(checkBufferedAmount, 50); // 更頻繁檢查
              }
            };
            setTimeout(checkBufferedAmount, 50);
          });
        }
        
        // 如果在等待過程中傳輸被取消或暫停，則中止或等待
        if (!this.isSending) break;
        if (this.isPaused) continue;
        
        // 測量發送時間
        const sendStartTime = performance.now();
        
        // 發送數據塊
        await this.sendChunk(chunk, dataChannel);
        
        // 記錄發送完成時間
        const sendEndTime = performance.now();
        const sendTime = sendEndTime - sendStartTime;
        
        // 記錄性能數據並調整塊大小
        this.recordPerformanceData(chunkSize, sendTime);
        this.adjustChunkSize();
        
        // 更新偏移量和已發送大小
        offset += chunkSize;
        this.sentSize += chunkSize;
        
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
            queueTotal: this.fileQueue.length
          });
        }
        
        // 更新隊列索引並處理下一個檔案
        this.currentQueueIndex++;
        
        // 如果還有檔案，繼續處理
        if (this.currentQueueIndex < this.fileQueue.length) {
          setTimeout(() => {
            this.processNextFile(dataChannel);
          }, 200); // 短暫延遲，避免立即處理
        } else {
          // 所有檔案處理完成
          this.completePerformanceMeasurement(); // 記錄整體性能數據
          
          if (this.onQueueComplete) {
            this.onQueueComplete(this.fileQueue);
          }
        }
        
        console.log('檔案發送完成:', file.name);
      }
      
      return true;
    } catch (error) {
      console.error('發送檔案失敗:', error);
      if (this.onError) {
        this.onError(error);
      }
      throw error;
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
  async sendChunk(chunk, dataChannel) {
    return new Promise((resolve, reject) => {
      // 創建 FileReader 讀取數據塊
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          // 獲取數據塊的 ArrayBuffer
          const arrayBuffer = event.target.result;
          
          // 發送數據塊
          dataChannel.send(arrayBuffer);
          
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = (error) => {
        reject(error);
      };
      
      // 讀取數據塊為 ArrayBuffer
      reader.readAsArrayBuffer(chunk);
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
        console.log('接收方已儲存數據通道引用');
      }

      // 如果是字符串或 JSON 物件，解析為元數據或控制消息
      if (typeof data === 'string') {
        const message = JSON.parse(data);
        console.log('收到消息:', message.type);
        
        if (message.type === 'metadata') {
          // 開始接收新檔案
          this.startFileReception(message);
        } else if (message.type === 'complete') {
          // 檔案接收完成
          this.completeFileReception(message.queueIndex);
        } else if (message.type === 'cancel') {
          // 收到取消傳輸訊息
          this.handleCancelMessage(message);
        } else if (message.type === 'control') {
          // 處理控制訊息（暫停/恢復）
          this.handleControlMessage(message);
        } else if (message.type === 'queue_info') {
          // 新增：處理完整檔案隊列資訊
          this.handleQueueInfo(message);
        }
      }
      // 如果是 ArrayBuffer，則為檔案數據塊
      else if (data instanceof ArrayBuffer && !this.isPaused) {
        // 處理檔案數據塊 (只有在非暫停狀態下才處理)
        this.receiveChunk(data);
      }
    } catch (error) {
      console.error('處理接收數據失敗:', error);
      if (this.onError) {
        this.onError(error);
      }
    }
  }
  
  /**
   * 開始接收檔案
   * @param {Object} metadata - 檔案元數據
   */
  startFileReception(metadata) {
    // 初始化接收狀態
    this.isReceiving = true;
    this.receivedSize = 0;
    this.fileSize = metadata.size;
    this.fileName = metadata.name;
    this.fileType = metadata.fileType;
    this.fileChunks = [];
    
    // 設置隊列相關資訊
    if (metadata.queueIndex !== undefined) {
      this.currentQueueIndex = metadata.queueIndex;
      
      // 如果隊列為空但收到隊列資訊，初始化隊列結構
      if (this.fileQueue.length === 0 && metadata.queueTotal) {
        this.fileQueue = Array(metadata.queueTotal).fill(null);
        this.fileQueue[metadata.queueIndex] = {
          name: metadata.name,
          size: metadata.size,
          type: metadata.fileType
        };
      }
    }
    
    // 檔案接收開始時啟動性能測量
    if (this.currentQueueIndex === 0) {
      this.startPerformanceMeasurement();
    }
    
    console.log('開始接收檔案:', this.fileName, '大小:', this.fileSize);
    
    // 回調接收開始事件
    if (this.onReceiveStart) {
      this.onReceiveStart({
        name: this.fileName,
        size: this.fileSize,
        type: this.fileType,
        queueIndex: this.currentQueueIndex,
        queueTotal: this.fileQueue.length
      });
    }
    
    // 回調檔案開始事件
    if (this.onFileStart) {
      this.onFileStart({
        name: this.fileName,
        size: this.fileSize,
        type: this.fileType
      }, this.currentQueueIndex, this.fileQueue.length);
    }
  }
  
  /**
   * 接收檔案數據塊
   * @param {ArrayBuffer} chunk - 檔案數據塊
   */
  receiveChunk(chunk) {
    if (!this.isReceiving) return;
    
    // 記錄接收開始時間 (用於性能測量)
    const receiveStartTime = performance.now();
    
    // 添加數據塊到隊列
    this.fileChunks.push(chunk);
    
    // 更新接收大小
    this.receivedSize += chunk.byteLength;
    
    // 記錄接收完成時間和性能數據
    const receiveEndTime = performance.now();
    this.recordPerformanceData(chunk.byteLength, receiveEndTime - receiveStartTime);
    
    // 回調進度更新
    if (this.onProgress) {
      this.onProgress(this.receivedSize, this.fileSize);
    }
    
    // 更新整體隊列進度
    this.updateQueueProgress(this.receivedSize);
  }
  
  /**
   * 完成檔案接收
   * @param {number} queueIndex - 檔案在隊列中的索引
   */
  completeFileReception(queueIndex) {
    if (!this.isReceiving) return;
    
    console.log('檔案接收完成:', this.fileName, '大小:', this.receivedSize);
    
    // 檢查接收大小是否正確
    if (this.receivedSize !== this.fileSize) {
      console.warn('接收大小與檔案大小不符:', this.receivedSize, '!=', this.fileSize);
    }
    
    // 合併所有數據塊
    const fileData = new Blob(this.fileChunks, { type: this.fileType || 'application/octet-stream' });
    
    // 更新已處理的大小
    this.processedQueueSize += this.fileSize;
    
    // 回調接收完成事件
    if (this.onReceiveComplete) {
      this.onReceiveComplete({
        name: this.fileName,
        size: this.fileSize,
        type: this.fileType,
        blob: fileData,
        queueIndex: this.currentQueueIndex
      });
    }
    
    // 如果是最後一個檔案，完成性能測量
    if (queueIndex === this.fileQueue.length - 1) {
      this.completePerformanceMeasurement();
    }
    
    // 重置接收狀態
    this.isReceiving = false;
    this.fileChunks = [];
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