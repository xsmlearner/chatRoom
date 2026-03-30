export function bindViewportBottom(callback) {
  const vv = window.visualViewport
  const update = () => {
    if (!vv) {
      callback(0)
      return
    }
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    callback(offset)
  }
  if (vv) vv.addEventListener('resize', update)
  window.addEventListener('resize', update)
  update()
  return () => {
    if (vv) vv.removeEventListener('resize', update)
    window.removeEventListener('resize', update)
  }
}
