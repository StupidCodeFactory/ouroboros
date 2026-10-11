export const withoutPluginPrefix = (name: string) => name.replace(/^[\w-]+:/, '')

export const afterLastColon = (name: string) => name.slice(name.lastIndexOf(':') + 1)
