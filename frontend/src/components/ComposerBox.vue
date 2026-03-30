<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'send', 'typing', 'pick-file'])
const showMore = ref(false)
const emojis = ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😭', '😡', '🥳', '👍', '👏', '🙏', '🔥', '🎉', '🌹', '💡', '❤️']

watch(
  () => props.modelValue,
  (v) => emit('typing', Boolean(v?.trim()))
)

function submit() {
  const text = props.modelValue.trim()
  if (!text || props.disabled) return
  emit('send', { type: 'text', content: text })
  emit('update:modelValue', '')
}

function addEmoji(emoji) {
  emit('update:modelValue', `${props.modelValue}${emoji}`)
}
</script>

<template>
  <div class="composer">
    <div class="line1">
      <button @click="showMore = !showMore">＋</button>
      <textarea
        :value="props.modelValue"
        :disabled="props.disabled"
        rows="1"
        placeholder="输入消息..."
        @input="emit('update:modelValue', $event.target.value)"
      />
      <button @click="submit">发送</button>
    </div>
    <div v-if="showMore" class="more">
      <button v-for="emoji in emojis" :key="emoji" @click="addEmoji(emoji)">{{ emoji }}</button>
      <button @click="emit('pick-file', 'image')">图片</button>
      <button @click="emit('pick-file', 'file')">文件</button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
  background: var(--bg-elev);
}
.line1 {
  display: grid;
  grid-template-columns: 48px 1fr 64px;
  gap: 8px;
}
button,
textarea {
  min-height: 48px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg-elev);
  color: var(--text);
}
textarea {
  padding: 12px;
  resize: none;
}
.more {
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  overflow: hidden;
}
.more button {
  min-height: 40px;
  padding: 0;
}
</style>
