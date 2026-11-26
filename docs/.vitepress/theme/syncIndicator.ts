export type TransferKind = 'sync' | 'restore'
export type TransferState = { phase: 'idle' } | { phase: 'running' | 'success' | 'settling'; kind: TransferKind }
type Clock = { schedule: (callback: () => void, ms: number) => unknown; cancel: (handle: unknown) => void }

/** Track active transfers without stale completions or timers hiding a newer one. */
export function createSyncIndicator(setState: (state: TransferState) => void, clock: Clock = {
  schedule: (callback, ms) => setTimeout(callback, ms),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
}) {
  const active = new Map<number, TransferKind>()
  let timer: unknown
  let sequence = 0
  let nextId = 0
  function cancelTimer() { if (timer !== undefined) { clock.cancel(timer); timer = undefined } }
  function showActive() {
    const values = [...active.values()]
    const latest = values[values.length - 1]
    setState(latest ? { phase: 'running', kind: latest } : { phase: 'idle' })
  }
  return {
    start(kind: TransferKind) {
      sequence++; cancelTimer()
      const id = ++nextId
      active.set(id, kind)
      setState({ phase: 'running', kind })
      return id
    },
    success(id: number) {
      const kind = active.get(id)
      if (!kind) return
      active.delete(id)
      if (active.size) { showActive(); return }
      cancelTimer(); setState({ phase: 'success', kind })
      const expected = ++sequence
      timer = clock.schedule(() => {
        if (expected !== sequence) return
        timer = undefined; setState({ phase: 'settling', kind })
        timer = clock.schedule(() => {
          if (expected !== sequence) return
          timer = undefined; setState({ phase: 'idle' })
        }, 650)
      }, 1400)
    },
    fail(id: number) {
      if (!active.delete(id)) return
      sequence++; cancelTimer(); showActive()
    },
    dismissCompletion() {
      if (active.size) return
      sequence++; cancelTimer(); setState({ phase: 'idle' })
    },
    dispose() { sequence++; cancelTimer(); active.clear() }
  }
}
