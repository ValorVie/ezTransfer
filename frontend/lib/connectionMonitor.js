/**
 * 連接健康監測與自適應調整模組
 * 用於監測 WebRTC 連接質量並根據網路狀況動態調整參數
 */
export class ConnectionMonitor {
  /**
   * 建立連接監測器
   * @param {Object} options - 配置選項
   * @param {RTCPeerConnection} options.peerConnection - WebRTC 對等連接實例
   * @param {RTCDataChannel} options.dataChannel - WebRTC 數據通道實例
   * @param {Function} options.onQualityChange - 連接質量變化回調
   * @param {number} options.monitorInterval - 監測間隔(毫秒)，默認 5000ms
   * @param {number} options.minSamples - 最小樣本數量，默認 3 個
   */
  constructor(options = {}) {
    this.peerConnection = options.peerConnection;
    this.dataChannel = options.dataChannel;
    this.onQualityChange = options.onQualityChange;
    this.monitorInterval = options.monitorInterval || 5000;
    this.minSamples = options.minSamples || 3;
    
    // 監測狀態
    this.isMonitoring = false;
    this.monitorTimer = null;
    
    // 統計數據
    this.stats = {
      rtt: [],             // 往返時間樣本 (毫秒)
      avgRtt: 0,           // 平均往返時間
      packetLoss: [],      // 丟包率樣本 (百分比)
      avgPacketLoss: 0,    // 平均丟包率
      bandwidth: [],       // 帶寬樣本 (kbps)
      avgBandwidth: 0,     // 平均帶寬
      lastUpdated: null,   // 最後更新時間
      connectionQuality: 'unknown' // 連接質量: excellent(優), good(良), fair(中), poor(差), critical(危險)
    };
    
    // 連接質量閾值
    this.thresholds = {
      excellent: { rtt: 100, packetLoss: 0.5 },    // RTT < 100ms, 丟包率 < 0.5%
      good: { rtt: 200, packetLoss: 2 },           // RTT < 200ms, 丟包率 < 2%
      fair: { rtt: 400, packetLoss: 5 },           // RTT < 400ms, 丟包率 < 5%
      poor: { rtt: 800, packetLoss: 10 },          // RTT < 800ms, 丟包率 < 10%
      // 超過以上閾值則為 critical
    };
  }
  
  /**
   * 開始監測連接質量
   */
  startMonitoring() {
    if (this.isMonitoring) return;
    
    console.log('開始監測連接質量...');
    this.isMonitoring = true;
    
    // 立即進行第一次測量
    this.measureConnectionQuality();
    
    // 設置定期監測
    this.monitorTimer = setInterval(() => {
      this.measureConnectionQuality();
    }, this.monitorInterval);
  }
  
  /**
   * 停止監測連接質量
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    console.log('停止監測連接質量');
    this.isMonitoring = false;
    
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    
    // 重置統計數據
    this.resetStats();
  }
  
  /**
   * 重置統計數據
   */
  resetStats() {
    this.stats = {
      rtt: [],
      avgRtt: 0,
      packetLoss: [],
      avgPacketLoss: 0,
      bandwidth: [],
      avgBandwidth: 0,
      lastUpdated: null,
      connectionQuality: 'unknown'
    };
  }
  
  /**
   * 測量連接質量
   */
  async measureConnectionQuality() {
    if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') {
      console.warn('無法測量連接質量：對等連接未建立或未連接');
      return;
    }
    
    try {
      // 獲取 WebRTC 統計信息
      const stats = await this.collectRTCStats();
      
      // 更新統計數據
      this.updateStats(stats);
      
      // 評估連接質量
      const prevQuality = this.stats.connectionQuality;
      this.evaluateConnectionQuality();
      
      // 如果連接質量變化，通知外部
      if (prevQuality !== this.stats.connectionQuality) {
        console.log(`連接質量從 ${prevQuality} 變為 ${this.stats.connectionQuality}`);
        
        if (this.onQualityChange) {
          this.onQualityChange(this.stats.connectionQuality, this.stats);
        }
        
        // 根據質量變化調整參數
        this.adjustConnectionParams();
      }
      
    } catch (error) {
      console.error('測量連接質量失敗:', error);
    }
  }
  
  /**
   * 收集 RTC 統計信息
   * @returns {Object} 統計信息
   */
  async collectRTCStats() {
    const result = {
      rtt: null,
      packetLoss: null,
      bandwidth: null
    };
    
    if (!this.peerConnection) return result;
    
    try {
      // 獲取 RTCStats 報告
      const statsReport = await this.peerConnection.getStats();
      
      // 遍歷所有統計數據
      statsReport.forEach(report => {
        // 從不同類型的報告中提取數據
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          // 活躍的 ICE 候選對，包含往返時間
          if (report.currentRoundTripTime) {
            result.rtt = report.currentRoundTripTime * 1000; // 轉換為毫秒
          }
        } 
        else if (report.type === 'inbound-rtp') {
          // 接收的 RTP 統計，包含丟包率
          if (report.packetsLost !== undefined && report.packetsReceived) {
            const totalPackets = report.packetsLost + report.packetsReceived;
            result.packetLoss = totalPackets > 0 ? (report.packetsLost / totalPackets) * 100 : 0;
          }
        }
        else if (report.type === 'data-channel') {
          // 數據通道統計，可用於估算帶寬
          if (report.bytesReceived && report.bytesSent && report.timestamp) {
            const now = report.timestamp;
            if (this._lastTimestamp && now > this._lastTimestamp) {
              const timeDiff = (now - this._lastTimestamp) / 1000; // 轉換為秒
              const bytesTransferred = (report.bytesReceived + report.bytesSent) - (this._lastBytesReceived + this._lastBytesSent);
              result.bandwidth = (bytesTransferred * 8) / (timeDiff * 1000); // kbps
            }
            
            // 存儲當前值，供下次計算使用
            this._lastTimestamp = now;
            this._lastBytesReceived = report.bytesReceived;
            this._lastBytesSent = report.bytesSent;
          }
        }
      });
      
      return result;
    } catch (error) {
      console.error('收集 RTC 統計信息失敗:', error);
      return result;
    }
  }
  
  /**
   * 更新統計數據
   * @param {Object} stats - 新的統計數據
   */
  updateStats(stats) {
    // 更新 RTT
    if (stats.rtt !== null) {
      // 保持數組長度不超過 minSamples
      if (this.stats.rtt.length >= this.minSamples) {
        this.stats.rtt.shift();
      }
      this.stats.rtt.push(stats.rtt);
      
      // 更新平均 RTT
      this.stats.avgRtt = this.calculateAverage(this.stats.rtt);
    }
    
    // 更新丟包率
    if (stats.packetLoss !== null) {
      // 保持數組長度不超過 minSamples
      if (this.stats.packetLoss.length >= this.minSamples) {
        this.stats.packetLoss.shift();
      }
      this.stats.packetLoss.push(stats.packetLoss);
      
      // 更新平均丟包率
      this.stats.avgPacketLoss = this.calculateAverage(this.stats.packetLoss);
    }
    
    // 更新帶寬
    if (stats.bandwidth !== null) {
      // 保持數組長度不超過 minSamples
      if (this.stats.bandwidth.length >= this.minSamples) {
        this.stats.bandwidth.shift();
      }
      this.stats.bandwidth.push(stats.bandwidth);
      
      // 更新平均帶寬
      this.stats.avgBandwidth = this.calculateAverage(this.stats.bandwidth);
    }
    
    // 更新最後更新時間
    this.stats.lastUpdated = Date.now();
  }
  
  /**
   * 計算平均值
   * @param {Array<number>} values - 數值數組
   * @returns {number} 平均值
   */
  calculateAverage(values) {
    if (!values || values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }
  
  /**
   * 評估連接質量
   */
  evaluateConnectionQuality() {
    // 如果樣本不足，無法評估
    if (this.stats.rtt.length < this.minSamples || this.stats.packetLoss.length < this.minSamples) {
      return;
    }
    
    // 根據 RTT 和丟包率判斷連接質量
    let quality = 'critical'; // 默認為最差
    
    if (this.stats.avgRtt <= this.thresholds.excellent.rtt && 
        this.stats.avgPacketLoss <= this.thresholds.excellent.packetLoss) {
      quality = 'excellent';
    } else if (this.stats.avgRtt <= this.thresholds.good.rtt && 
               this.stats.avgPacketLoss <= this.thresholds.good.packetLoss) {
      quality = 'good';
    } else if (this.stats.avgRtt <= this.thresholds.fair.rtt && 
               this.stats.avgPacketLoss <= this.thresholds.fair.packetLoss) {
      quality = 'fair';
    } else if (this.stats.avgRtt <= this.thresholds.poor.rtt && 
               this.stats.avgPacketLoss <= this.thresholds.poor.packetLoss) {
      quality = 'poor';
    }
    
    // 更新連接質量
    this.stats.connectionQuality = quality;
  }
  
  /**
   * 根據連接質量調整參數
   */
  adjustConnectionParams() {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return;
    }
    
    // 根據連接質量調整參數
    switch (this.stats.connectionQuality) {
      case 'excellent':
        // 優質連接，使用最佳性能設置
        this._applyExcellentQualitySettings();
        break;
        
      case 'good':
        // 良好連接，略微降低部分參數
        this._applyGoodQualitySettings();
        break;
        
      case 'fair':
        // 一般連接，平衡設置
        this._applyFairQualitySettings();
        break;
        
      case 'poor':
        // 較差連接，優先保證可靠性
        this._applyPoorQualitySettings();
        break;
        
      case 'critical':
        // 臨界連接，嚴格限制傳輸，確保基本連接
        this._applyCriticalQualitySettings();
        break;
    }
  }
  
  /**
   * 應用優質連接設置
   * @private
   */
  _applyExcellentQualitySettings() {
    console.log('應用優質連接設置');
    // 優質連接，最大化性能，可以使用大量資源
    
    // 注意：部分 WebRTC 參數無法在連接建立後調整
    // 這裡可以調整應用層的參數，如消息批處理、壓縮等
    
    // 例如，通知應用層可以使用更高的視頻質量、更快的數據傳輸速率等
    if (this.onQualityChange) {
      this.onQualityChange('excellent', {
        recommendedSettings: {
          batchMessages: false,          // 不需要消息批處理
          compressionLevel: 'none',      // 不需要壓縮
          chunkSize: 16384,              // 較大的數據塊大小
          concurrentTransfers: 5,        // 允許更多並發傳輸
          retransmitTime: 1000           // 較短的重傳時間
        }
      });
    }
  }
  
  /**
   * 應用良好連接設置
   * @private
   */
  _applyGoodQualitySettings() {
    console.log('應用良好連接設置');
    // 良好連接，略微降低部分參數
    
    if (this.onQualityChange) {
      this.onQualityChange('good', {
        recommendedSettings: {
          batchMessages: false,          // 不需要消息批處理
          compressionLevel: 'low',       // 低壓縮率
          chunkSize: 8192,               // 中等數據塊大小
          concurrentTransfers: 3,        // 允許適量並發傳輸
          retransmitTime: 1500           // 適中的重傳時間
        }
      });
    }
  }
  
  /**
   * 應用一般連接設置
   * @private
   */
  _applyFairQualitySettings() {
    console.log('應用一般連接設置');
    // 一般連接，平衡設置
    
    if (this.onQualityChange) {
      this.onQualityChange('fair', {
        recommendedSettings: {
          batchMessages: true,           // 開啟消息批處理
          batchInterval: 100,            // 100ms 批處理間隔
          compressionLevel: 'medium',    // 中等壓縮率
          chunkSize: 4096,               // 較小的數據塊大小
          concurrentTransfers: 2,        // 限制並發傳輸
          retransmitTime: 2000           // 較長的重傳時間
        }
      });
    }
  }
  
  /**
   * 應用較差連接設置
   * @private
   */
  _applyPoorQualitySettings() {
    console.log('應用較差連接設置');
    // 較差連接，優先保證可靠性
    
    if (this.onQualityChange) {
      this.onQualityChange('poor', {
        recommendedSettings: {
          batchMessages: true,           // 開啟消息批處理
          batchInterval: 250,            // 250ms 批處理間隔
          compressionLevel: 'high',      // 高壓縮率
          chunkSize: 2048,               // 小數據塊大小
          concurrentTransfers: 1,        // 限制為單一傳輸
          retransmitTime: 3000,          // 很長的重傳時間
          prioritizeControl: true        // 優先處理控制消息
        }
      });
    }
  }
  
  /**
   * 應用臨界連接設置
   * @private
   */
  _applyCriticalQualitySettings() {
    console.log('應用臨界連接設置');
    // 臨界連接，嚴格限制傳輸，確保基本連接
    
    if (this.onQualityChange) {
      this.onQualityChange('critical', {
        recommendedSettings: {
          batchMessages: true,           // 開啟消息批處理
          batchInterval: 500,            // 500ms 批處理間隔
          compressionLevel: 'maximum',   // 最高壓縮率
          chunkSize: 1024,               // 最小數據塊大小
          concurrentTransfers: 1,        // 限制為單一傳輸
          retransmitTime: 5000,          // 非常長的重傳時間
          prioritizeControl: true,       // 優先處理控制消息
          pauseNonEssential: true,       // 暫停非必要傳輸
          notifyUser: true               // 通知用戶連接狀況不佳
        }
      });
    }
  }
  
  /**
   * 獲取當前連接統計信息
   * @returns {Object} 連接統計信息
   */
  getStats() {
    return { ...this.stats };
  }
  
  /**
   * 獲取當前連接質量
   * @returns {string} 連接質量
   */
  getConnectionQuality() {
    return this.stats.connectionQuality;
  }
  
  /**
   * 更新連接對象
   * @param {RTCPeerConnection} peerConnection - 新的對等連接實例
   * @param {RTCDataChannel} dataChannel - 新的數據通道實例
   */
  updateConnection(peerConnection, dataChannel) {
    this.peerConnection = peerConnection;
    this.dataChannel = dataChannel;
    
    // 重置統計數據
    this.resetStats();
    
    // 如果正在監測，重新開始
    if (this.isMonitoring) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }
}