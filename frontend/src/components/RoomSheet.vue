<script setup>
import { ref } from 'vue'

const props = defineProps({
  rooms: { type: Array, default: () => [] },
  activeRoomId: { type: Number, default: null }
})

const emit = defineEmits(['select', 'create', 'join', 'refresh'])
const keyword = ref('')
const newRoom = ref('')
const joinRoomId = ref('')

function createRoom() {
  if (!newRoom.value.trim()) return
  emit('create', newRoom.value.trim())
  newRoom.value = ''
}

function joinRoom() {
  const id = Number(joinRoomId.value)
  if (!id) return
  emit('join', id)
  joinRoomId.value = ''
}
</script>

<template>
  <div class="sheet">
    <div class="sheet-head">
      <input v-model="keyword" placeholder="搜索房间名" @keyup.enter="emit('refresh', keyword)" />
      <button @click="emit('refresh', keyword)">搜索</button>
    </div>
    <div class="sheet-create">
      <input v-model="newRoom" placeholder="新建房间名" @keyup.enter="createRoom" />
      <button @click="createRoom">创建</button>
    </div>
    <div class="sheet-join">
      <input v-model="joinRoomId" placeholder="输入房间ID加入" @keyup.enter="joinRoom" />
      <button @click="joinRoom">加入</button>
    </div>
    <div class="list">
      <button
        v-for="r in props.rooms"
        :key="r.id"
        class="room-item"
        :class="{ on: props.activeRoomId === r.id }"
        @click="emit('select', r.id)"
      >
        <div class="name">{{ r.name }}</div>
        <div class="meta">{{ r.onlineCount || 0 }} 在线 · {{ r.unread || 0 }} 未读</div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sheet-head,
.sheet-create,
.sheet-join {
  display: flex;
  gap: 8px;
}
input,
button {
  min-height: 48px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg-elev);
  color: var(--text);
  padding: 0 12px;
}
input {
  flex: 1;
}
button {
  min-width: 72px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 38vh;
  overflow: auto;
}
.room-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px;
}
.room-item.on {
  border: none;
  background: linear-gradient(135deg, var(--primary), var(--primary-2));
  color: #fff;
}
.meta {
  font-size: 12px;
  opacity: 0.85;
}
</style>
