<template>
  <div class="received-files-list">
    <div v-for="(file, index) in files" :key="index" class="file-item mb-2">
      <i class="bi bi-file-earmark file-icon"></i>
      <div class="file-info">
        <div class="file-name">{{ file.name }}</div>
        <div class="file-meta">
          {{ formatFileSize(file.size) }} • {{ formatTimeAgo(file.receivedAt) }}
        </div>
      </div>
      <button 
        @click="downloadFile(file)" 
        class="btn btn-sm btn-success"
      >
        <i class="bi bi-download"></i>
      </button>
    </div>
    
    <p v-if="!files.length" class="text-center text-muted">
      尚未接收任何檔案
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

// 格式化接收時間（顯示多久以前）
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

// 下載檔案
const downloadFile = (file) => {
  if (file.blob) {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // 釋放URL以節省記憶體
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  }
};
</script>

<style scoped>
.file-icon {
  color: #6c757d;
}
</style>