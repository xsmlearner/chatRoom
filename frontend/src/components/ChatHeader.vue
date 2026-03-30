<script setup>
const props = defineProps({
  title: { type: String, default: '未选择房间' },
  onlineCount: { type: Number, default: 0 },
  theme: { type: String, default: 'light' },
  unreadCount: { type: Number, default: 0 }
})

const emit = defineEmits(['toggle-theme', 'open-rooms', 'open-profile'])
</script>

<template>
  <header class="head">
    <button class="rooms-btn" @click="emit('open-rooms')">
      房间
      <span v-if="props.unreadCount > 0" class="badge">{{ props.unreadCount > 99 ? '99+' : props.unreadCount }}</span>
    </button>
    <div class="center">
      <div class="title">{{ props.title }}</div>
      <div class="sub">{{ props.onlineCount }} 人在线</div>
    </div>
    <div class="right">
      <button @click="emit('toggle-theme')">{{ props.theme === 'dark' ? '亮色' : '暗色' }}</button>
      <button @click="emit('open-profile')">我</button>
    </div>
  </header>
</template>

<style scoped>
.head {
  min-height: 56px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-elev);
}
button {
  min-height: 48px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-elev);
  color: var(--text);
  padding: 0 12px;
}
.rooms-btn {
  position: relative;
}
.badge {
  position: absolute;
  right: -6px;
  top: -6px;
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  line-height: 1;
  background: #ff4d4f;
  color: #fff;
}
.center {
  text-align: center;
}
.title {
  font-weight: 600;
}
.sub {
  font-size: 12px;
  color: var(--muted);
}
.right {
  display: flex;
  gap: 6px;
}
</style>
