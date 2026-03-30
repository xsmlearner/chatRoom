const TOKEN_KEY = 'chat_token_v2'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (!token) localStorage.removeItem(TOKEN_KEY)
  else localStorage.setItem(TOKEN_KEY, token)
}

export async function request(url, options = {}) {
  const token = getToken()
  const headers = {
    ...(options.headers || {})
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { ...options, headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    throw new Error(json.message || '请求失败')
  }
  return json.data ?? json
}
