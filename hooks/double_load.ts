type LoadedPlugin = { name: string; root: string }

export const isAnotherInstance = (registering: LoadedPlugin, active: LoadedPlugin) => registering.name === active.name && registering.root !== active.root

export const duplicateLoadWarning = (active: LoadedPlugin, duplicate: { root: string; provenance: string }) =>
  `${active.name} is loaded twice: ${active.root} stays active, ${duplicate.root} (${duplicate.provenance}) is refused so every hook runs once; remove the stale plugin link or install`
