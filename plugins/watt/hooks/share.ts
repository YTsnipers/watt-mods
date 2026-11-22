// The five-hour and seven-day windows, written to a file CC Switch's provider card reads (served on 127.0.0.1): one
// file per login, so each card shows its own account. The file is named by a hash of the login's token, never the token.
import type { EngineInterface, SessionRateLimit } from 'claude-code'

const hash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

const windowOf = (limits: readonly SessionRateLimit[], kind: string) => {
  const r = limits.find(l => l.kind === kind)

  return r && { used_percentage: r.percentUsed, resets_at: r.resetsAt ? Math.floor(Date.parse(r.resetsAt) / 1000) : null }
}

export async function shareUsage($: EngineInterface, limits: readonly SessionRateLimit[]): Promise<void> {
  if (limits.length === 0) return

  const home = await $.env.get('HOME')

  if (!home) return

  const token = await $.env.get('CLAUDE_CODE_OAUTH_TOKEN')
  const usage = {
    updated_at: Math.floor(Date.now() / 1000),
    five_hour: windowOf(limits, 'five_hour') ?? null,
    seven_day: windowOf(limits, 'seven_day') ?? null,
  }

  await $.fs.write(`${home}/.cache/claude-usage/usage-${token ? hash(token) : 'default'}.json`, JSON.stringify(usage))
}
