import { readFileSync } from 'node:fs'

import { contractGaps } from '../../hooks/github/contract.ts'
import { openSubIssues, requireEnv } from './scratch_milestone.mjs'

const bodyFileIndex = process.argv.indexOf('--body-file')

const bodyFromFile = () => {
  const path = process.argv[bodyFileIndex + 1]
  return [[path, readFileSync(path, 'utf8')]]
}

const bodiesFromScratchMilestone = () => {
  requireEnv(['OUROBOROS_SCRATCH_REPO', 'OUROBOROS_SCRATCH_ISSUE'])
  const open = openSubIssues(process.env.OUROBOROS_SCRATCH_REPO, process.env.OUROBOROS_SCRATCH_ISSUE)
  if (open.length === 0) {
    console.error('no open sub-issues')
    process.exit(2)
  }
  return open.map(issue => [`#${issue.number}`, issue.body ?? ''])
}

const bodies = bodyFileIndex === -1 ? bodiesFromScratchMilestone() : bodyFromFile()

const gaps = bodies.flatMap(([name, body]) => contractGaps(body).map(section => `${name}: ${section} missing or empty`))
if (gaps.length > 0) {
  console.error(gaps.join('\n'))
  process.exit(1)
}
