declare module 'claude-code' {
  interface PluginState {
    ouroboros: {
      openIncidents: number
      retiring: string[]
      planning: { active: boolean; ranThisTurn: boolean }
      skillIndex: Record<string, string>
    }
  }
}
