<template>
  <div class="file-transfer-progress">
    <div class="mb-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="file-info">
          <h5 class="file-name mb-0">{{ fileName }}</h5>
          <div class="text-muted small">{{ formatFileSize(fileSize) }}</div>
        </div>
        <div class="transfer-stats text-end">
          <div class="progress-text">{{ progress }}%</div>
          <div class="speed-text small">{{ formatSpeed(speed) }}</div>
        </div>
      </div>
      <div class="progress">
        <div 
          class="progress-bar progress-bar-striped progress-bar-animated bg-primary" 
          role="progressbar" 
          :style="{ width: `${progress}%` }" 
          :aria-valuenow="progress" 
          aria-valuemin="0" 
          aria-valuemax="100"
        ></div>
      </div>
    </div>
    
    <div class="transfer-details d-flex justify-content-between text-muted small">
      <div>
        <i class="bi bi-arrow-down-up me-1"></i>
        {{ formatFileSize(sentReceived) }} / {{ formatFileSize(fileSize) }}
      </div>
      <div v-if="timeRemaining">
        <i class="bi bi-clock me-1"></i>
        剩餘時間：{{ formatTime(timeRemaining) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  fileName: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  sent: {
    type: Number,
    default: 0
  },
  received: {
    type: Number,
    default: 0
  },
  speed: {
    type: Number,
    default: 0
  },
  progress: {
    type: Number,
    default: 0
  }
});

// 根據傳輸方向決定是已發送還是已接收
const sentReceived = computed(() => {
  return props.sent > 0 ? props.sent : props.received;
});

// 計算剩餘時間（秒）
const timeRemaining = computed(() => {
  if (props.speed <= 0) return 0;
  const remaining = props.fileSize - sentReceived.value;
  return Math.floor(remaining / props.speed);
});

// 格式化檔案大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 格式化傳輸速率
const formatSpeed = (bytesPerSec) => {
  if (bytesPerSec === 0) return '計算中...';
  return formatFileSize(bytesPerSec) + '/s';
};

// 格式化剩餘時間
const formatTime = (seconds) => {
  if (seconds < 60) {
    return `${seconds} 秒`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes} 分 ${remainingSeconds} 秒`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours} 小時 ${minutes} 分`;
  }
};
</script>

<style scoped>
.progress {
  height: 0.75rem;
}

.file-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

@media (max-width: 576px) {
  .file-name {
    max-width: 180px;
  }
}
</style>