/**
 * Offline procedural paper-craft & wooden-bookshelf tactile sound engine.
 * Synthesizes crisp, restrained book-spine ticks, paper rustles, and shelf end bumps
 * using Web Audio API with zero external audio files or network dependencies.
 */

const SOUND_STORAGE_KEY = 'paper-notes-sound-enabled'

let audioCtx: AudioContext | null = null
let noiseBuffer: AudioBuffer | null = null
let soundEnabled = readInitialPreference()
let lastTickAt = 0
let lastMiniTickAt = 0
let lastHoverAt = 0
let lastBumpAt = 0
let unlockBound = false

const listeners = new Set<(enabled: boolean) => void>()

function readInitialPreference(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const saved = window.localStorage.getItem(SOUND_STORAGE_KEY)
    if (saved === '0' || saved === 'false') return false
    if (saved === '1' || saved === 'true') return true
  } catch { /* ignore storage errors */ }
  return true
}

export function isSoundEnabled(): boolean {
  return soundEnabled
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = Boolean(enabled)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? '1' : '0')
    } catch { /* ignore */ }
  }
  listeners.forEach(fn => {
    try { fn(soundEnabled) } catch { /* ignore */ }
  })
}

export function toggleSoundEnabled(): boolean {
  setSoundEnabled(!soundEnabled)
  if (soundEnabled) playBookHover()
  return soundEnabled
}

export function onSoundChange(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getAudioContext(): AudioContext | null {
  if (!soundEnabled || typeof window === 'undefined') return null
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioCtx) {
    try {
      audioCtx = new Ctor()
    } catch {
      return null
    }
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => { /* autoplay blocked until user gesture */ })
  }
  return audioCtx
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.045))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    // Taper noise envelope smoothly toward the tail for crisp paper fiber feel.
    const env = Math.pow(1 - i / length, 1.8)
    data[i] = (Math.random() * 2 - 1) * env
  }
  noiseBuffer = buffer
  return buffer
}

/** Bind one-time global gesture listener to unlock Web Audio in WebView2/browsers cleanly. */
export function ensureShelfAudioUnlocked(): void {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const unlock = () => {
    if (!soundEnabled) return
    const ctx = getAudioContext()
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      window.removeEventListener('wheel', unlock, true)
    }
  }
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true })
  window.addEventListener('keydown', unlock, { capture: true, passive: true })
  window.addEventListener('wheel', unlock, { capture: true, passive: true })
}

function synthPaperTick(options: {
  startFreq: number
  endFreq: number
  toneGain: number
  toneDuration: number
  noiseFreq: number
  noiseQ: number
  noiseGain: number
  noiseDuration: number
}): void {
  const ctx = getAudioContext()
  if (!ctx || ctx.state !== 'running') return
  const now = ctx.currentTime
  const jitter = 0.96 + Math.random() * 0.08

  // Layer 1: Warm wooden / cardstock spine micro-tap
  const osc = ctx.createOscillator()
  const oscGain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(options.startFreq * jitter, now)
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, options.endFreq * jitter), now + options.toneDuration)
  oscGain.gain.setValueAtTime(0.0001, now)
  oscGain.gain.linearRampToValueAtTime(options.toneGain, now + 0.0025)
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + options.toneDuration)
  osc.connect(oscGain)
  oscGain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + options.toneDuration + 0.005)

  // Layer 2: Crisp filtered paper-edge brush transient
  if (options.noiseGain > 0) {
    const src = ctx.createBufferSource()
    src.buffer = getNoiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(options.noiseFreq * jitter, now)
    filter.Q.setValueAtTime(options.noiseQ, now)
    const nGain = ctx.createGain()
    nGain.gain.setValueAtTime(options.noiseGain, now)
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + options.noiseDuration)
    src.connect(filter)
    filter.connect(nGain)
    nGain.connect(ctx.destination)
    src.start(now)
    src.stop(now + options.noiseDuration + 0.005)
  }
}

/** Play tactile sliding book-spine tick while scrolling the 3D bookshelf. */
export function playShelfTick(velocity = 1): void {
  const now = performance.now()
  if (now - lastTickAt < 42) return
  lastTickAt = now
  const clampedV = Math.max(0.4, Math.min(2.4, velocity))
  const pitchBoost = 1 + (clampedV - 1) * 0.14
  synthPaperTick({
    startFreq: 410 * pitchBoost,
    endFreq: 165 * pitchBoost,
    toneGain: 0.058 + Math.min(0.025, clampedV * 0.01),
    toneDuration: 0.024,
    noiseFreq: 2350 * pitchBoost,
    noiseQ: 2.1,
    noiseGain: 0.04,
    noiseDuration: 0.02
  })
}

/** Play lighter miniature spine glide tick for CabinetGallery preview shelf. */
export function playMiniShelfTick(velocity = 1): void {
  const now = performance.now()
  if (now - lastMiniTickAt < 54) return
  lastMiniTickAt = now
  const clampedV = Math.max(0.5, Math.min(2.0, velocity))
  synthPaperTick({
    startFreq: 540 + clampedV * 35,
    endFreq: 260,
    toneGain: 0.036,
    toneDuration: 0.018,
    noiseFreq: 2800,
    noiseQ: 2.4,
    noiseGain: 0.024,
    noiseDuration: 0.015
  })
}

/** Play subtle soft paper lift sound when focusing/hovering a new book. */
export function playBookHover(): void {
  const now = performance.now()
  if (now - lastHoverAt < 65) return
  lastHoverAt = now
  synthPaperTick({
    startFreq: 310,
    endFreq: 175,
    toneGain: 0.028,
    toneDuration: 0.018,
    noiseFreq: 2550,
    noiseQ: 1.9,
    noiseGain: 0.022,
    noiseDuration: 0.016
  })
}

/** Play soft damped wood-edge tap when scrolling reaches start or end of a shelf. */
export function playShelfEdgeBump(): void {
  const now = performance.now()
  if (now - lastBumpAt < 280) return
  lastBumpAt = now
  synthPaperTick({
    startFreq: 155,
    endFreq: 76,
    toneGain: 0.046,
    toneDuration: 0.032,
    noiseFreq: 900,
    noiseQ: 1.5,
    noiseGain: 0.012,
    noiseDuration: 0.018
  })
}

export interface ScrollTickTracker {
  update: (scrollLeft: number, maxScroll: number, nowMs?: number) => { ticked: boolean; bumped: boolean; velocity: number }
  reset: (scrollLeft?: number) => void
}

/**
 * Pure helper that converts continuous horizontal scroll positions into
 * rhythmic per-book tick events and start/end boundary arrival events.
 */
export function createScrollTickTracker(stepPx: number, callbacks?: {
  onTick?: (velocity: number) => void
  onEdgeBump?: () => void
}): ScrollTickTracker {
  const step = Math.max(8, stepPx)
  let lastBucket = 0
  let lastPos = 0
  let lastTime = 0
  let initialized = false
  let atEdge: 'start' | 'end' | null = null

  return {
    reset(scrollLeft = 0) {
      lastPos = scrollLeft
      lastBucket = Math.floor(scrollLeft / step)
      lastTime = 0
      initialized = true
      atEdge = scrollLeft <= 1 ? 'start' : null
    },
    update(scrollLeft: number, maxScroll: number, nowMs = Date.now()) {
      if (!initialized) {
        this.reset(scrollLeft)
        return { ticked: false, bumped: false, velocity: 0 }
      }
      const delta = Math.abs(scrollLeft - lastPos)
      const dt = Math.max(8, lastTime > 0 ? nowMs - lastTime : 16)
      const velocity = Math.min(2.5, Math.max(0.4, (delta / dt) * 1.4))
      lastPos = scrollLeft
      lastTime = nowMs

      let ticked = false
      let bumped = false
      const bucket = Math.floor(scrollLeft / step)
      if (bucket !== lastBucket) {
        lastBucket = bucket
        ticked = true
        callbacks?.onTick?.(velocity)
      }

      if (maxScroll > 4) {
        if (scrollLeft <= 1) {
          if (atEdge !== 'start') {
            atEdge = 'start'
            bumped = true
            callbacks?.onEdgeBump?.()
          }
        } else if (scrollLeft >= maxScroll - 1) {
          if (atEdge !== 'end') {
            atEdge = 'end'
            bumped = true
            callbacks?.onEdgeBump?.()
          }
        } else {
          atEdge = null
        }
      }
      return { ticked, bumped, velocity }
    }
  }
}
