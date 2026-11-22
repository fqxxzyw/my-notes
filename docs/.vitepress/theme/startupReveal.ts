interface DesktopBridge {
  postMessage(value: object): void
  addEventListener(name: 'message', handler: (event: MessageEvent) => void): void
  removeEventListener(name: 'message', handler: (event: MessageEvent) => void): void
}

// The host owns the animated splash. Only the local Windows app participates;
// a normal website or server-side render must never be hidden by this handshake.
export function beginDesktopReveal(): () => void {
  const bridge = (window as unknown as { chrome?: { webview?: DesktopBridge } }).chrome?.webview
  if (window.location.protocol !== 'https:' || window.location.hostname !== 'paper.local' ||
      !window.location.pathname.startsWith('/my-notes/') || !bridge) return () => {}

  const root = document.documentElement
  let finished = false
  let readySent = false
  let frame = 0
  let finishTimer = 0
  root.classList.add('paper-desktop-starting')

  const disposeWait = () => {
    bridge.removeEventListener('message', receive)
    window.clearTimeout(paintTimer)
    window.clearTimeout(fallbackTimer)
    window.cancelAnimationFrame(frame)
  }
  const finish = () => {
    if (finished) return
    finished = true
    disposeWait()
    root.classList.remove('paper-desktop-starting')
    root.classList.add('paper-desktop-revealed')
    finishTimer = window.setTimeout(() => root.classList.remove('paper-desktop-revealed'), 600)
  }
  const receive = (event: MessageEvent) => {
    if (event.data?.channel === 'paper-notes' && event.data?.action === 'ui.reveal') finish()
  }
  const ready = () => {
    if (readySent || finished) return
    readySent = true
    try { bridge.postMessage({ channel: 'paper-notes', action: 'ui.ready' }) }
    catch { finish() }
  }
  bridge.addEventListener('message', receive)
  // An occluded WebView may throttle animation frames. Mount + nextTick have
  // already completed, so this timer safely avoids a frame/host deadlock.
  const paintTimer = window.setTimeout(ready, 150)
  const fallbackTimer = window.setTimeout(finish, 8000)
  frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(ready) })

  return () => {
    finished = true
    disposeWait()
    window.clearTimeout(finishTimer)
    root.classList.remove('paper-desktop-starting', 'paper-desktop-revealed')
  }
}
