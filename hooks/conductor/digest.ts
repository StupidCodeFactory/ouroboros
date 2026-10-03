export const RESULT_LIMIT = 4000
const VALUE_LIMIT = 60

const clip = (text: string) => (text.length <= VALUE_LIMIT ? text : `${text.slice(0, VALUE_LIMIT)}…`)

const field = ([key, value]: [string, unknown]) => {
  if (Array.isArray(value)) return `${key}[${value.length}]`
  if (value === null || typeof value === 'object') return undefined
  return `${key}=${clip(String(value))}`
}

export const digestLine = (result: object) => Object.entries(result).flatMap(entry => field(entry) ?? []).join(' ')

const summary = (result: object, path: string) => `${digestLine(result)}\nfull result: ${path}`

const textOf = (result: unknown) => (typeof result === 'string' ? result : JSON.stringify(result) ?? '')

export const isOversized = (result: unknown) => textOf(result).length > RESULT_LIMIT

export const digestedResult = (tool: string, result: unknown, path: string): unknown => {
  if (!isOversized(result)) return result
  const record = result as Record<string, unknown>
  if (tool === 'Bash') return { ...record, stdout: summary({ ...record, stdout: clip(String(record.stdout ?? '')) }, path) }
  if (tool === 'Agent') return { ...record, content: [{ type: 'text', text: summary({ blocks: record.content }, path) }] }
  return { ...record, summary: summary(record, path) }
}
