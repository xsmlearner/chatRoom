import { request } from './http'

export const chatApi = {
  register(username, password, registerPassphrase = '') {
    return request('/api/v2/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, register_passphrase: registerPassphrase })
    })
  },
  login(username, password) {
    return request('/api/v2/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
  },
  getMe() {
    return request('/api/v2/me')
  },
  updateMe(payload) {
    return request('/api/v2/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  },
  getRooms() {
    return request('/api/v2/rooms')
  },
  discoverRooms(q = '') {
    const query = new URLSearchParams()
    if (q) query.set('q', q)
    return request(`/api/v2/rooms/discover?${query.toString()}`)
  },
  discoverUsers(q = '') {
    const query = new URLSearchParams()
    if (q) query.set('q', q)
    return request(`/api/v2/users/discover?${query.toString()}`)
  },
  getDirects() {
    return request('/api/v2/directs')
  },
  createRoom(name) {
    return request('/api/v2/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
  },
  joinRoom(roomId) {
    return request(`/api/v2/rooms/${roomId}/join`, { method: 'POST' })
  },
  leaveRoom(roomId) {
    return request(`/api/v2/rooms/${roomId}/leave`, { method: 'POST' })
  },
  updateRoom(roomId, payload) {
    return request(`/api/v2/rooms/${roomId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  },
  deleteRoom(roomId) {
    return request(`/api/v2/rooms/${roomId}`, { method: 'DELETE' })
  },
  getRoomMembers(roomId) {
    return request(`/api/v2/rooms/${roomId}/members`)
  },
  getDirectMessages(peerId, cursor, keyword = '') {
    const query = new URLSearchParams()
    if (cursor) query.set('cursor', String(cursor))
    if (keyword) query.set('keyword', keyword)
    return request(`/api/v2/directs/${peerId}/messages?${query.toString()}`)
  },
  markDirectRead(peerId, at) {
    return request(`/api/v2/directs/${peerId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at })
    })
  },
  getMessages(roomId, cursor, keyword = '') {
    const query = new URLSearchParams()
    if (cursor) query.set('cursor', String(cursor))
    if (keyword) query.set('keyword', keyword)
    return request(`/api/v2/rooms/${roomId}/messages?${query.toString()}`)
  },
  markRead(roomId, at) {
    return request(`/api/v2/rooms/${roomId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at })
    })
  },
  upload(file) {
    const fd = new FormData()
    fd.append('file', file)
    return request('/api/v2/upload', { method: 'POST', body: fd })
  },
  getAdminSettings() {
    return request('/api/v2/admin/settings')
  },
  updateAdminSettings(registerPassphrase) {
    return request('/api/v2/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registerPassphrase })
    })
  },
  getAdminUsers(status = 'pending', q = '') {
    const query = new URLSearchParams()
    if (status) query.set('status', status)
    if (q) query.set('q', q)
    return request(`/api/v2/admin/users?${query.toString()}`)
  },
  reviewUser(userId, status, note = '') {
    return request(`/api/v2/admin/users/${userId}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note })
    })
  },
  setUserAdmin(userId, isAdmin) {
    return request(`/api/v2/admin/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin })
    })
  }
}
