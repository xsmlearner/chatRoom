<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AuthPanel from './components/AuthPanel.vue'
import ChatHeader from './components/ChatHeader.vue'
import ComposerBox from './components/ComposerBox.vue'
import MessageBubble from './components/MessageBubble.vue'
import { chatApi } from './api/chat'
import { getToken, setToken } from './api/http'
import { createSocket } from './utils/socket'
import { bindViewportBottom } from './utils/viewport'
import { appendMessage, chatStore } from './store/chatStore'

const showPanel = ref(false)
const showProfile = ref(false)
const showMenu = ref(false)
const showRoomManage = ref(false)
const showMembers = ref(false)
const showAdmin = ref(false)
const showImagePreview = ref(false)
const showToBottomBtn = ref(false)
const previewImage = ref('')
const draft = ref('')
const quoteTarget = ref(null)
const keyword = ref('')
const userKeyword = ref('')
const roomKeyword = ref('')
const newRoomName = ref('')
const userResults = ref([])
const roomResults = ref([])
const directs = ref([])
const roomMembers = ref([])
const adminUsers = ref([])
const adminQuery = ref('')
const adminStatus = ref('pending')
const registerPassphrase = ref('')
const registerPassphraseSet = ref(false)
const activeThread = reactive({ type: 'room', id: null })
const menuState = reactive({ x: 0, y: 0, message: null })
const tempDeleted = reactive({})
const notices = ref([])
const roomDraft = reactive({ name: '', announcement: '' })
const fileImageInput = ref(null)
const fileAnyInput = ref(null)
const avatarInput = ref(null)
const messagePaneRef = ref(null)
const theme = ref(localStorage.getItem('chat_theme') || 'light')
const token = ref(getToken())
const socket = ref(null)
let stopViewport = null
let typingTimer = null
let loadCursor = null

const isAuthed = computed(() => Boolean(token.value))
const activeRoom = computed(() => (activeThread.type === 'room' ? chatStore.rooms.find((r) => r.id === activeThread.id) || null : null))
const activeDirect = computed(() => (activeThread.type === 'direct' ? directs.value.find((d) => d.peerId === activeThread.id) || null : null))
const currentThreadKey = computed(() => `${activeThread.type}:${activeThread.id || 0}`)
const activeTitle = computed(() => {
  if (activeThread.type === 'direct') return activeDirect.value?.peerName || '私聊'
  return activeRoom.value?.name || '请选择会话'
})
const activeOnline = computed(() => {
  if (activeThread.type === 'direct') return activeDirect.value?.peerStatus === 'online' ? 1 : 0
  return activeRoom.value?.onlineCount || 0
})
const activeMessages = computed(() => {
  const list = chatStore.messagesByRoom[currentThreadKey.value] || []
  return list.filter((m) => !tempDeleted[m.id])
})
const typingText = computed(() => {
  if (activeThread.type !== 'room' || !activeThread.id) return ''
  const users = chatStore.typingByRoom[activeThread.id] || []
  if (!users.length) return ''
  return `${users.map((u) => u.name).join('、')} 正在输入...`
})
const unreadTotal = computed(() => {
  const roomUnread = (chatStore.rooms || []).reduce((sum, room) => sum + (room.unread || 0), 0)
  const directUnread = (directs.value || []).reduce((sum, direct) => sum + (direct.unread || 0), 0)
  return roomUnread + directUnread
})
const isAdmin = computed(() => Boolean(chatStore.me?.isAdmin))

function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme.value)
  localStorage.setItem('chat_theme', theme.value)
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme()
}

async function togglePanel() {
  showPanel.value = !showPanel.value
  if (showPanel.value) {
    await Promise.all([loadRooms(), loadDirects(), searchRooms()])
  }
}

function pushNotice(text) {
  const id = `${Date.now()}-${Math.random()}`
  notices.value.unshift({ id, text })
  setTimeout(() => {
    notices.value = notices.value.filter((n) => n.id !== id)
  }, 2600)
}

function scrollToBottom(smooth = false) {
  const pane = messagePaneRef.value
  if (!pane) return
  pane.scrollTo({ top: pane.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  showToBottomBtn.value = false
}

function updateScrollState() {
  const pane = messagePaneRef.value
  if (!pane) return
  const distance = pane.scrollHeight - pane.scrollTop - pane.clientHeight
  showToBottomBtn.value = distance > 80
}

function syncRoomDraftFromActive() {
  roomDraft.name = activeRoom.value?.name || ''
  roomDraft.announcement = activeRoom.value?.announcement || ''
}

async function bootstrap() {
  if (!isAuthed.value) return
  await loadMe()
  await Promise.all([loadRooms(), loadDirects()])
  connectSocket()
  if (!activeThread.id) {
    if (chatStore.rooms.length) await enterRoom(chatStore.rooms[0].id)
    else if (directs.value.length) await enterDirect(directs.value[0].peerId)
  }
}

async function loadMe() {
  chatStore.me = await chatApi.getMe()
}

async function loadRooms(q = '') {
  chatStore.rooms = q ? await chatApi.discoverRooms(q) : await chatApi.getRooms()
}

async function loadDirects() {
  directs.value = await chatApi.getDirects()
}

async function searchUsers() {
  userResults.value = await chatApi.discoverUsers(userKeyword.value.trim())
}

async function searchRooms() {
  roomResults.value = await chatApi.discoverRooms(roomKeyword.value.trim())
}

function isJoinedRoom(roomId) {
  return chatStore.rooms.some((room) => room.id === roomId)
}

async function enterRoom(roomId) {
  activeThread.type = 'room'
  activeThread.id = roomId
  showPanel.value = false
  loadCursor = null
  chatStore.activeRoomId = roomId
  chatStore.messagesByRoom[currentThreadKey.value] = []
  if (socket.value) socket.value.emit('join_room', { roomId })
  await loadMessages(false)
  await chatApi.markRead(roomId, Date.now())
  const room = chatStore.rooms.find((r) => r.id === roomId)
  if (room) room.unread = 0
  syncRoomDraftFromActive()
  await nextTick()
  scrollToBottom()
}

async function enterDirect(peerId) {
  activeThread.type = 'direct'
  activeThread.id = peerId
  showPanel.value = false
  loadCursor = null
  chatStore.messagesByRoom[currentThreadKey.value] = []
  await loadMessages(false)
  await chatApi.markDirectRead(peerId, Date.now())
  const d = directs.value.find((v) => v.peerId === peerId)
  if (d) d.unread = 0
  await nextTick()
  scrollToBottom()
}

async function loadMessages(older) {
  if (!activeThread.id) return
  const data =
    activeThread.type === 'room'
      ? await chatApi.getMessages(activeThread.id, older ? loadCursor : null, keyword.value)
      : await chatApi.getDirectMessages(activeThread.id, older ? loadCursor : null, keyword.value)
  if (!older) {
    chatStore.messagesByRoom[currentThreadKey.value] = data.items || []
    await nextTick()
    scrollToBottom()
  } else {
    chatStore.messagesByRoom[currentThreadKey.value] = [...(data.items || []), ...(chatStore.messagesByRoom[currentThreadKey.value] || [])]
  }
  loadCursor = data.nextCursor
}

async function onLogin({ username, password }) {
  try {
    const data = await chatApi.login(username, password)
    setToken(data.token)
    token.value = data.token
    await bootstrap()
  } catch (error) {
    alert(error.message || '登录失败')
  }
}

async function onRegister({ username, password, registerPassphrase }) {
  try {
    await chatApi.register(username, password, registerPassphrase || '')
    alert('注册申请已提交，请等待管理员审批后登录')
  } catch (error) {
    alert(error.message || '注册失败')
  }
}

function connectSocket() {
  if (socket.value) socket.value.disconnect()
  socket.value = createSocket()
  socket.value.on('connect', () => {
    if (activeThread.type === 'room' && activeThread.id) socket.value.emit('join_room', { roomId: activeThread.id })
  })
  socket.value.on('message_receive', (msg) => {
    appendMessage(`room:${msg.roomId}`, msg)
    const isActiveRoom = activeThread.type === 'room' && activeThread.id === msg.roomId
    if (!isActiveRoom && msg.senderId !== chatStore.me?.id) {
      const room = chatStore.rooms.find((r) => r.id === msg.roomId)
      if (room) room.unread = (room.unread || 0) + 1
      pushNotice(`群聊 ${room?.name || `#${msg.roomId}`} 有新消息`)
    } else {
      nextTick(() => {
        if (!showToBottomBtn.value) scrollToBottom()
      })
    }
  })
  socket.value.on('direct_message_receive', (msg) => {
    appendMessage(`direct:${msg.peerId}`, msg)
    if (!(activeThread.type === 'direct' && activeThread.id === msg.peerId) && msg.senderId !== chatStore.me?.id) {
      const d = directs.value.find((v) => v.peerId === msg.peerId)
      if (d) d.unread = (d.unread || 0) + 1
      else loadDirects()
      pushNotice(`私聊 ${directs.value.find((v) => v.peerId === msg.peerId)?.peerName || `#${msg.peerId}`} 有新消息`)
    } else {
      nextTick(() => {
        if (!showToBottomBtn.value) scrollToBottom()
      })
    }
  })
  socket.value.on('typing', ({ roomId, userId, isTyping }) => {
    if (userId === chatStore.me?.id) return
    const list = chatStore.typingByRoom[roomId] || []
    const exists = list.find((v) => v.id === userId)
    if (isTyping && !exists) list.push({ id: userId, name: `用户${userId}` })
    if (!isTyping) {
      chatStore.typingByRoom[roomId] = list.filter((v) => v.id !== userId)
      return
    }
    chatStore.typingByRoom[roomId] = list
  })
  socket.value.on('message_recalled', ({ id, roomId }) => {
    const list = chatStore.messagesByRoom[`room:${roomId}`] || []
    const target = list.find((m) => m.id === id)
    if (target) {
      target.type = 'recall'
      target.content = '该消息已撤回'
    }
  })
  socket.value.on('presence_sync', ({ userId, status }) => {
    if (chatStore.me && chatStore.me.id === userId) chatStore.me.status = status
    const d = directs.value.find((v) => v.peerId === userId)
    if (d) d.peerStatus = status
  })
  socket.value.on('direct_read', ({ peerId }) => {
    if (activeThread.type === 'direct' && activeThread.id === peerId) {
      const d = directs.value.find((v) => v.peerId === peerId)
      if (d) d.unread = 0
    }
  })
  socket.value.on('room_dissolved', ({ roomId }) => {
    chatStore.rooms = chatStore.rooms.filter((r) => r.id !== roomId)
    if (activeThread.type === 'room' && activeThread.id === roomId) {
      activeThread.id = null
      chatStore.messagesByRoom[currentThreadKey.value] = []
    }
    pushNotice('当前房间已被解散')
  })
}

async function send(payload) {
  if (!activeThread.id || !socket.value) return
  const data = { ...payload }
  if (quoteTarget.value) {
    data.extra = { quoteId: quoteTarget.value.id, quoteText: quoteTarget.value.content.slice(0, 50) }
  }
  if (activeThread.type === 'room') {
    socket.value.emit('message_send', { roomId: activeThread.id, ...data }, (resp) => {
      if (resp?.ok && resp.data) appendMessage(`room:${activeThread.id}`, resp.data)
    })
    await chatApi.markRead(activeThread.id, Date.now())
  } else {
    socket.value.emit('direct_message_send', { peerId: activeThread.id, ...data }, (resp) => {
      if (resp?.ok && resp.data) appendMessage(`direct:${activeThread.id}`, resp.data)
    })
    await chatApi.markDirectRead(activeThread.id, Date.now())
  }
  quoteTarget.value = null
  await nextTick()
  scrollToBottom(true)
}

function onTyping(isTyping) {
  if (activeThread.type !== 'room' || !socket.value || !activeThread.id) return
  socket.value.emit('typing', { roomId: activeThread.id, isTyping })
  clearTimeout(typingTimer)
  typingTimer = setTimeout(() => {
    socket.value.emit('typing', { roomId: activeThread.id, isTyping: false })
  }, 900)
}

async function onPickFile(type) {
  if (type === 'image') fileImageInput.value?.click()
  else fileAnyInput.value?.click()
}

async function uploadFromInput(event, type) {
  const file = event.target.files?.[0]
  if (!file) return
  const data = await chatApi.upload(file)
  if (type === 'image') await send({ type: 'image', content: data.url, extra: data })
  else await send({ type: 'file', content: data.url, extra: data })
  event.target.value = ''
}

function openLongPress({ event, message }) {
  const touch = event.touches?.[0]
  menuState.x = touch ? touch.clientX : event.clientX || window.innerWidth / 2
  menuState.y = touch ? touch.clientY : event.clientY || window.innerHeight / 2
  menuState.message = message
  showMenu.value = true
}

function openImagePreview(url) {
  previewImage.value = url
  showImagePreview.value = true
}

async function actionCopy() {
  if (!menuState.message) return
  await navigator.clipboard.writeText(menuState.message.content || '')
  closeMenu()
}

function actionDelete() {
  if (!menuState.message) return
  tempDeleted[menuState.message.id] = true
  closeMenu()
}

function actionQuote() {
  if (!menuState.message) return
  quoteTarget.value = menuState.message
  closeMenu()
}

function actionRecall() {
  if (!menuState.message || !socket.value || menuState.message.threadType === 'direct') return
  socket.value.emit('message_recall', { roomId: menuState.message.roomId, messageId: menuState.message.id }, () => closeMenu())
}

function closeMenu() {
  showMenu.value = false
  menuState.message = null
}

async function saveProfile() {
  if (!chatStore.me) return
  chatStore.me = await chatApi.updateMe({
    username: chatStore.me.username,
    avatar_url: chatStore.me.avatar_url || '',
    bio: chatStore.me.bio || '',
    status: chatStore.me.status || 'online'
  })
  showProfile.value = false
}

function triggerAvatarUpload() {
  avatarInput.value?.click()
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0]
  if (!file || !chatStore.me) return
  const data = await chatApi.upload(file)
  chatStore.me.avatar_url = data.url
  event.target.value = ''
}

async function createRoom(name) {
  if (!name || !name.trim()) return
  const room = await chatApi.createRoom(name.trim())
  await loadRooms()
  if (room?.id) await enterRoom(room.id)
}

async function joinRoom(id) {
  await chatApi.joinRoom(id)
  await loadRooms()
  await enterRoom(id)
}

async function openMembers() {
  if (!activeRoom.value?.id) return
  roomMembers.value = await chatApi.getRoomMembers(activeRoom.value.id)
  showMembers.value = true
}

async function openAdmin() {
  if (!isAdmin.value) return
  showAdmin.value = true
  const settings = await chatApi.getAdminSettings()
  registerPassphraseSet.value = Boolean(settings.registerPassphraseSet)
  await loadAdminUsers()
}

async function loadAdminUsers() {
  adminUsers.value = await chatApi.getAdminUsers(adminStatus.value, adminQuery.value.trim())
}

async function saveRegisterPassphrase() {
  await chatApi.updateAdminSettings(registerPassphrase.value)
  registerPassphraseSet.value = Boolean(registerPassphrase.value.trim())
  registerPassphrase.value = ''
}

async function reviewUser(user, status) {
  await chatApi.reviewUser(user.id, status, '')
  await loadAdminUsers()
}

async function toggleUserAdmin(user) {
  await chatApi.setUserAdmin(user.id, !user.isAdmin)
  await loadAdminUsers()
}

async function saveRoomSettings() {
  if (!activeRoom.value) return
  await chatApi.updateRoom(activeRoom.value.id, {
    name: roomDraft.name || activeRoom.value.name,
    announcement: roomDraft.announcement || ''
  })
  await loadRooms()
  if (activeRoom.value.id) await enterRoom(activeRoom.value.id)
  showRoomManage.value = false
}

async function leaveActiveRoom() {
  if (!activeRoom.value) return
  await chatApi.leaveRoom(activeRoom.value.id)
  const leftRoomId = activeRoom.value.id
  chatStore.rooms = chatStore.rooms.filter((r) => r.id !== leftRoomId)
  if (activeThread.type === 'room' && activeThread.id === leftRoomId) {
    activeThread.id = null
    if (chatStore.rooms.length) await enterRoom(chatStore.rooms[0].id)
    else if (directs.value.length) await enterDirect(directs.value[0].peerId)
  }
  showRoomManage.value = false
}

async function dissolveActiveRoom() {
  if (!activeRoom.value) return
  const roomId = activeRoom.value.id
  await chatApi.deleteRoom(roomId)
  chatStore.rooms = chatStore.rooms.filter((r) => r.id !== roomId)
  if (activeThread.type === 'room' && activeThread.id === roomId) {
    activeThread.id = null
    if (chatStore.rooms.length) await enterRoom(chatStore.rooms[0].id)
    else if (directs.value.length) await enterDirect(directs.value[0].peerId)
  }
  showRoomManage.value = false
}

async function startDirect(user) {
  const exists = directs.value.find((d) => d.peerId === user.id)
  if (!exists) {
    directs.value.unshift({
      peerId: user.id,
      peerName: user.username,
      peerAvatar: user.avatar_url || '',
      peerStatus: user.status || 'online',
      unread: 0
    })
  }
  await enterDirect(user.id)
  showPanel.value = false
}

function logout() {
  setToken('')
  token.value = ''
  chatStore.me = null
  chatStore.rooms = []
  chatStore.messagesByRoom = {}
  activeThread.type = 'room'
  activeThread.id = null
  directs.value = []
  if (socket.value) socket.value.disconnect()
}

onMounted(async () => {
  applyTheme()
  stopViewport = bindViewportBottom((offset) => {
    chatStore.keyboardOffset = offset
  })
  await bootstrap()
})

watch(
  () => activeRoom.value?.id,
  () => {
    syncRoomDraftFromActive()
  }
)

watch(
  () => unreadTotal.value,
  (count) => {
    document.title = count > 0 ? `(${count}) 手机聊天室` : '手机聊天室'
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (stopViewport) stopViewport()
  if (socket.value) socket.value.disconnect()
})
</script>

<template>
  <AuthPanel v-if="!isAuthed" @login="onLogin" @register="onRegister" />
  <main v-else class="layout">
    <ChatHeader
      :title="activeTitle"
      :online-count="activeOnline"
      :theme="theme"
      :unread-count="unreadTotal"
      @toggle-theme="toggleTheme"
      @open-rooms="togglePanel"
      @open-profile="showProfile = true"
    />
    <div class="content">
      <aside class="desktop-side">
        <div class="panel-block">
          <div class="block-title">群聊</div>
          <div class="row-actions">
            <input placeholder="搜索群聊" @keyup.enter="loadRooms($event.target.value)" />
            <button @click="loadRooms()">刷新</button>
          </div>
          <div class="list-box">
            <button v-for="room in chatStore.rooms" :key="`r-${room.id}`" class="side-item" :class="{ on: activeThread.type === 'room' && activeThread.id === room.id }" @click="enterRoom(room.id)">
              <span>{{ room.name }}</span>
              <span class="tag">{{ room.unread || 0 }}</span>
            </button>
          </div>
        </div>
        <div class="panel-block">
          <div class="block-title">私聊</div>
          <div class="list-box">
            <button v-for="d in directs" :key="`d-${d.peerId}`" class="side-item" :class="{ on: activeThread.type === 'direct' && activeThread.id === d.peerId }" @click="enterDirect(d.peerId)">
              <span>{{ d.peerName }}</span>
              <span v-if="d.unread > 0" class="tag badge-red">{{ d.unread > 99 ? '99+' : d.unread }}</span>
            </button>
          </div>
          <div class="row-actions">
            <input v-model="userKeyword" placeholder="搜用户发起私聊" @keyup.enter="searchUsers" />
            <button @click="searchUsers">搜</button>
          </div>
          <div class="list-box mini">
            <button v-for="u in userResults" :key="`u-${u.id}`" class="side-item" @click="startDirect(u)">
              <span>{{ u.username }}</span>
              <span class="tag">私聊</span>
            </button>
          </div>
        </div>
      </aside>

      <section ref="messagePaneRef" class="messages" @click="closeMenu" @scroll.passive="updateScrollState">
        <div class="toolbar">
          <button :disabled="!loadCursor" @click="loadMessages(true)">加载更早</button>
          <input v-model="keyword" placeholder="搜索聊天记录" @keyup.enter="loadMessages(false)" />
          <button @click="loadMessages(false)">搜索</button>
          <button v-if="activeThread.type === 'room' && activeRoom" @click="openMembers">群成员</button>
          <button v-if="activeThread.type === 'room' && activeRoom" @click="showRoomManage = true">房间管理</button>
          <button @click="logout">退出</button>
        </div>
        <div v-if="quoteTarget" class="quote-box">
          引用：{{ quoteTarget.content }}
          <button @click="quoteTarget = null">取消</button>
        </div>
        <div class="typing">{{ typingText }}</div>
        <div class="list">
          <MessageBubble
            v-for="m in activeMessages"
            :key="`${m.threadType}-${m.id}`"
            :message="m"
            :is-mine="m.senderId === chatStore.me?.id"
            :me-name="chatStore.me?.username || ''"
            @longpress="openLongPress"
            @preview="openImagePreview"
          />
        </div>
        <button v-if="showToBottomBtn" class="to-bottom-btn" @click="scrollToBottom(true)">下拉到底部最新消息</button>
      </section>
    </div>

    <div class="composer-wrap" :style="{ transform: `translateY(-${chatStore.keyboardOffset}px)` }">
      <ComposerBox v-model="draft" :disabled="!activeThread.id" @send="send" @typing="onTyping" @pick-file="onPickFile" />
      <input ref="fileImageInput" class="hidden" type="file" accept="image/*" @change="uploadFromInput($event, 'image')" />
      <input ref="fileAnyInput" class="hidden" type="file" @change="uploadFromInput($event, 'file')" />
    </div>

    <section v-if="showPanel" class="overlay">
      <div class="card">
        <div class="block-title">群聊</div>
        <div class="list-box">
          <button
            v-for="room in chatStore.rooms"
            :key="`or-${room.id}`"
            class="side-item"
            :class="{ on: activeThread.type === 'room' && activeThread.id === room.id }"
            @click="enterRoom(room.id)"
          >
            <span>{{ room.name }}</span>
            <span class="tag">{{ room.unread || 0 }}</span>
          </button>
        </div>
        <div class="block-title">私聊</div>
        <div class="list-box">
          <button
            v-for="d in directs"
            :key="`od-${d.peerId}`"
            class="side-item"
            :class="{ on: activeThread.type === 'direct' && activeThread.id === d.peerId }"
            @click="enterDirect(d.peerId)"
          >
            <span>{{ d.peerName }}</span>
            <span v-if="d.unread > 0" class="tag badge-red">{{ d.unread > 99 ? '99+' : d.unread }}</span>
          </button>
        </div>
        <div class="block-title">查找用户</div>
        <div class="row-actions">
          <input v-model="userKeyword" placeholder="搜用户发起私聊" @keyup.enter="searchUsers" />
          <button @click="searchUsers">搜索</button>
        </div>
        <div class="list-box mini">
          <button v-for="u in userResults" :key="`ou-${u.id}`" class="side-item" @click="startDirect(u)">
            <span>{{ u.username }}</span>
            <span class="tag">私聊</span>
          </button>
        </div>
        <div class="block-title">查找群聊</div>
        <div class="row-actions">
          <input v-model="roomKeyword" placeholder="输入群聊名搜索" @keyup.enter="searchRooms" />
          <button @click="searchRooms">搜索</button>
        </div>
        <div class="list-box mini">
          <button v-for="room in roomResults" :key="`sr-${room.id}`" class="side-item" @click="isJoinedRoom(room.id) ? enterRoom(room.id) : joinRoom(room.id)">
            <span>{{ room.name }}</span>
            <span class="tag">{{ isJoinedRoom(room.id) ? '进入' : '加入' }}</span>
          </button>
        </div>
        <div class="row-actions">
          <input v-model="newRoomName" placeholder="新建群聊名" @keyup.enter="createRoom(newRoomName); newRoomName = ''" />
          <button @click="createRoom(newRoomName); newRoomName = ''">新建</button>
          <button @click="loadRooms()">刷新</button>
        </div>
        <button class="close-btn" @click="showPanel = false">关闭</button>
      </div>
    </section>

    <section v-if="showMembers" class="overlay">
      <div class="card">
        <h3>群成员</h3>
        <div class="list-box">
          <div v-for="m in roomMembers" :key="`m-${m.id}`" class="member-item">
            <div class="member-left">
              <img class="mini-avatar" :src="m.avatar_url || '/favicon.ico'" alt="avatar" />
              <span>{{ m.username }}</span>
            </div>
            <span class="tag">{{ m.role === 'owner' ? '群主' : '成员' }}</span>
          </div>
        </div>
        <button class="close-btn" @click="showMembers = false">关闭</button>
      </div>
    </section>

    <section v-if="showRoomManage && activeRoom" class="overlay">
      <div class="card">
        <h3>房间管理</h3>
        <input v-model="roomDraft.name" placeholder="房间名称" />
        <input v-model="roomDraft.announcement" placeholder="房间公告" />
        <button @click="saveRoomSettings">保存设置</button>
        <button @click="leaveActiveRoom">退出房间</button>
        <button v-if="activeRoom.ownerId === chatStore.me?.id" @click="dissolveActiveRoom">解散房间</button>
        <button class="close-btn" @click="showRoomManage = false">关闭</button>
      </div>
    </section>

    <section v-if="showProfile" class="overlay">
      <div class="card">
        <h3>个人资料</h3>
        <div class="avatar-line">
          <img class="profile-avatar" :src="chatStore.me?.avatar_url || '/favicon.ico'" alt="avatar" />
          <button @click="triggerAvatarUpload">上传头像</button>
          <input ref="avatarInput" class="hidden" type="file" accept="image/*" @change="uploadAvatar" />
        </div>
        <input v-model="chatStore.me.username" placeholder="昵称" />
        <input v-model="chatStore.me.avatar_url" placeholder="头像地址" />
        <input v-model="chatStore.me.bio" placeholder="签名" />
        <select v-model="chatStore.me.status">
          <option value="online">在线</option>
          <option value="away">离开</option>
          <option value="busy">忙碌</option>
        </select>
        <button @click="saveProfile">保存</button>
        <button v-if="isAdmin" @click="openAdmin">管理员面板</button>
        <button class="close-btn" @click="showProfile = false">取消</button>
      </div>
    </section>

    <section v-if="showAdmin" class="overlay">
      <div class="card">
        <h3>管理员功能</h3>
        <div class="row-actions">
          <input v-model="registerPassphrase" placeholder="设置注册口令（留空关闭）" />
          <button @click="saveRegisterPassphrase">保存口令</button>
        </div>
        <div class="tip-line">当前状态：{{ registerPassphraseSet ? '已启用注册口令' : '未启用注册口令' }}</div>
        <div class="row-actions">
          <select v-model="adminStatus">
            <option value="pending">待审批</option>
            <option value="approved">已通过</option>
            <option value="rejected">已拒绝</option>
            <option value="all">全部</option>
          </select>
          <input v-model="adminQuery" placeholder="搜索用户名" @keyup.enter="loadAdminUsers" />
          <button @click="loadAdminUsers">查询</button>
        </div>
        <div class="list-box">
          <div v-for="u in adminUsers" :key="`au-${u.id}`" class="admin-item">
            <span>{{ u.username }}（{{ u.approval_status }}）</span>
            <div class="admin-actions">
              <button v-if="u.approval_status === 'pending'" @click="reviewUser(u, 'approved')">通过</button>
              <button v-if="u.approval_status === 'pending'" @click="reviewUser(u, 'rejected')">拒绝</button>
              <button @click="toggleUserAdmin(u)">{{ u.isAdmin ? '取消管理员' : '设为管理员' }}</button>
            </div>
          </div>
        </div>
        <button class="close-btn" @click="showAdmin = false">关闭</button>
      </div>
    </section>

    <section v-if="showMenu" class="menu" :style="{ left: `${menuState.x}px`, top: `${menuState.y}px` }">
      <button @click="actionCopy">复制</button>
      <button @click="actionRecall">撤回</button>
      <button @click="actionDelete">删除</button>
      <button @click="actionQuote">引用回复</button>
    </section>

    <section v-if="showImagePreview" class="overlay preview" @click="showImagePreview = false">
      <img class="preview-image" :src="previewImage" alt="preview" />
    </section>
    <section class="notice-stack">
      <div v-for="item in notices" :key="item.id" class="notice-item">{{ item.text }}</div>
    </section>
  </main>
</template>

<style scoped>
.layout {
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: linear-gradient(180deg, rgba(91, 124, 250, 0.1), transparent 40%);
}
.content {
  min-height: 0;
  display: flex;
}
.desktop-side {
  display: none;
  width: 320px;
  border-right: 1px solid var(--line);
  padding: 10px;
  overflow: auto;
  background: var(--bg-elev);
}
.panel-block {
  margin-bottom: 12px;
}
.block-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.row-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.list-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}
.list-box.mini {
  max-height: 120px;
}
.side-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 42px;
}
.side-item.on {
  background: var(--bubble-out);
  color: #fff;
  border: none;
}
.tag {
  font-size: 12px;
  opacity: 0.85;
}
.badge-red {
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #ff4d4f;
  color: #fff;
  opacity: 1;
}
.member-item,
.admin-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 10px;
  background: var(--bg);
}
.member-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mini-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}
.admin-actions {
  display: flex;
  gap: 6px;
}
.admin-actions button {
  min-height: 34px;
  border-radius: 8px;
}
.tip-line {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--muted);
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 10;
  padding: 16px;
}
.card {
  background: var(--bg-elev);
  border-radius: 16px;
  padding: 12px;
  box-shadow: var(--shadow);
  max-height: calc(100vh - 32px);
  overflow: auto;
}
.close-btn {
  margin-top: 10px;
  width: 100%;
  min-height: 48px;
}
input,
select,
button {
  min-height: 48px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--bg-elev);
  color: var(--text);
  padding: 0 12px;
}
.messages {
  flex: 1;
  overflow: auto;
  padding: 8px 10px;
}
.toolbar {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  background: var(--bg);
}
.toolbar input {
  flex: 1;
  min-width: 120px;
}
.typing {
  min-height: 20px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.quote-box {
  margin-bottom: 8px;
  padding: 8px 10px;
  border-left: 3px solid var(--primary);
  background: var(--bg-elev);
  border-radius: 10px;
  font-size: 12px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 72px;
}
.to-bottom-btn {
  position: sticky;
  left: 10px;
  bottom: 10px;
  min-height: 40px;
  background: var(--bubble-out);
  color: #fff;
  border: none;
}
.composer-wrap {
  transition: transform 0.15s ease;
}
.menu {
  position: fixed;
  transform: translate(-50%, -100%);
  display: grid;
  gap: 6px;
  z-index: 20;
}
.menu button {
  min-width: 120px;
  box-shadow: var(--shadow);
}
.avatar-line {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}
.profile-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
}
.preview {
  display: grid;
  place-items: center;
  padding: 20px;
}
.preview-image {
  max-width: min(95vw, 900px);
  max-height: 88vh;
  border-radius: 12px;
}
.hidden {
  display: none;
}
.notice-stack {
  position: fixed;
  top: 72px;
  right: 12px;
  z-index: 30;
  display: grid;
  gap: 8px;
}
.notice-item {
  max-width: min(72vw, 320px);
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-elev);
  box-shadow: var(--shadow);
  border: 1px solid var(--line);
  font-size: 13px;
}
@media (min-width: 900px) {
  .desktop-side {
    display: block;
  }
}
</style>
