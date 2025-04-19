<template>
  <div class="connection-status">
    <div v-if="status === 'disconnected'" class="d-flex align-items-center">
      <span class="status-indicator disconnected"></span>
      <span>未連接</span>
    </div>
    
    <div v-else-if="status === 'connecting' || status === 'awaiting_connection'" class="d-flex align-items-center">
      <span class="status-indicator connecting"></span>
      <span>{{ status === 'connecting' ? '正在連接...' : '等待連接...' }}</span>
    </div>
    
    <div v-else-if="status === 'connected'" class="d-flex align-items-center">
      <span class="status-indicator connected"></span>
      <span>已連接</span>
    </div>
    
    <div v-if="errorMessage" class="alert alert-danger mt-3">
      <i class="bi bi-exclamation-triangle me-2"></i>{{ errorMessage }}
    </div>
  </div>
</template>

<script setup>
defineProps({
  status: {
    type: String,
    required: true,
    validator: (val) => ['disconnected', 'connecting', 'awaiting_connection', 'connected', 'error'].includes(val)
  },
  errorMessage: {
    type: String,
    default: ''
  }
});
</script>

<style scoped>
.connection-status {
  padding: 0.5rem 0;
}
</style>