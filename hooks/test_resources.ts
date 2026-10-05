const HOST_PORT = /([\w.-]+:\d+)/g

export const testDbsIn = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(testDbsIn)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, inner]) => (key === 'test_db' && typeof inner === 'string' ? [inner] : testDbsIn(inner)))
}

const hostPortsOf = (testDb: string) => [...new Set(testDb.match(HOST_PORT) ?? [])]

export const sharedHostPorts = (launching: string[], running: string[]) => {
  const seen = new Map<string, number>()
  for (const testDb of [...launching, ...running]) for (const hostPort of hostPortsOf(testDb)) seen.set(hostPort, (seen.get(hostPort) ?? 0) + 1)
  return [...seen].filter(([, count]) => count > 1).map(([hostPort]) => hostPort)
}
