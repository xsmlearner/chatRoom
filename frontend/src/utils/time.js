export function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const h = `${d.getHours()}`.padStart(2, '0')
  const m = `${d.getMinutes()}`.padStart(2, '0')
  return `${h}:${m}`
}

export function formatMessageTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const y = d.getFullYear()
  const mon = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const h = `${d.getHours()}`.padStart(2, '0')
  const m = `${d.getMinutes()}`.padStart(2, '0')
  return sameDay ? `${h}:${m}` : `${y}-${mon}-${day} ${h}:${m}`
}
