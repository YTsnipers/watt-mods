export type Durations = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    'watt': { durations: Durations }
  }
}
