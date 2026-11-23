import type { Choices } from '../types'

// What the settings window turns, as the plugin holds it now. The plugin's options (`/config`) are the stored side;
// these are read from them when the plugin registers and changed from the window.
export const KEEP_CHOICES = [10, 20, 60, 120]
// the seconds a finished progress bar stays that the window offers; /config takes any
export const DONE_CHOICES = [10, 30, 60]

export const prefs = { keepMs: 20_000, isTwinkling: true, isSoundOn: true, isModelShown: true, isAutoClose: false, doneBarMs: 30_000 }

export function loadPrefs(options: Record<string, unknown> | undefined): void {
  const seconds = Number(options?.keepSeconds ?? 20)
  const doneSeconds = Number(options?.doneBarSeconds ?? 30)

  prefs.keepMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 20_000
  prefs.isTwinkling = options?.twinkle !== false
  prefs.isSoundOn = options?.sounds !== false
  prefs.isModelShown = options?.showModel !== false
  // off until the person turns it on: a finished bar stays until it is closed
  prefs.isAutoClose = options?.autoclose === true
  prefs.doneBarMs = Number.isFinite(doneSeconds) && doneSeconds > 0 ? doneSeconds * 1000 : 30_000
}

export const snapshot = (): Choices => ({
  twinkle: prefs.isTwinkling,
  sounds: prefs.isSoundOn,
  showModel: prefs.isModelShown,
  keepSeconds: Math.round(prefs.keepMs / 1000),
  autoclose: prefs.isAutoClose,
  doneBarSeconds: Math.round(prefs.doneBarMs / 1000),
})
