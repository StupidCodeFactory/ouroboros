export type LaneOwnership = Record<string, string[]>

const escapedLiteral = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

const globPattern = (glob: string) => new RegExp(`^${glob.split('**').map(part => part.split('*').map(escapedLiteral).join('[^/]*')).join('.*')}$`)

const owns = (globs: string[], file: string) => globs.some(glob => globPattern(glob).test(file))

const ownedCount = (globs: string[], files: string[]) => files.filter(file => owns(globs, file)).length

export const laneOfFiles = (files: string[], lanes: LaneOwnership) => {
  const counts = Object.entries(lanes).map(([lane, globs]) => ({ lane, count: ownedCount(globs, files) }))
  const most = Math.max(0, ...counts.map(({ count }) => count))
  const leaders = counts.filter(({ count }) => count === most && count > 0)
  return leaders.length === 1 ? leaders[0]?.lane : undefined
}

export const taskLane = (task: { lane?: string; touches?: string[] }, lanes: LaneOwnership) => {
  if (task.lane !== undefined) return task.lane
  return task.touches === undefined ? undefined : laneOfFiles(task.touches, lanes)
}
