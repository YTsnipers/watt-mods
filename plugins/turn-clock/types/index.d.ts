export type Durations = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    'turn-clock': { durations: Durations }
  }
}
