<script setup>
import { formatMessageTime } from '../utils/time'

const props = defineProps({
  message: { type: Object, required: true },
  isMine: { type: Boolean, default: false },
  meName: { type: String, default: '' }
})

const emit = defineEmits(['longpress', 'preview'])
let timer = null

function startPress(e) {
  clearTimeout(timer)
  timer = setTimeout(() => emit('longpress', { event: e, message: props.message }), 450)
}

function endPress() {
  clearTimeout(timer)
}
</script>

<template>
  <article
    class="row"
    :class="{ mine: props.isMine }"
    @touchstart="startPress"
    @touchend="endPress"
    @mousedown="startPress"
    @mouseup="endPress"
    @mouseleave="endPress"
  >
    <img class="avatar" :src="props.message.senderAvatar || '/favicon.ico'" alt="avatar" />
    <div class="col">
      <div class="meta">
        <span>{{ props.isMine ? props.meName : props.message.senderName || `用户${props.message.senderId}` }}</span>
        <span>{{ formatMessageTime(props.message.createdAt) }}</span>
      </div>
      <div class="bubble" :class="props.message.type">
        <template v-if="props.message.type === 'image'">
          <img :src="props.message.content" alt="img" class="img" loading="lazy" @click="emit('preview', props.message.content)" />
        </template>
        <template v-else-if="props.message.type === 'file'">
          <a :href="props.message.extra?.url || props.message.content" target="_blank" rel="noreferrer">
            {{ props.message.extra?.name || '文件' }}
          </a>
        </template>
        <template v-else>
          {{ props.message.content }}
        </template>
      </div>
    </div>
  </article>
</template>

<style scoped>
.row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.row.mine {
  flex-direction: row-reverse;
}
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
}
.col {
  max-width: calc(100% - 52px);
}
.meta {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
  display: flex;
  gap: 8px;
}
.row.mine .meta {
  justify-content: flex-end;
}
.bubble {
  border-radius: 16px;
  padding: 10px 12px;
  background: var(--bubble-in);
  color: var(--text);
  word-break: break-word;
  box-shadow: var(--shadow);
}
.row.mine .bubble {
  color: #fff;
  background: var(--bubble-out);
}
.img {
  display: block;
  max-width: min(56vw, 240px);
  border-radius: 12px;
}
a {
  color: inherit;
}
</style>
