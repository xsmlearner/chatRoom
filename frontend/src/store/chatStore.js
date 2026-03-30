import { reactive } from 'vue'

export const chatStore = reactive({
  me: null,
  rooms: [],
  activeRoomId: null,
  messagesByRoom: {},
  typingByRoom: {},
  readMap: {},
  searchKeyword: '',
  keyboardOffset: 0
})

export function setActiveRoom(roomId) {
  chatStore.activeRoomId = roomId
}

export function appendMessage(roomId, message) {
  if (!chatStore.messagesByRoom[roomId]) chatStore.messagesByRoom[roomId] = []
  const list = chatStore.messagesByRoom[roomId]
  const exists = list.some((m) => m.id === message.id)
  if (!exists) list.push(message)
}
