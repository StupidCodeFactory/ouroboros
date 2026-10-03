import { readFileSync } from 'node:fs'

import * as phaseReview from '../hooks/phase_review.ts'

const MIRRORED = {
  'workflows/phase.js': [
    'needsReview', 'samePath', 'sameSpot', 'isCoveredBy', 'reviewersOwningEachFinding', 'touchesOtherFiles',
    'reviewersForRound', 'isInDiff', 'ownerTask', 'withOwner', 'isInOwnDiff', 'triagePhaseFindings', 'checkpointVerdict', 'overlaps', 'waveIndexes', 'taskWaves', 'tasksToRetry', 'distinctFindings',
  ],
}

const squeezed = text => text.replace(/\s+/g, '')

const scriptSource = script => squeezed(readFileSync(new URL(`../${script}`, import.meta.url), 'utf8'))

const driftIn = ([script, names]) => {
  const source = scriptSource(script)
  return names.filter(name => !source.includes(squeezed(`const ${name} = ${phaseReview[name]}`))).map(name => `${script}: ${name} differs from hooks/phase_review.ts`)
}

const drift = Object.entries(MIRRORED).flatMap(driftIn)
if (drift.length > 0) {
  console.error(drift.join('\n'))
  process.exit(1)
}
