// Whether the terminal is light or dark, adapted from plan-progress (https://github.com/zycck/claude-mods, MIT,
// Copyright (c) 2026 Kirill Serditov).
//
// No terminal answers "what is your background?", so it is inferred as plan-progress does: the Claude Code theme
// setting wins when it names light or dark; "auto", and the stock "dark" inside Terminal.app (whose profiles follow
// macOS), take the macOS appearance. The Linux branches (Omarchy, GNOME) are left out.
import type { EngineInterface } from 'claude-code'

const APPEARANCE_MS = 5000

let themeSetting = 'dark'
let system: 'unknown' | 'mac' | 'none' = 'unknown'
let termProgram = ''
let isSystemDark: boolean | null = null
let appearanceAt = -Infinity
let isProbing = false

export const isLight = (): boolean => {
  const follows =
    system !== 'none' &&
    (themeSetting === 'auto' ||
      (themeSetting === 'dark' && (system === 'unknown' || (system === 'mac' && termProgram === 'Apple_Terminal'))))

  return follows && isSystemDark !== null ? !isSystemDark : /light/i.test(themeSetting)
}

export function setThemeSetting(value: string): void {
  themeSetting = value
  appearanceAt = -Infinity
}

// The theme setting as the session holds it now.
export async function loadThemeSetting($: EngineInterface): Promise<void> {
  const rows = await $.config.list().catch(() => [])
  const theme = rows.find(row => row.key === 'theme')

  themeSetting = String(theme?.value ?? 'dark')
}

// The macOS appearance, read at most every APPEARANCE_MS while something is drawn, and never again once the
// command is missing. The key is absent in light mode, so anything but "Dark" reads as light.
export async function readTint($: EngineInterface, now: number): Promise<void> {
  const follows = themeSetting === 'auto' || themeSetting === 'dark'

  if (isProbing || !follows || system === 'none' || now - appearanceAt < APPEARANCE_MS) {
    return
  }

  isProbing = true
  appearanceAt = now

  try {
    const r = await $.process.run(['defaults', 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: 2000 }).catch(() => null)

    if (r === null) {
      system = 'none'

      return
    }

    if (system === 'unknown') {
      const t = await $.process.run(['/bin/sh', '-c', 'printf %s "$TERM_PROGRAM"'], { timeoutMs: 2000 }).catch(() => null)

      termProgram = t?.stdout.trim() ?? ''
      system = 'mac'
    }

    isSystemDark = /dark/i.test(r.stdout)
  } finally {
    isProbing = false
  }
}
