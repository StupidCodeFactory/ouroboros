import { readFileSync } from 'node:fs'

import { contractGaps } from '../../hooks/github/contract.ts'
import { scratchSubIssues } from './scratch_milestone.mjs'

const bodyFileIndex = process.argv.indexOf('--body-file')

const bodyFromFile = () => {
  const path = process.argv[bodyFileIndex + 1]
  return [[path, readFileSync(path, 'utf8')]]
}

const bodiesFromScratchMilestone = () =>
  scratchSubIssues()
    .filter(issue => issue.state === 'open')
    .map(issue => [`#${issue.number}`, issue.body ?? ''])

const bodies = bodyFileIndex === -1 ? bodiesFromScratchMilestone() : bodyFromFile()

const gaps = bodies.flatMap(([name, body]) => contractGaps(body).map(section => `${name}: ${section} missing or empty`))
if (gaps.length > 0) {
  console.error(gaps.join('\n'))
  process.exit(1)
}
