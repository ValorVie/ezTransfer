<template>
  <div class="sent-files-list">
    <div v-for="(file, index) in files" :key="index" class="file-item mb-2">
      <i class="bi bi-file-earmark file-icon"></i>
      <div class="file-info">
        <div class="file-name">{{ file.name }}</div>
        <div class="file-meta">
          {{ formatFileSize(file.size) }} • {{ formatTimeAgo(file.sentAt) }}
        </div>
      </div>
      <span class="badge rounded-pill bg-success">
        <i class="bi bi-check2 me-1"></i>已傳送
      </span>
    </div>
    
    <p v-if="!files.length" class="text-center text-muted">
      尚未傳送任何檔案
    </p>
  </div>
</template>

<script setup>
defineProps({
  files: {
    type: Array,
    default: () => []
  }
});

// 格式化檔案大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 格式化傳送時間（顯示多久以前）
const formatTimeAgo = (timestamp) => {
  if (!timestamp) return '';
  
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) {
    return '剛剛';
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} 分鐘前`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} 小時前`;
  } else {
    const days = Math.floor(seconds / 86400);
    return `${days} 天前`;
  }
};
</script>

<style scoped>
.file-icon {
  color: #6c757d;
}
</style>