// What the settings window turns, as the plugin holds it now. The plugin's options (`/config`) are the stored side;
// these are read from them when the plugin registers and changed from the window.
export const KEEP_CHOICES = [10, 20, 60, 120]

export const prefs = { keepMs: 20_000, isTwinkling: true, isSoundOn: true, isModelShown: true }

export function loadPrefs(options: Record<string, unknown> | undefined): void {
  const seconds = Number(options?.keepSeconds ?? 20)

  prefs.keepMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 20_000
  prefs.isTwinkling = options?.twinkle !== false
  prefs.isSoundOn = options?.sounds !== false
  prefs.isModelShown = options?.showModel !== false
}
