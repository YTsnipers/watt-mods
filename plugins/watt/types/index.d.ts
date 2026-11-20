export type Durations = Record<string, number>

export type Choices = { twinkle: boolean; sounds: boolean; showModel: boolean; keepSeconds: number }

declare module 'claude-code' {
  interface PluginState {
    'watt': { durations: Durations; choices: Choices }
  }
}
