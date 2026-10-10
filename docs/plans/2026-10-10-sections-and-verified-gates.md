# Sections and Verified Gates Implementation Plan

> **For agentic workers:** Implement task by task with a fresh subagent per task and a review between tasks. Steps use checkbox (`- [ ]`) syntax for tracking; tick each box as soon as its verification passes.

**Goal:** Replace milestones and phases with plan sections, one run per section, gated by a contract of checks that the plugin itself verifies, with escalation to the user instead of relaxed checks, driven by `/goal` and continued after each merge.

**Architecture:** Pure gate logic lives in `hooks/gate/` (sections, contract, red classification, assertion lint, scope, gate block), unit-tested without the engine. The conductor (`hooks/register.ts` plus `hooks/conductor/`) starts a section by setting a `/goal` and launching `ouroboros:section`; when the run returns, the hook runs the final gate itself with `$.process.run`, prints the gate block, opens the PR with `gh`, and on merge starts the next section. `workflows/section.js` is `workflows/phase.js` with the brief stage replaced by a contract stage and the checkpoint and PR stages removed (the hook does both).

**Tech Stack:** TypeScript hooks on the Claude Code hooks engine (`claude-code` types, `claude-code/testing` test kit, run by `claude plugin test .`), plain-JS workflow scripts, `node --experimental-strip-types` scripts, `git` and `gh` CLIs.

**Spec:** `docs/specs/2026-10-10-sections-and-verified-gates.md`

## Global Constraints

- No code comments; small, well-named functions; early returns.
- No outside skill or plugin names and no home paths in `agents hooks skills workflows scripts README.md`; `scripts/guard_no_outside_skills.sh` must pass.
- `$`-taking code stays in `hooks/register.ts` (the hooks loader refuses `$` passed across an import); everything in `hooks/gate/` and `hooks/conductor/` is pure.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; stage files by name.
- Checks before every commit: `claude plugin test .`, `claude plugin validate .claude-plugin/plugin.json`, `scripts/guard_no_outside_skills.sh`, `node --experimental-strip-types --no-warnings scripts/check_workflow_mirrors.mjs`.
- `$.process.run` runs at most 10 minutes per call; anything longer runs detached and is polled.
- `/goal` is set only through `$.command.run({ command: 'goal', args })` from a `$.clock.after` callback (spike, 2026-10-10); `$.prompt.submit` refuses text starting with `/`.
- The user's merge is the only human gate; nothing auto-merges.
- A red final gate stops at once: no automatic fix rounds after it.

---

## Section A: Spike

### Task 1: Do `tool.call` hooks fire inside workflow agents?

**Files:**
- Create (throwaway, scratchpad only): `<scratchpad>/toolspike/.claude-plugin/plugin.json`, `<scratchpad>/toolspike/hooks/hooks.json`, `<scratchpad>/toolspike/hooks/register.ts`, `<scratchpad>/toolspike/workflows/probe.js`
- Modify: `docs/specs/2026-10-10-sections-and-verified-gates.md` (Risks: replace the `tool.call` line with the result)

- [ ] **Step 1: Write the probe plugin**

`hooks/register.ts`:

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (e.agentId !== undefined && String(e.file_path).endsWith('guarded.txt')) return { deny: 'probe: refused inside a workflow agent' }
    return next(e)
  })
}
```

`workflows/probe.js`:

```js
export const meta = { name: 'probe', description: 'writes guarded.txt from a workflow agent', phases: [{ title: 'Probe' }] }
phase('Probe')
return await agent('Use the Write tool to create guarded.txt containing the word probe. Report exactly what the tool returned.', { label: 'probe' })
```

`plugin.json`: `{ "name": "toolspike", "version": "0.0.1", "description": "spike", "workflows": "./workflows" }`; `hooks.json`: `{ "modules": ["./register.ts"] }`.

- [ ] **Step 2: Run it headless and read the outcome**

Run from an empty scratch directory:

```bash
"<newest bundled claude>" -p 'Run the workflow toolspike:probe and print its result.' --plugin-dir <scratchpad>/toolspike --permission-mode acceptEdits --output-format stream-json --verbose > out.jsonl
```

Expected: either `guarded.txt` is absent and the result quotes "probe: refused inside a workflow agent" (hooks fire), or the file exists (they do not).

- [ ] **Step 3: Record the result in the spec**

Replace the last Risks bullet with one sentence stating which it was. If hooks do not fire, Task 14 is skipped and its boxes are marked `~~…~~ dropped: tool.call does not reach workflow agents (spike 2026-10-10)`.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/2026-10-10-sections-and-verified-gates.md
git commit -m "docs(spec): record whether tool.call reaches workflow agents"
```

## Section B: Gate library

### Task 2: Sections of a plan

**Files:**
- Create: `hooks/gate/sections.ts`
- Test: `hooks/gate/sections.test.ts`

**Interfaces:**
- Produces: `type Section = { heading: string; slug: string; line: number; boxes: SectionBox[] }`, `type SectionBox = { line: number; text: string; ticked: boolean }`, `sectionsOf(planText: string): Section[]`, `nextOpenSection(planText: string): Section | undefined`, `slugOf(heading: string): string`, `openBoxes(section: Section): SectionBox[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'

import { nextOpenSection, openBoxes, sectionsOf, slugOf } from './sections'

const PLAN = [
  '# Plan',
  '## Discovery skips open heal units',
  '### Task 142: skip open units',
  '- [x] **Step 1: test**',
  '- [ ] **Step 2: code**',
  '## Part C: M8 P20 tasks',
  '- [ ] (needs: prod db) run the backfill',
  '- [ ] ~~old~~ dropped: superseded',
  '## Notes',
  'no boxes here',
].join('\n')

test('a section is a level-two heading with the boxes under it, tasks included', () => {
  const [first] = sectionsOf(PLAN)
  expect(first?.heading).toBe('Discovery skips open heal units')
  expect(first?.boxes.map(box => box.ticked)).toEqual([true, false])
})

test('a heading without boxes is not a section', () => {
  expect(sectionsOf(PLAN).map(section => section.heading)).toEqual(['Discovery skips open heal units', 'Part C: M8 P20 tasks'])
})

test('the next section is the first with an open box; needs and dropped boxes are not open', () => {
  expect(nextOpenSection(PLAN)?.slug).toBe('discovery-skips-open-heal-units')
  const done = PLAN.replace('- [ ] **Step 2', '- [x] **Step 2')
  expect(nextOpenSection(done)).toBeUndefined()
})

test('openBoxes lists only work an agent can do', () => {
  const part = sectionsOf(PLAN)[1]
  expect(part && openBoxes(part)).toEqual([])
})

test('a slug is the heading lowercased, non-alphanumerics folded to dashes, at most 50 characters', () => {
  expect(slugOf('Part C: M8 P20 tasks')).toBe('part-c-m8-p20-tasks')
  expect(slugOf('x'.repeat(80)).length).toBe(50)
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|sections'`
Expected: FAIL, `Cannot find module './sections'`.

- [ ] **Step 3: Implement**

```ts
export type SectionBox = { line: number; text: string; ticked: boolean }
export type Section = { heading: string; slug: string; line: number; boxes: SectionBox[] }

const SECTION_HEADING = /^## (.+)$/
const BOX = /^\s*- \[( |x|X)\] (.*)$/
const NEEDS_A_PERSON = /\(needs: [^)]+\)/
const DROPPED = /^~~.*~~ dropped:/
const SLUG_LENGTH = 50

export const slugOf = (heading: string) =>
  heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, SLUG_LENGTH).replace(/-$/, '')

const boxAt = (line: string, index: number): SectionBox | undefined => {
  const match = BOX.exec(line)
  if (!match) return undefined
  return { line: index + 1, text: match[2] as string, ticked: match[1] !== ' ' }
}

const sectionStarts = (lines: string[]) => lines.flatMap((line, index) => (SECTION_HEADING.test(line) ? [index] : []))

const sectionAt = (lines: string[], start: number, end: number): Section => {
  const heading = (SECTION_HEADING.exec(lines[start] as string)?.[1] as string).trim()
  const boxes = lines.slice(start + 1, end).flatMap((line, offset) => boxAt(line, start + 1 + offset) ?? [])
  return { heading, slug: slugOf(heading), line: start + 1, boxes }
}

export const sectionsOf = (planText: string): Section[] => {
  const lines = planText.split('\n')
  const starts = sectionStarts(lines)
  return starts
    .map((start, position) => sectionAt(lines, start, starts[position + 1] ?? lines.length))
    .filter(section => section.boxes.length > 0)
}

const isAgentWork = (box: SectionBox) => !NEEDS_A_PERSON.test(box.text) && !DROPPED.test(box.text)

export const openBoxes = (section: Section) => section.boxes.filter(box => !box.ticked && isAgentWork(box))

export const nextOpenSection = (planText: string) => sectionsOf(planText).find(section => openBoxes(section).length > 0)
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add hooks/gate/sections.ts hooks/gate/sections.test.ts
git commit -m "feat(gate): a plan's sections and the next open one"
```

### Task 3: The contract and its shape checks

**Files:**
- Create: `hooks/gate/contract.ts`
- Test: `hooks/gate/contract.test.ts`
- Modify: `hooks/eager_skills/config.ts` (add `protected`, `no_new`, `red_patterns`, lane `test`/`lint` to `OuroborosConfig`)

**Interfaces:**
- Consumes: `Section`, `openBoxes` (Task 2)
- Produces:
  - `type Check = { criterion: string; command: string; files: string[]; proves: string }`
  - `type Contract = { section: string; criteria: { id: string; text: string; boxes: string[] }[]; done_when: Check[]; must_not: { may_change: string[]; protected: string[]; invariants: { command: string; proves: string }[]; no_new: string[] }; amendments: Amendment[] }`
  - `type Amendment = { at: string; by: 'user'; escalation: string; change: string }`
  - `parseContract(json: string): Contract` (throws with the field name on a bad shape)
  - `withProjectDefaults(contract: Contract, config: Pick<OuroborosConfig, 'protected' | 'no_new'>): Contract`
  - `shapeProblems(contract: Contract, section: Section, laneTests: string[]): string[]`
  - `contractPathOf(draftsDir: string, slug: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'

import { contractPathOf, parseContract, shapeProblems, withProjectDefaults } from './contract'
import { sectionsOf } from './sections'

const SECTION = sectionsOf(['## Skip open units', '- [ ] **Step 1: test**', '- [ ] **Step 2: code**'].join('\n'))[0]!
const CONTRACT = {
  section: 'Skip open units',
  criteria: [{ id: 'c1', text: 'discovery never queues an open unit', boxes: ['Step 1: test', 'Step 2: code'] }],
  done_when: [{ criterion: 'c1', command: 'bundle exec rspec spec/acceptance/skip_spec.rb', files: ['spec/acceptance/skip_spec.rb'], proves: 'open units are skipped' }],
  must_not: { may_change: ['lib/**', 'spec/**'], protected: [], invariants: [], no_new: [] },
  amendments: [],
}

test('a complete contract has no problems', () => {
  expect(shapeProblems(parseContract(JSON.stringify(CONTRACT)), SECTION, ['bundle exec rspec'])).toEqual([])
})

test('a contract with no check, an unchecked criterion, an uncovered box or no scope is refused, each named', () => {
  const bare = { ...CONTRACT, criteria: [{ id: 'c1', text: 't', boxes: ['Step 1: test'] }, { id: 'c2', text: 'u', boxes: [] }], done_when: [], must_not: { ...CONTRACT.must_not, may_change: [] } }
  expect(shapeProblems(parseContract(JSON.stringify(bare)), SECTION, ['bundle exec rspec'])).toEqual([
    'no done_when check',
    'criterion c1 has no check',
    'criterion c2 has no check',
    'plan box "Step 2: code" is covered by no criterion',
    'may_change is empty',
  ])
})

test('a project with no lane test command cannot start a section', () => {
  expect(shapeProblems(parseContract(JSON.stringify(CONTRACT)), SECTION, [])).toEqual(['no lane test command in .claude/ouroboros.json'])
})

test('a malformed contract names the missing field', () => {
  expect(() => parseContract('{"section":"x"}')).toThrow('contract: criteria must be an array')
})

test('project defaults are merged into protected and no_new without duplicates', () => {
  const merged = withProjectDefaults(parseContract(JSON.stringify({ ...CONTRACT, must_not: { ...CONTRACT.must_not, no_new: ['xit'] } })), { protected: ['db/migrations/**'], no_new: ['xit', 'rubocop:disable'] })
  expect(merged.must_not.protected).toEqual(['db/migrations/**'])
  expect(merged.must_not.no_new).toEqual(['xit', 'rubocop:disable'])
})

test('the contract lives under the drafts dir, named by the section slug', () => {
  expect(contractPathOf('docs/drafts', 'skip-open-units')).toBe('docs/drafts/contracts/skip-open-units.json')
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./contract` not found.

- [ ] **Step 3: Implement**

`hooks/gate/contract.ts`:

```ts
import type { Section } from './sections'
import { openBoxes } from './sections'

export type Check = { criterion: string; command: string; files: string[]; proves: string }
export type Amendment = { at: string; by: 'user'; escalation: string; change: string }
export type Criterion = { id: string; text: string; boxes: string[] }
export type MustNot = { may_change: string[]; protected: string[]; invariants: { command: string; proves: string }[]; no_new: string[] }
export type Contract = { section: string; criteria: Criterion[]; done_when: Check[]; must_not: MustNot; amendments: Amendment[] }
export type ContractDefaults = { protected?: string[]; no_new?: string[] }

const requireArray = (value: unknown, field: string) => {
  if (!Array.isArray(value)) throw new Error(`contract: ${field} must be an array`)
  return value
}

export const parseContract = (json: string): Contract => {
  const raw = JSON.parse(json)
  requireArray(raw.criteria, 'criteria')
  requireArray(raw.done_when, 'done_when')
  if (typeof raw.must_not !== 'object' || raw.must_not === null) throw new Error('contract: must_not must be an object')
  return {
    section: String(raw.section ?? ''),
    criteria: raw.criteria,
    done_when: raw.done_when,
    must_not: {
      may_change: requireArray(raw.must_not.may_change ?? [], 'must_not.may_change'),
      protected: requireArray(raw.must_not.protected ?? [], 'must_not.protected'),
      invariants: requireArray(raw.must_not.invariants ?? [], 'must_not.invariants'),
      no_new: requireArray(raw.must_not.no_new ?? [], 'must_not.no_new'),
    },
    amendments: requireArray(raw.amendments ?? [], 'amendments'),
  }
}

const union = (first: string[], second: string[] = []) => [...new Set([...first, ...second])]

export const withProjectDefaults = (contract: Contract, defaults: ContractDefaults): Contract => ({
  ...contract,
  must_not: { ...contract.must_not, protected: union(contract.must_not.protected, defaults.protected), no_new: union(contract.must_not.no_new, defaults.no_new) },
})

const boxLabel = (text: string) => text.replace(/\*\*/g, '').trim()

const isCovered = (contract: Contract, text: string) => contract.criteria.some(criterion => criterion.boxes.some(box => boxLabel(text).startsWith(boxLabel(box))))

const uncheckedCriteria = (contract: Contract) => contract.criteria.filter(criterion => !contract.done_when.some(check => check.criterion === criterion.id))

export const shapeProblems = (contract: Contract, section: Section, laneTests: string[]): string[] => {
  if (laneTests.length === 0) return ['no lane test command in .claude/ouroboros.json']
  return [
    ...(contract.done_when.length === 0 ? ['no done_when check'] : []),
    ...uncheckedCriteria(contract).map(criterion => `criterion ${criterion.id} has no check`),
    ...openBoxes(section).filter(box => !isCovered(contract, box.text)).map(box => `plan box "${boxLabel(box.text)}" is covered by no criterion`),
    ...(contract.must_not.may_change.length === 0 ? ['may_change is empty'] : []),
  ]
}

export const contractPathOf = (draftsDir: string, slug: string) => `${draftsDir}/contracts/${slug}.json`
```

In `hooks/eager_skills/config.ts`, extend the types:

```ts
export type LaneSettings = { owned_paths?: string[]; env_notes?: string[]; test?: string; lint?: string }
export type OuroborosConfig = {
  lanes?: Record<string, LaneSettings>
  protected?: string[]
  no_new?: string[]
  red_patterns?: Record<string, { ran: string; assertion: string }>
  merge_policy?: 'ask' | 'architect'
  branch_prefix?: string
  agents?: Record<string, AgentConfig>
  planning_skills?: string[]
  eager_skills_max_chars?: number
  drafts_dir?: string
  effort?: Partial<Record<Stage, Effort>>
  models?: Partial<Record<'implementer' | 'reviewer' | 'architect' | 'auditor', string>>
}
```

(`lanes` replaces the inline type; `laneEnvNotes` keeps working since it only reads `env_notes`.)

- [ ] **Step 4: Run the tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add hooks/gate/contract.ts hooks/gate/contract.test.ts hooks/eager_skills/config.ts
git commit -m "feat(gate): the section contract and its shape checks"
```

### Task 4: Red for the right reason

**Files:**
- Create: `hooks/gate/red.ts`
- Test: `hooks/gate/red.test.ts`

**Interfaces:**
- Produces: `type RedVerdict = 'red' | 'green' | 'wrong-red' | 'unclassified'`, `type RunnerPatterns = { ran: RegExp; assertion: RegExp }`, `redVerdict(output: string, exitCode: number, extra?: Record<string, { ran: string; assertion: string }>): { verdict: RedVerdict; runner?: string }`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'

import { redVerdict } from './red'

const RSPEC_RED = '2 examples, 1 failure\n\nFailures:\n  1) skips open units\n     Failure/Error: expect(queued).to be_empty\n       expected `[1].empty?` to be truthy'
const RSPEC_LOAD = "An error occurred while loading ./spec/acceptance/skip_spec.rb.\nNameError: uninitialized constant Skip\n0 examples, 0 failures, 1 error occurred outside of examples"
const PYTEST_RED = '=========== 1 failed, 3 passed in 0.12s ===========\nE       AssertionError: assert 2 == 1'
const PYTEST_IMPORT = 'ERROR collecting tests/test_x.py\nImportError: cannot import name'
const JEST_RED = 'Tests:       1 failed, 2 passed, 3 total\n    expect(received).toBe(expected)'
const GO_RED = '--- FAIL: TestSkip (0.00s)\n    skip_test.go:12: got 2, want 1\nFAIL'

test('an assertion failure after examples ran is red', () => {
  expect(redVerdict(RSPEC_RED, 1)).toEqual({ verdict: 'red', runner: 'rspec' })
  expect(redVerdict(PYTEST_RED, 1)).toEqual({ verdict: 'red', runner: 'pytest' })
  expect(redVerdict(JEST_RED, 1)).toEqual({ verdict: 'red', runner: 'jest' })
  expect(redVerdict(GO_RED, 1)).toEqual({ verdict: 'red', runner: 'go' })
})

test('a load or import error, or zero examples, is red for the wrong reason', () => {
  expect(redVerdict(RSPEC_LOAD, 1)).toEqual({ verdict: 'wrong-red', runner: 'rspec' })
  expect(redVerdict(PYTEST_IMPORT, 2)).toEqual({ verdict: 'wrong-red', runner: 'pytest' })
})

test('exit 0 is green whatever the output says', () => {
  expect(redVerdict(RSPEC_RED, 0).verdict).toBe('green')
})

test('output no runner pattern recognises is unclassified, never red', () => {
  expect(redVerdict('make: *** [check] Error 2', 2)).toEqual({ verdict: 'unclassified' })
})

test('a project pattern classifies its own runner', () => {
  const extra = { bats: { ran: '^\\d+\\.\\.\\d+', assertion: '^not ok' } }
  expect(redVerdict('1..2\nok 1 a\nnot ok 2 b', 1, extra)).toEqual({ verdict: 'red', runner: 'bats' })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./red` not found.

- [ ] **Step 3: Implement**

```ts
export type RedVerdict = 'red' | 'green' | 'wrong-red' | 'unclassified'
export type RunnerPatterns = { ran: RegExp; assertion: RegExp }

const RUNNERS: Record<string, RunnerPatterns> = {
  rspec: { ran: /^\s*[1-9]\d* examples?, [1-9]\d* failures?/m, assertion: /Failure\/Error:/ },
  pytest: { ran: /=+ .*\b[1-9]\d* failed\b/m, assertion: /^E\s+AssertionError|^E\s+assert /m },
  jest: { ran: /^Tests:\s+[1-9]\d* failed/m, assertion: /expect\(received\)/ },
  go: { ran: /^--- FAIL: /m, assertion: /_test\.go:\d+:/ },
}

const RUNNER_SIGNS: Record<string, RegExp> = {
  rspec: /\bexamples?, \d+ failures?|An error occurred while loading/,
  pytest: /=+ .*(failed|passed|error)|ERROR collecting/,
  jest: /^Tests:\s/m,
  go: /^(--- FAIL|FAIL|ok)\s/m,
}

const compiled = (extra: Record<string, { ran: string; assertion: string }>) =>
  Object.fromEntries(Object.entries(extra).map(([name, patterns]) => [name, { ran: new RegExp(patterns.ran, 'm'), assertion: new RegExp(patterns.assertion, 'm') }]))

const recognisedRunner = (output: string, runners: Record<string, RunnerPatterns>, signs: Record<string, RegExp>) =>
  Object.keys(runners).find(name => (signs[name] ?? runners[name]?.ran)?.test(output))

export const redVerdict = (output: string, exitCode: number, extra: Record<string, { ran: string; assertion: string }> = {}) => {
  if (exitCode === 0) return { verdict: 'green' as RedVerdict }
  const projectRunners = compiled(extra)
  const runners = { ...projectRunners, ...RUNNERS }
  const signs = { ...Object.fromEntries(Object.entries(projectRunners).map(([name, patterns]) => [name, patterns.ran])), ...RUNNER_SIGNS }
  const runner = recognisedRunner(output, runners, signs)
  if (runner === undefined) return { verdict: 'unclassified' as RedVerdict }
  const patterns = runners[runner] as RunnerPatterns
  const isRed = patterns.ran.test(output) && patterns.assertion.test(output)
  return { verdict: (isRed ? 'red' : 'wrong-red') as RedVerdict, runner }
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add hooks/gate/red.ts hooks/gate/red.test.ts
git commit -m "feat(gate): tell a check red for the right reason from one red for the wrong one"
```

### Task 5: Assertion lint

**Files:**
- Create: `hooks/gate/assertion_lint.ts`
- Test: `hooks/gate/assertion_lint.test.ts`

**Interfaces:**
- Produces: `type LintHit = { file: string; line: number; rule: string }`, `assertionLint(file: string, text: string): LintHit[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'

import { assertionLint } from './assertion_lint'

test('a spec with real assertions is clean', () => {
  const spec = "it 'skips open units' do\n  expect(queued).to contain_exactly(unit)\nend\n"
  expect(assertionLint('spec/acceptance/skip_spec.rb', spec)).toEqual([])
})

test('a ruby example with no expectation, a truthiness-only one, a pending one and a mocked subject are flagged', () => {
  const spec = [
    "it 'runs' do",
    '  run_it',
    'end',
    "it 'is there' do",
    '  expect(result).to be_truthy',
    'end',
    "xit 'later' do",
    "  expect(1).to eq(1)",
    'end',
    "it 'mocks itself' do",
    '  allow(subject).to receive(:call).and_return(1)',
    '  expect(subject.call).to eq(1)',
    'end',
  ].join('\n')
  expect(assertionLint('spec/x_spec.rb', spec).map(hit => [hit.line, hit.rule])).toEqual([
    [1, 'example without an assertion'],
    [5, 'assertion only checks truthiness, nil or no error'],
    [7, 'pending or skipped example'],
    [11, 'the unit under test is mocked'],
  ])
})

test('python tests get the same rules', () => {
  const test_file = ['def test_runs():', '    run_it()', '', '@pytest.mark.skip', 'def test_later():', '    assert x == 1', '', 'def test_truthy():', '    assert result'].join('\n')
  expect(assertionLint('tests/test_x.py', test_file).map(hit => [hit.line, hit.rule])).toEqual([
    [1, 'example without an assertion'],
    [4, 'pending or skipped example'],
    [9, 'assertion only checks truthiness, nil or no error'],
  ])
})

test('files of other languages are not linted', () => {
  expect(assertionLint('docs/readme.md', 'it runs')).toEqual([])
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./assertion_lint` not found.

- [ ] **Step 3: Implement**

```ts
export type LintHit = { file: string; line: number; rule: string }
type Language = { example: RegExp; end: (lines: string[], start: number) => number; assertion: RegExp; weak: RegExp; skipped: RegExp; mockedSubject: RegExp }

const NO_ASSERTION = 'example without an assertion'
const WEAK = 'assertion only checks truthiness, nil or no error'
const SKIPPED = 'pending or skipped example'
const MOCKED = 'the unit under test is mocked'

const rubyEnd = (lines: string[], start: number) => {
  const indent = /^\s*/.exec(lines[start] as string)?.[0].length ?? 0
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^\\s{${indent}}end\\b`).test(line))
  return end === -1 ? lines.length : end
}

const pythonEnd = (lines: string[], start: number) => {
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line))
  return end === -1 ? lines.length : end
}

const RUBY: Language = {
  example: /^\s*(it|specify|example)\b/,
  end: rubyEnd,
  assertion: /\bexpect\b|\bis_expected\b|\bshould\b/,
  weak: /\.to\s+(be_truthy|be_falsey|be_nil|be\b(?!_))|not_to\s+raise_error|to_not\s+raise_error/,
  skipped: /^\s*(xit|xspecify|pending|skip)\b|^\s*it\b.*\bskip:/,
  mockedSubject: /allow\(subject\)|expect\(subject\)\.to receive/,
}

const PYTHON: Language = {
  example: /^def test_/,
  end: pythonEnd,
  assertion: /\bassert\b|pytest\.raises/,
  weak: /^\s*assert\s+[\w.]+\s*$|is not None\s*$/,
  skipped: /^@pytest\.mark\.(skip|xfail)|^@unittest\.skip/,
  mockedSubject: /mock\.patch\.object\(subject/,
}

const languageOf = (file: string) => {
  if (/_spec\.rb$/.test(file)) return RUBY
  if (/(^|\/)test_[^/]*\.py$|_test\.py$/.test(file)) return PYTHON
  return undefined
}

const hit = (file: string, index: number, rule: string): LintHit => ({ file, line: index + 1, rule })

const lineHits = (file: string, lines: string[], language: Language) =>
  lines.flatMap((line, index) => [
    ...(language.weak.test(line) ? [hit(file, index, WEAK)] : []),
    ...(language.skipped.test(line) ? [hit(file, index, SKIPPED)] : []),
    ...(language.mockedSubject.test(line) ? [hit(file, index, MOCKED)] : []),
  ])

const examplesWithoutAssertion = (file: string, lines: string[], language: Language) =>
  lines.flatMap((line, index) => {
    if (!language.example.test(line) || language.skipped.test(line)) return []
    const body = lines.slice(index + 1, language.end(lines, index))
    return body.some(bodyLine => language.assertion.test(bodyLine)) ? [] : [hit(file, index, NO_ASSERTION)]
  })

export const assertionLint = (file: string, text: string): LintHit[] => {
  const language = languageOf(file)
  if (language === undefined) return []
  const lines = text.split('\n')
  return [...examplesWithoutAssertion(file, lines, language), ...lineHits(file, lines, language)].sort((left, right) => left.line - right.line)
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail. If the `[7, …]` case also reports line 7 as "without an assertion", the `skipped` guard in `examplesWithoutAssertion` is missing.

- [ ] **Step 5: Commit**

```bash
git add hooks/gate/assertion_lint.ts hooks/gate/assertion_lint.test.ts
git commit -m "feat(gate): lint checks for missing, weak, skipped or self-mocking assertions"
```

### Task 6: Scope fence, protected paths and forbidden additions

**Files:**
- Modify: `hooks/conductor/lanes.ts` (export `owns`)
- Create: `hooks/gate/scope.ts`
- Test: `hooks/gate/scope.test.ts`

**Interfaces:**
- Consumes: `Contract` (Task 3), `owns(globs: string[], file: string): boolean` from `hooks/conductor/lanes.ts`
- Produces: `scopeBreaks(changed: string[], contract: Contract, exempt: string[]): string[]`, `addedLines(unifiedDiff: string): { file: string; line: number; text: string }[]`, `noNewHits(added: { file: string; line: number; text: string }[], patterns: string[]): string[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'

import type { Contract } from './contract'
import { addedLines, noNewHits, scopeBreaks } from './scope'

const CONTRACT = {
  section: 's', criteria: [], done_when: [], amendments: [],
  must_not: { may_change: ['lib/backfill/**', 'spec/**', 'db/migrations/20261010_add.rb'], protected: ['db/migrations/**', '.github/**'], invariants: [], no_new: [] },
} as Contract

test('files inside may_change, and exempt files, are in scope', () => {
  expect(scopeBreaks(['lib/backfill/runner.rb', 'spec/x_spec.rb', 'docs/drafts/plan.md'], CONTRACT, ['docs/drafts/plan.md'])).toEqual([])
})

test('a file outside may_change, or protected and not named in may_change, breaks scope', () => {
  expect(scopeBreaks(['lib/web/api.rb', '.github/workflows/ci.yml', 'db/migrations/20261010_add.rb'], CONTRACT, [])).toEqual([
    'lib/web/api.rb is outside may_change',
    '.github/workflows/ci.yml is protected',
  ])
})

test('only added lines are scanned for forbidden patterns', () => {
  const diff = [
    'diff --git a/lib/a.rb b/lib/a.rb',
    '+++ b/lib/a.rb',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '-def x # rubocop:disable Metrics',
    '+def x(a, b, c, d, e, f) # rubocop:disable Metrics/ParameterLists',
    ' end',
  ].join('\n')
  const added = addedLines(diff)
  expect(added).toEqual([{ file: 'lib/a.rb', line: 2, text: 'def x(a, b, c, d, e, f) # rubocop:disable Metrics/ParameterLists' }])
  expect(noNewHits(added, ['rubocop:disable', '\\bxit\\b'])).toEqual(['lib/a.rb:2 adds rubocop:disable'])
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./scope` not found.

- [ ] **Step 3: Implement**

In `hooks/conductor/lanes.ts` change `const owns =` to `export const owns =`.

`hooks/gate/scope.ts`:

```ts
import { owns } from '../conductor/lanes'
import type { Contract } from './contract'

export type AddedLine = { file: string; line: number; text: string }

const isNamedExactly = (contract: Contract, file: string) => contract.must_not.may_change.includes(file)

const breakOf = (contract: Contract, file: string) => {
  if (owns(contract.must_not.protected, file) && !isNamedExactly(contract, file)) return `${file} is protected`
  if (!owns(contract.must_not.may_change, file)) return `${file} is outside may_change`
  return undefined
}

export const scopeBreaks = (changed: string[], contract: Contract, exempt: string[]) =>
  changed.filter(file => !exempt.includes(file)).flatMap(file => breakOf(contract, file) ?? [])

const FILE_HEADER = /^\+\+\+ b\/(.+)$/
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export const addedLines = (unifiedDiff: string): AddedLine[] => {
  const added: AddedLine[] = []
  let file = ''
  let next = 0
  for (const line of unifiedDiff.split('\n')) {
    const header = FILE_HEADER.exec(line)
    if (header) { file = header[1] as string; continue }
    const hunk = HUNK.exec(line)
    if (hunk) { next = Number(hunk[1]); continue }
    if (line.startsWith('+')) { added.push({ file, line: next, text: line.slice(1) }); next += 1; continue }
    if (!line.startsWith('-')) next += 1
  }
  return added
}

export const noNewHits = (added: AddedLine[], patterns: string[]) =>
  patterns.flatMap(pattern => added.filter(line => new RegExp(pattern).test(line.text)).map(line => `${line.file}:${line.line} adds ${pattern}`))
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail (the existing lanes tests still pass).

- [ ] **Step 5: Commit**

```bash
git add hooks/conductor/lanes.ts hooks/gate/scope.ts hooks/gate/scope.test.ts
git commit -m "feat(gate): scope fence, protected paths and forbidden additions"
```

### Task 7: The gate verdict and its block

**Files:**
- Create: `hooks/gate/verdict.ts`
- Test: `hooks/gate/verdict.test.ts`

**Interfaces:**
- Consumes: `Contract`, `Check` (Task 3), `RedVerdict` (Task 4)
- Produces:
  - `type CommandResult = { label: string; command: string; exitCode: number; tail: string }`
  - `type GateFacts = { heading: string; sha: string; redSha: string; done: CommandResult[]; invariants: CommandResult[]; lanes: CommandResult[]; scope: string[]; changedCount: number; noNew: string[]; changedChecks: string[]; amendments: number; boxes: { ticked: number; total: number }; redAtRedSha: { command: string; verdict: RedVerdict }[] }`
  - `gateFailures(facts: GateFacts): string[]`
  - `gateBlock(facts: GateFacts): string` (first line `GATE PASS section "<heading>" at <sha>` or `GATE FAIL …`)
  - `pullRequestBody(facts: GateFacts, contract: Contract): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'

import type { GateFacts } from './verdict'
import { gateBlock, gateFailures, pullRequestBody } from './verdict'

const PASSING: GateFacts = {
  heading: 'Skip open units', sha: 'abc1234', redSha: 'def5678',
  done: [{ label: 'c1', command: 'bundle exec rspec spec/acceptance/skip_spec.rb', exitCode: 0, tail: '1 example, 0 failures' }],
  invariants: [{ label: 'invariant', command: 'bundle exec rspec spec/acceptance', exitCode: 0, tail: '' }],
  lanes: [{ label: 'ruby test', command: 'bundle exec rspec', exitCode: 0, tail: '' }, { label: 'ruby lint', command: 'bundle exec rubocop', exitCode: 0, tail: '' }],
  scope: [], changedCount: 14, noNew: [], changedChecks: [], amendments: 0,
  boxes: { ticked: 9, total: 9 },
  redAtRedSha: [{ command: 'bundle exec rspec spec/acceptance/skip_spec.rb', verdict: 'red' }],
}

test('a gate with every fact green passes and prints the fixed block', () => {
  expect(gateFailures(PASSING)).toEqual([])
  expect(gateBlock(PASSING)).toBe([
    'GATE PASS section "Skip open units" at abc1234',
    '  done_when  c1 bundle exec rspec spec/acceptance/skip_spec.rb  exit 0',
    '  invariant  bundle exec rspec spec/acceptance  exit 0',
    '  lane       ruby test bundle exec rspec  exit 0',
    '  lane       ruby lint bundle exec rubocop  exit 0',
    '  red first  1/1 checks red for the right reason at def5678',
    '  scope      14 files, all inside may_change, none protected',
    '  no_new     0 hits',
    '  checks     unchanged since def5678 (0 amendments)',
    '  plan       9/9 boxes',
  ].join('\n'))
})

test('every failing fact is listed, with the tail of a failed command', () => {
  const failing = {
    ...PASSING,
    done: [{ ...PASSING.done[0]!, exitCode: 1, tail: '1 example, 1 failure' }],
    scope: ['lib/web/api.rb is outside may_change'],
    noNew: ['lib/a.rb:2 adds rubocop:disable'],
    changedChecks: ['spec/acceptance/skip_spec.rb'],
    boxes: { ticked: 8, total: 9 },
    redAtRedSha: [{ command: 'bundle exec rspec spec/acceptance/skip_spec.rb', verdict: 'wrong-red' as const }],
  }
  expect(gateFailures(failing)).toEqual([
    'c1 bundle exec rspec spec/acceptance/skip_spec.rb exited 1: 1 example, 1 failure',
    'bundle exec rspec spec/acceptance/skip_spec.rb was not red for the right reason at def5678 (wrong-red)',
    'lib/web/api.rb is outside may_change',
    'lib/a.rb:2 adds rubocop:disable',
    'spec/acceptance/skip_spec.rb changed after the red commit without a user amendment',
    '1 plan box still open',
  ])
  expect(gateBlock(failing).split('\n')[0]).toBe('GATE FAIL section "Skip open units" at abc1234')
})

test('the PR body carries the criteria and the gate block as evidence', () => {
  const contract = { section: 'Skip open units', criteria: [{ id: 'c1', text: 'discovery never queues an open unit', boxes: [] }], done_when: [], must_not: { may_change: [], protected: [], invariants: [], no_new: [] }, amendments: [] }
  const body = pullRequestBody(PASSING, contract)
  expect(body).toContain('- c1: discovery never queues an open unit')
  expect(body).toContain('GATE PASS section "Skip open units" at abc1234')
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./verdict` not found.

- [ ] **Step 3: Implement**

```ts
import type { Contract } from './contract'
import type { RedVerdict } from './red'

export type CommandResult = { label: string; command: string; exitCode: number; tail: string }
export type GateFacts = {
  heading: string
  sha: string
  redSha: string
  done: CommandResult[]
  invariants: CommandResult[]
  lanes: CommandResult[]
  scope: string[]
  changedCount: number
  noNew: string[]
  changedChecks: string[]
  amendments: number
  boxes: { ticked: number; total: number }
  redAtRedSha: { command: string; verdict: RedVerdict }[]
}

const failedCommand = (result: CommandResult) => `${result.label === 'invariant' ? '' : `${result.label} `}${result.command} exited ${result.exitCode}: ${result.tail}`.trim()

const notRedFirst = (facts: GateFacts) =>
  facts.redAtRedSha.filter(entry => entry.verdict !== 'red').map(entry => `${entry.command} was not red for the right reason at ${facts.redSha} (${entry.verdict})`)

const openBoxCount = (facts: GateFacts) => facts.boxes.total - facts.boxes.ticked

export const gateFailures = (facts: GateFacts) => [
  ...facts.done.filter(result => result.exitCode !== 0).map(failedCommand),
  ...notRedFirst(facts),
  ...facts.invariants.filter(result => result.exitCode !== 0).map(failedCommand),
  ...facts.lanes.filter(result => result.exitCode !== 0).map(failedCommand),
  ...facts.scope,
  ...facts.noNew,
  ...facts.changedChecks.map(file => `${file} changed after the red commit without a user amendment`),
  ...(openBoxCount(facts) > 0 ? [`${openBoxCount(facts)} plan box${openBoxCount(facts) === 1 ? '' : 'es'} still open`] : []),
]

const commandLine = (kind: string, result: CommandResult) => `  ${kind.padEnd(10)} ${result.label === 'invariant' ? '' : `${result.label} `}${result.command}  exit ${result.exitCode}`

const redFirstLine = (facts: GateFacts) => {
  const red = facts.redAtRedSha.filter(entry => entry.verdict === 'red').length
  return `  red first  ${red}/${facts.redAtRedSha.length} checks red for the right reason at ${facts.redSha}`
}

const scopeLine = (facts: GateFacts) =>
  facts.scope.length === 0 ? `  scope      ${facts.changedCount} files, all inside may_change, none protected` : `  scope      ${facts.scope.length} breaks: ${facts.scope.join('; ')}`

const checksLine = (facts: GateFacts) =>
  facts.changedChecks.length === 0 ? `  checks     unchanged since ${facts.redSha} (${facts.amendments} amendments)` : `  checks     changed without amendment: ${facts.changedChecks.join(', ')}`

export const gateBlock = (facts: GateFacts) => {
  const verdict = gateFailures(facts).length === 0 ? 'PASS' : 'FAIL'
  return [
    `GATE ${verdict} section "${facts.heading}" at ${facts.sha}`,
    ...facts.done.map(result => commandLine('done_when', result)),
    ...facts.invariants.map(result => commandLine('invariant', result)),
    ...facts.lanes.map(result => commandLine('lane', result)),
    redFirstLine(facts),
    scopeLine(facts),
    `  no_new     ${facts.noNew.length} hits`,
    checksLine(facts),
    `  plan       ${facts.boxes.ticked}/${facts.boxes.total} boxes`,
  ].join('\n')
}

export const pullRequestBody = (facts: GateFacts, contract: Contract) => [
  '## Criteria',
  ...contract.criteria.map(criterion => `- ${criterion.id}: ${criterion.text}`),
  '',
  '## Gate',
  '```',
  gateBlock(facts),
  '```',
  ...(gateFailures(facts).length === 0 ? [] : ['', '## Failures', ...gateFailures(facts).map(failure => `- [ ] ${failure}`)]),
  ...(contract.amendments.length === 0 ? [] : ['', '## Contract amendments (approved by the user)', ...contract.amendments.map(amendment => `- ${amendment.at}: ${amendment.change}`)]),
].join('\n')
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add hooks/gate/verdict.ts hooks/gate/verdict.test.ts
git commit -m "feat(gate): the gate verdict, its transcript block and the PR body"
```

## Section C: Section workflow

### Task 8: `scripts/contract_check.mjs`, the agents' early check

**Files:**
- Create: `scripts/contract_check.mjs`
- Test: `scripts/contract_check.test.ts` (run by `claude plugin test .`, via `$.process.run`-free pure import of a `checkReport` export)

**Interfaces:**
- Consumes: `parseContract`, `shapeProblems` (Task 3), `redVerdict` (Task 4), `assertionLint` (Task 5), `sectionsOf`, `slugOf` (Task 2)
- Produces: CLI `node --experimental-strip-types --no-warnings <plugin>/scripts/contract_check.mjs <plan> <contract> [--config .claude/ouroboros.json]` printing one JSON object `{ ok: boolean, problems: string[], red: { command: string, verdict: string }[], lint: { file, line, rule }[] }` and exiting 0 when `ok`, 1 otherwise. Agents run it for early feedback; the hook re-checks everything itself at the gate.

- [ ] **Step 1: Write the failing test of the pure report**

```ts
import { expect, test } from 'claude-code/testing'

import { checkReport } from './contract_check.mjs'

const PLAN = '## Skip open units\n- [ ] **Step 1: test**\n'
const CONTRACT = JSON.stringify({
  section: 'Skip open units',
  criteria: [{ id: 'c1', text: 't', boxes: ['Step 1: test'] }],
  done_when: [{ criterion: 'c1', command: 'rspec x', files: ['spec/x_spec.rb'], proves: 'p' }],
  must_not: { may_change: ['lib/**'], protected: [], invariants: [], no_new: [] },
  amendments: [],
})

test('a contract whose checks are red for the right reason and lint clean is ok', () => {
  const report = checkReport({ planText: PLAN, contractJson: CONTRACT, config: { lanes: { ruby: { test: 'rspec' } } }, runs: [{ command: 'rspec x', exitCode: 1, output: '1 example, 1 failure\nFailure/Error: expect(a).to eq(1)' }], files: { 'spec/x_spec.rb': "it 'x' do\n  expect(a).to eq(1)\nend\n" } })
  expect(report).toEqual({ ok: true, problems: [], red: [{ command: 'rspec x', verdict: 'red' }], lint: [] })
})

test('an invariant already red before any code is a problem', () => {
  const withInvariant = JSON.stringify({ ...JSON.parse(CONTRACT), must_not: { may_change: ['lib/**'], protected: [], invariants: [{ command: 'rspec spec', proves: 'p' }], no_new: [] } })
  const report = checkReport({ planText: PLAN, contractJson: withInvariant, config: { lanes: { ruby: { test: 'rspec' } } }, runs: [{ command: 'rspec x', exitCode: 1, output: '1 example, 1 failure\nFailure/Error: expect(a).to eq(1)' }], files: { 'spec/x_spec.rb': "it 'x' do\n  expect(a).to eq(1)\nend\n" }, invariantRuns: [{ command: 'rspec spec', exitCode: 1, output: '' }] })
  expect(report.problems).toEqual(['invariant rspec spec is red before any code'])
})

test('a green check is a problem: it proves nothing yet', () => {
  const report = checkReport({ planText: PLAN, contractJson: CONTRACT, config: { lanes: { ruby: { test: 'rspec' } } }, runs: [{ command: 'rspec x', exitCode: 0, output: '1 example, 0 failures' }], files: { 'spec/x_spec.rb': "it 'x' do\n  expect(a).to eq(1)\nend\n" } })
  expect(report.ok).toBe(false)
  expect(report.problems).toContain('rspec x is green before any code: it proves nothing')
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./contract_check.mjs` not found.

- [ ] **Step 3: Implement**

```js
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { assertionLint } from '../hooks/gate/assertion_lint.ts'
import { parseContract, shapeProblems, withProjectDefaults } from '../hooks/gate/contract.ts'
import { redVerdict } from '../hooks/gate/red.ts'
import { sectionsOf } from '../hooks/gate/sections.ts'

const laneTests = config => Object.values(config.lanes ?? {}).flatMap(lane => (lane.test ? [lane.test] : []))

const redProblem = run => {
  if (run.verdict === 'green') return `${run.command} is green before any code: it proves nothing`
  if (run.verdict !== 'red') return `${run.command} is red for the wrong reason (${run.verdict})`
  return undefined
}

export const checkReport = ({ planText, contractJson, config, runs, files, invariantRuns = [] }) => {
  const contract = withProjectDefaults(parseContract(contractJson), config)
  const section = sectionsOf(planText).find(candidate => candidate.heading === contract.section)
  if (section === undefined) return { ok: false, problems: [`no section "${contract.section}" in the plan`], red: [], lint: [] }
  const red = runs.map(run => ({ command: run.command, verdict: redVerdict(run.output, run.exitCode, config.red_patterns ?? {}).verdict }))
  const lint = contract.done_when.flatMap(check => check.files.flatMap(file => assertionLint(file, files[file] ?? '')))
  const redInvariants = invariantRuns.filter(run => run.exitCode !== 0).map(run => `invariant ${run.command} is red before any code`)
  const problems = [...shapeProblems(contract, section, laneTests(config)), ...red.flatMap(run => redProblem(run) ?? []), ...lint.map(hit => `${hit.file}:${hit.line} ${hit.rule}`), ...redInvariants]
  return { ok: problems.length === 0, problems, red, lint }
}

const runCheck = command => {
  try {
    return { command, exitCode: 0, output: execSync(command, { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    return { command, exitCode: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const main = ([planPath, contractPath, , configPath = '.claude/ouroboros.json']) => {
  const contractJson = readFileSync(contractPath, 'utf8')
  const contract = parseContract(contractJson)
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const files = Object.fromEntries(contract.done_when.flatMap(check => check.files).map(file => [file, readFileSync(file, 'utf8')]))
  const report = checkReport({ planText: readFileSync(planPath, 'utf8'), contractJson, config, runs: contract.done_when.map(check => runCheck(check.command)), files, invariantRuns: contract.must_not.invariants.map(invariant => runCheck(invariant.command)) })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(report.ok ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
```

- [ ] **Step 4: Run the tests and see them pass; run the CLI once by hand**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.
Run: `node --experimental-strip-types --no-warnings scripts/contract_check.mjs /dev/null /dev/null; echo $?`
Expected: a JSON parse error and a non-zero exit (no crash trace hiding it).

- [ ] **Step 5: Commit**

```bash
git add scripts/contract_check.mjs scripts/contract_check.test.ts
git commit -m "feat(scripts): contract_check gives agents the gate's contract checks early"
```

### Task 9: `workflows/section.js`

**Files:**
- Create: `workflows/section.js` (from `workflows/phase.js`)
- Modify: `scripts/check_workflow_mirrors.mjs` (check `section.js` as it checks `phase.js`)
- Test: `<scratchpad>/harness2.mjs` scenario `section.mjs` (simulation, not committed)

**Interfaces:**
- Consumes (args): `{ section: string, slug: string, plan: string, contract_path: string, branch: string, worktree: string, plugin_root: string, test_db?, effort?, models?, implementer_slots?, tasks_per_implementer?, amendment?: { escalation: string, change: string }, from?: 'contract' | 'validate' | 'implement' }`
- Produces (result):
  - `{ status: 'ready', section, slug, branch, worktree, red_sha, tasks, follow_ups, findings }` when implementing and review finished;
  - `{ status: 'escalate', section, slug, stage: 'validate' | 'implement' | 'review', escalation: { problem: string, evidence: string, proposals: { change: string, cost: string, risk: string }[], recommended: number }, findings }` when a check is weak or an agent wants the contract relaxed;
  - `{ status: 'failed', section, slug, failing_stage, evidence }` otherwise.

- [ ] **Step 1: Copy and rename**

```bash
cp workflows/phase.js workflows/section.js
```

Set `meta`:

```js
export const meta = {
  name: 'section',
  description: 'One plan section: fresh branch, brief and contract with checks committed red, contract validation and a cheat attempt, implement, review; the conductor then runs the gate and opens the PR',
  phases: [{ title: 'Branch' }, { title: 'Contract' }, { title: 'Validate' }, { title: 'Implement' }, { title: 'Sync' }, { title: 'Review' }],
}
```

Replace every `args.phase` in log lines and labels with `args.slug`; delete the `Checkpoint` and `Pull request` stages and the functions only they use (`checkpoint`, `repairedCheckpoint`, `openPullRequest`, `acceptanceTable`, `followUpChecklist`, `manualChecklist`, `blockedChecklist`, `checkpointVerdict` and `checkpointRepairs` calls). In `COMMIT_RULE`, replace the `phase(` rule with: ``'\nNever start a commit subject with `section(` or `checks(` or `contract(`: only the conductor and the contract stage use them.'``.

- [ ] **Step 2: Add the no-relaxing rule to every implementer, fixer and reviewer prompt**

```js
const CONTRACT_RULE = (contractPath) =>
  `\nThe section's contract is ${contractPath}; its done_when checks and the contract itself are frozen. Never edit, delete, skip, filter or narrow a check, and never edit the contract. ` +
  'When a check or the contract looks wrong, stop and return status "escalate" with: the problem, the evidence (command and output), and 1 to 5 proposals (aim for at least 2), each with its cost and risk, and the one you recommend.'
```

Append `CONTRACT_RULE(args.contract_path)` wherever `COMMIT_RULE` is appended, and add to `CHAIN_SCHEMA`'s item properties `escalation: ESCALATION_SCHEMA` (defined in Step 3), so a chain can return one.

- [ ] **Step 3: The contract stage (replaces the brief refresh)**

```js
const ESCALATION_SCHEMA = {
  type: 'object',
  properties: {
    problem: { type: 'string' },
    evidence: { type: 'string' },
    proposals: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', properties: { change: { type: 'string' }, cost: { type: 'string' }, risk: { type: 'string' } }, required: ['change', 'cost', 'risk'] } },
    recommended: { type: 'number' },
  },
  required: ['problem', 'evidence', 'proposals', 'recommended'],
}

const CONTRACT_SCHEMA = {
  type: 'object',
  properties: { red_sha: { type: 'string' }, contract_path: { type: 'string' }, tasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, touches: { type: 'array', items: { type: 'string' } }, lane: { type: 'string' } }, required: ['id', 'title', 'touches'] } }, escalation: ESCALATION_SCHEMA },
  required: ['tasks'],
}

const contractPrompt = () =>
  `Section "${args.section}" of ${args.plan}. Architect: read the section and write the brief (where code goes, what to reuse, what is forbidden) and the contract's criteria and must_not into ${args.contract_path}, per the schema in the plugin's spec. ` +
  'Auditor: then write the done_when checks against those criteria (acceptance-level, real boundaries, no mocks of the unit under test), run each and see it fail on an assertion, ' +
  `run \`node --experimental-strip-types --no-warnings ${args.plugin_root}/scripts/contract_check.mjs ${args.plan} ${args.contract_path}\` until it exits 0, ` +
  `then commit the checks and the contract alone with subject \`checks(${args.slug}): <criteria>\`. Return the commit sha as red_sha and the section's tasks with the files each touches. ` +
  'If contract_check cannot pass without weakening a check, return escalation instead of a commit.'

phase('Contract')
const contracted = args.from === 'validate' || args.from === 'implement' ? { tasks: args.tasks, red_sha: args.red_sha } : await located(contractPrompt(), { label: `contract ${args.slug}`, phase: 'Contract', schema: CONTRACT_SCHEMA, agentType: 'ouroboros:auditor', model: roleModel('auditor') })
if (!contracted) return { status: 'failed', section: args.section, slug: args.slug, failing_stage: 'contract', evidence: 'no contract' }
if (contracted.escalation) return { status: 'escalate', section: args.section, slug: args.slug, stage: 'validate', escalation: contracted.escalation, findings: [] }
```

(When `args.amendment` is set, prefix `contractPrompt()` with: ```The user answered an escalation: ${args.amendment.change}. Apply exactly that change to the contract and checks, record it in amendments with by "user", commit with subject contract(${args.slug}): <change>, then continue.\n` ``.)

- [ ] **Step 4: The validate stage (cheat attempt and coverage)**

```js
const CHEAT_SCHEMA = {
  type: 'object',
  properties: {
    cheats: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, diff: { type: 'string' }, turned_green: { type: 'array', items: { type: 'string' } } }, required: ['criterion', 'diff', 'turned_green'] } },
    coverage: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, catches_partial: { type: 'boolean' }, why: { type: 'string' } }, required: ['criterion', 'catches_partial', 'why'] } },
    escalation: ESCALATION_SCHEMA,
  },
  required: ['cheats', 'coverage'],
}

const cheatPrompt = () =>
  `You did not write these checks. Contract: ${args.contract_path} at commit ${contracted.red_sha}. In a throwaway git worktree from that commit, for each criterion try to make its done_when checks pass WITHOUT meeting the criterion: hard-code the expected values, stub the boundary, special-case the fixture. ` +
  'Run the checks after each attempt and report every attempt with the checks it turned green. Then say, per criterion, whether its checks would catch the criterion being only partly met, and why. ' +
  'Remove the throwaway worktree before you return. If any check turned green on a cheat or a criterion would not catch a partial result, return escalation with that evidence and 1 to 5 proposals (aim for at least 2) to strengthen the checks, recommended one marked.'

phase('Validate')
if (args.from !== 'implement') {
  const probed = await located(cheatPrompt(), { label: `cheat ${args.slug}`, phase: 'Validate', schema: CHEAT_SCHEMA, agentType: 'ouroboros:reviewer', model: roleModel('reviewer') })
  if (!probed) return { status: 'failed', section: args.section, slug: args.slug, failing_stage: 'validate', evidence: 'cheat attempt returned nothing' }
  const weak = probed.cheats.some(cheat => cheat.turned_green.length > 0) || probed.coverage.some(entry => !entry.catches_partial)
  if (weak) return { status: 'escalate', section: args.section, slug: args.slug, stage: 'validate', escalation: probed.escalation ?? weakEscalation(probed), findings: [] }
}
```

with

```js
const weakEscalation = probed => ({
  problem: 'checks can be satisfied without meeting their criteria',
  evidence: JSON.stringify({ cheats: probed.cheats.filter(cheat => cheat.turned_green.length), coverage: probed.coverage.filter(entry => !entry.catches_partial) }, null, 2),
  proposals: [{ change: 'have the auditor strengthen the named checks against the cheat diffs shown', cost: 'one contract round', risk: 'none beyond time' }],
  recommended: 0,
})
```

- [ ] **Step 5: Implement, sync and review stay as in phase.js; return `ready` or `escalate`**

At the end of the script, after the review outcome:

```js
const escalated = [...landedEntries, ...implemented].find(entry => entry && entry.escalation)
if (escalated) return { status: 'escalate', section: args.section, slug: args.slug, stage: 'implement', escalation: escalated.escalation, findings: summary.findings }
if (outcome.blocking.length) return { status: 'failed', section: args.section, slug: args.slug, failing_stage: 'review', evidence: outcome.blocking.map(finding => finding.summary).join('\n') }
return { status: 'ready', section: args.section, slug: args.slug, branch: args.branch, worktree: args.worktree, red_sha: contracted.red_sha, tasks: summary.tasks, follow_ups: summary.follow_ups, findings: summary.findings }
```

- [ ] **Step 6: Mirror check and simulation**

Add `'workflows/section.js'` to the list of scripts in `scripts/check_workflow_mirrors.mjs` next to `'workflows/phase.js'`. Run:

```bash
node --experimental-strip-types --no-warnings scripts/check_workflow_mirrors.mjs
node <scratchpad>/harness2.mjs workflows/section.js <scratchpad>/section.mjs
```

The scenario mocks: contract agent returns `{ red_sha: 'r1', tasks: [{ id: '1', title: 't', touches: ['lib/a.rb'] }] }`; cheat agent returns `{ cheats: [], coverage: [{ criterion: 'c1', catches_partial: true, why: 'w' }] }`; implementer and reviewers as in `chain.mjs`. Expected result `status: 'ready'`, `red_sha: 'r1'`. A second run where the cheat agent reports `turned_green: ['rspec x']` must return `status: 'escalate', stage: 'validate'` with at least one proposal.

- [ ] **Step 7: Commit**

```bash
git add workflows/section.js scripts/check_workflow_mirrors.mjs
git commit -m "feat(workflows): section runs contract, validation, implement and review in one workflow"
```

## Section D: Conductor

### Task 10: Section state and `/ouroboros start` setting the goal

**Files:**
- Create: `hooks/conductor/section_state.ts`
- Test: `hooks/conductor/section_state.test.ts`, `hooks/conductor/section_hooks.test.ts`
- Modify: `hooks/register.ts` (command `start`, goal setting)

**Interfaces:**
- Consumes: `nextOpenSection`, `Section` (Task 2), `contractPathOf` (Task 3)
- Produces:
  - `type SectionRun = { heading: string; slug: string; plan: string; branch: string; worktree: string; contract_path: string; status: 'running' | 'gating' | 'awaiting_merge' | 'escalated' | 'failed' | 'done'; red_sha?: string; pr_url?: string; escalation?: Escalation; launches: number }`
  - `type SectionLoop = { plan?: string; current?: SectionRun; done: string[]; paused?: boolean }` stored in `.claude/ouroboros/sections.json`
  - `startSection(loop: SectionLoop, planPath: string, planText: string, prefix: string, worktreeRoot: string, draftsDir: string): { loop: SectionLoop } | { error: string }`
  - `goalCondition(run: SectionRun): string`
  - `sectionLaunch(run: SectionRun, pluginRoot: string, extra: object): Launch`

- [ ] **Step 1: Write the failing pure tests**

```ts
import { expect, test } from 'claude-code/testing'

import { goalCondition, sectionLaunch, startSection } from './section_state'

const PLAN = '## Skip open units\n- [ ] **Step 1: test**\n## Next\n- [ ] a\n'

test('start picks the first open section and names its branch, worktree and contract', () => {
  const started = startSection({ done: [] }, 'docs/drafts/plan.md', PLAN, 'work/', '/repo/.worktrees', 'docs/drafts')
  expect('loop' in started && started.loop.current).toEqual({
    heading: 'Skip open units', slug: 'skip-open-units', plan: 'docs/drafts/plan.md',
    branch: 'work/skip-open-units', worktree: '/repo/.worktrees/skip-open-units',
    contract_path: 'docs/drafts/contracts/skip-open-units.json', status: 'running', launches: 0,
  })
})

test('start refuses while a section is running, and when no section is open', () => {
  const running = startSection({ done: [] }, 'p.md', PLAN, 'work/', '/w', 'd')
  if (!('loop' in running)) throw new Error('expected a loop')
  expect(startSection(running.loop, 'p.md', PLAN, 'work/', '/w', 'd')).toEqual({ error: 'section "Skip open units" is running; /ouroboros status shows where it is' })
  expect(startSection({ done: [] }, 'p.md', '## Done\n- [x] a\n', 'work/', '/w', 'd')).toEqual({ error: 'no open section in p.md' })
})

test('the goal condition names the gate line only the hook writes, and bounds the launches', () => {
  const started = startSection({ done: [] }, 'p.md', PLAN, 'work/', '/w', 'd')
  if (!('loop' in started) || !started.loop.current) throw new Error('expected a run')
  expect(goalCondition(started.loop.current)).toBe('the conductor printed "GATE PASS section \\"Skip open units\\"" or "GATE FAIL section \\"Skip open units\\"", or an escalation for section "Skip open units" is open; stop after 3 workflow launches')
})

test('the launch passes the section, its contract and the plugin root to ouroboros:section', () => {
  const started = startSection({ done: [] }, 'p.md', PLAN, 'work/', '/w', 'd')
  if (!('loop' in started) || !started.loop.current) throw new Error('expected a run')
  expect(sectionLaunch(started.loop.current, '/plugins/ouroboros', { effort: { implement: 'medium' } })).toEqual({
    workflow: 'ouroboros:section',
    args: { section: 'Skip open units', slug: 'skip-open-units', plan: 'p.md', contract_path: 'd/contracts/skip-open-units.json', branch: 'work/skip-open-units', worktree: '/w/skip-open-units', plugin_root: '/plugins/ouroboros', fresh_branch: 'work/skip-open-units', effort: { implement: 'medium' } },
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./section_state` not found.

- [ ] **Step 3: Implement `hooks/conductor/section_state.ts`**

```ts
import { contractPathOf } from '../gate/contract'
import { nextOpenSection } from '../gate/sections'
import type { Launch } from './state'

export type SectionEscalation = { stage: string; problem: string; evidence: string; proposals: { change: string; cost: string; risk: string }[]; recommended: number }
export type SectionStatus = 'running' | 'gating' | 'awaiting_merge' | 'escalated' | 'failed' | 'done'
export type SectionRun = { heading: string; slug: string; plan: string; branch: string; worktree: string; contract_path: string; status: SectionStatus; red_sha?: string; pr_url?: string; escalation?: SectionEscalation; launches: number }
export type SectionLoop = { plan?: string; current?: SectionRun; done: string[]; paused?: boolean }

export const SECTIONS_PATH = '.claude/ouroboros/sections.json'
export const MAX_LAUNCHES = 3
const IDLE: SectionLoop = { done: [] }

export const parseSectionLoop = (json: string | undefined): SectionLoop => (json === undefined || json.trim() === '' ? IDLE : { ...IDLE, ...JSON.parse(json) })

const isActive = (run: SectionRun | undefined) => run !== undefined && run.status !== 'done'

export const startSection = (loop: SectionLoop, planPath: string, planText: string, prefix: string, worktreeRoot: string, draftsDir: string) => {
  if (isActive(loop.current)) return { error: `section "${loop.current?.heading}" is running; /ouroboros status shows where it is` }
  const section = nextOpenSection(planText)
  if (section === undefined) return { error: `no open section in ${planPath}` }
  const current: SectionRun = {
    heading: section.heading, slug: section.slug, plan: planPath,
    branch: `${prefix}${section.slug}`, worktree: `${worktreeRoot}/${section.slug}`,
    contract_path: contractPathOf(draftsDir, section.slug), status: 'running', launches: 0,
  }
  return { loop: { ...loop, plan: planPath, current, paused: false } }
}

const quoted = (heading: string) => `section \\"${heading}\\"`

export const goalCondition = (run: SectionRun) =>
  `the conductor printed "GATE PASS ${quoted(run.heading)}" or "GATE FAIL ${quoted(run.heading)}", or an escalation for section "${run.heading}" is open; stop after ${MAX_LAUNCHES} workflow launches`

export const sectionLaunch = (run: SectionRun, pluginRoot: string, extra: object): Launch => ({
  workflow: 'ouroboros:section',
  args: { section: run.heading, slug: run.slug, plan: run.plan, contract_path: run.contract_path, branch: run.branch, worktree: run.worktree, plugin_root: pluginRoot, fresh_branch: run.branch, ...extra },
})
```

- [ ] **Step 4: Run the pure tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 5: Write the failing hook test for `/ouroboros start`**

In `hooks/conductor/section_hooks.test.ts`, reuse the `worldBeneath` helper pattern from `conductor_hooks.test.ts` (copy it; it is test-local there), plus a `command.run` capture for `goal`:

```ts
test('/ouroboros start sets a goal for the first open section and queues its launch', async $ => {
  const goals: string[] = []
  const disk = worldBeneath($.on, { '.claude/ouroboros.json': CONFIG, 'docs/drafts/plan.md': '## Skip open units\n- [ ] **Step 1: test**\n' })
  $.on('command.run', { command: 'goal' }, (_, e) => {
    goals.push(e.args)
    return { text: `Goal set: ${e.args}` }
  })
  const { text } = await run($, 'start docs/drafts/plan.md')
  await $.clock.advance(0)
  expect(text).toContain('section "Skip open units" started')
  expect(goals[0]).toContain('GATE PASS section \\"Skip open units\\"')
  expect(JSON.parse(disk.get('.claude/ouroboros/sections.json') ?? '{}').current.status).toBe('running')
})
```

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, `start` is an unknown subcommand.

- [ ] **Step 6: Implement in `hooks/register.ts`**

Add near the other state helpers:

```ts
const readSectionLoop = async ($: EngineInterface) => parseSectionLoop(await readIfExists($, SECTIONS_PATH))
const writeSectionLoop = ($: EngineInterface, loop: SectionLoop) => $.fs.write(SECTIONS_PATH, JSON.stringify(loop, null, 2))

const setGoalWhenIdle = ($: EngineInterface, condition: string) =>
  $.clock.after(0, () => {
    $.command.run({ command: 'goal', args: condition }).catch(error => $.ui.toast(loudly(error)))
  })

const startCommand = async ($: EngineInterface, args: string) => {
  const config = await readConfig($)
  const planPath = args.trim() || (await newestPlan($))
  if (planPath === undefined) return `no plan given and none with boxes under ${config.drafts_dir}`
  const root = checkoutRootOf((await $.process.run(GIT_COMMON_DIR)).stdout)
  const started = startSection(await readSectionLoop($), planPath, await $.fs.read(planPath), config.branch_prefix ?? 'work/', `${root}/.worktrees`, config.drafts_dir ?? 'docs/drafts')
  if ('error' in started) return started.error
  const run = started.loop.current as SectionRun
  await writeSectionLoop($, { ...started.loop, current: { ...run, launches: 1 } })
  await writeState($, { ...(await readLoopState($)), pending: sectionLaunch(run, $.plugin.root, configArgs(config)) })
  setGoalWhenIdle($, `${goalCondition(run)}. First launch: ${workflowCall(sectionLaunch(run, $.plugin.root, configArgs(config)))}`)
  return `section "${run.heading}" started on ${run.branch}; goal set`
}
```

`readIfExists`, `readConfig`, `newestPlan` (the existing `draftFiles` newest-first lookup used by kickoff discovery), `writeState`, `readLoopState`, `workflowCall`, `configArgs` (the existing `withConfigArgs` body, extracted to return the effort/models/merge_policy object) already exist or are extracted from existing code in this step; route `start` in `runConductorCommand`'s switch and add it to `OUROBOROS_COMMAND.description`.

- [ ] **Step 7: Run all tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 8: Commit**

```bash
git add hooks/conductor/section_state.ts hooks/conductor/section_state.test.ts hooks/conductor/section_hooks.test.ts hooks/register.ts
git commit -m "feat(conductor): /ouroboros start runs the next plan section under a goal"
```

### Task 11: The hook runs the gate and opens the PR

**Files:**
- Create: `hooks/conductor/gate_run.ts` (pure: which commands to run, how to assemble `GateFacts`)
- Test: `hooks/conductor/gate_run.test.ts`, add cases to `hooks/conductor/section_hooks.test.ts`
- Modify: `hooks/register.ts` (on a `ouroboros:section` result: gate, block, PR)

**Interfaces:**
- Consumes: `Contract`, `withProjectDefaults` (Task 3), `redVerdict` (Task 4), `scopeBreaks`, `addedLines`, `noNewHits` (Task 6), `GateFacts`, `gateBlock`, `gateFailures`, `pullRequestBody` (Task 7), `SectionRun` (Task 10), `owns` (lanes)
- Produces:
  - `gateCommands(contract: Contract, lanes: Record<string, LaneSettings>, changed: string[]): { done: GateCommand[]; invariants: GateCommand[]; lanes: GateCommand[] }` with `type GateCommand = { label: string; command: string }`
  - `exemptFiles(run: SectionRun, contract: Contract): string[]` (the plan, the contract, every check file)
  - `changedChecksWithoutAmendment(changedSinceRed: string[], contract: Contract, amendmentCommits: number): string[]`
  - `factsOf(input: FactsInput): GateFacts`

- [ ] **Step 1: Write the failing pure tests**

```ts
import { expect, test } from 'claude-code/testing'

import { changedChecksWithoutAmendment, exemptFiles, gateCommands } from './gate_run'

const CONTRACT = {
  section: 'S', criteria: [{ id: 'c1', text: 't', boxes: [] }],
  done_when: [{ criterion: 'c1', command: 'rspec spec/acceptance/s_spec.rb', files: ['spec/acceptance/s_spec.rb'], proves: 'p' }],
  must_not: { may_change: ['lib/**'], protected: [], invariants: [{ command: 'rspec spec/acceptance', proves: 'p' }], no_new: [] },
  amendments: [],
}
const LANES = { ruby: { owned_paths: ['lib/**', 'spec/**'], test: 'bundle exec rspec', lint: 'bundle exec rubocop' }, python: { owned_paths: ['services/**'], test: 'pytest' } }

test('the gate runs every check, every invariant, and test and lint of each lane the diff touched', () => {
  expect(gateCommands(CONTRACT, LANES, ['lib/a.rb'])).toEqual({
    done: [{ label: 'c1', command: 'rspec spec/acceptance/s_spec.rb' }],
    invariants: [{ label: 'invariant', command: 'rspec spec/acceptance' }],
    lanes: [{ label: 'ruby test', command: 'bundle exec rspec' }, { label: 'ruby lint', command: 'bundle exec rubocop' }],
  })
})

test('the plan, the contract and the check files are exempt from the scope fence', () => {
  const run = { heading: 'S', slug: 's', plan: 'docs/drafts/plan.md', branch: 'work/s', worktree: '/w/s', contract_path: 'docs/drafts/contracts/s.json', status: 'gating' as const, launches: 1 }
  expect(exemptFiles(run, CONTRACT)).toEqual(['docs/drafts/plan.md', 'docs/drafts/contracts/s.json', 'spec/acceptance/s_spec.rb'])
})

test('a check changed since the red commit counts unless a user amendment commit accounts for it', () => {
  expect(changedChecksWithoutAmendment(['spec/acceptance/s_spec.rb', 'lib/a.rb'], CONTRACT, 0)).toEqual(['spec/acceptance/s_spec.rb'])
  expect(changedChecksWithoutAmendment(['spec/acceptance/s_spec.rb'], { ...CONTRACT, amendments: [{ at: 't', by: 'user', escalation: 'e', change: 'c' }] }, 1)).toEqual([])
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./gate_run` not found.

- [ ] **Step 3: Implement `hooks/conductor/gate_run.ts`**

```ts
import type { LaneSettings } from '../eager_skills/config'
import type { Contract } from '../gate/contract'
import type { RedVerdict } from '../gate/red'
import type { CommandResult, GateFacts } from '../gate/verdict'
import { owns } from './lanes'
import type { SectionRun } from './section_state'

export type GateCommand = { label: string; command: string }

const touchedLanes = (lanes: Record<string, LaneSettings>, changed: string[]) =>
  Object.entries(lanes).filter(([, lane]) => changed.some(file => owns(lane.owned_paths ?? [], file)))

const laneCommands = ([name, lane]: [string, LaneSettings]): GateCommand[] => [
  ...(lane.test ? [{ label: `${name} test`, command: lane.test }] : []),
  ...(lane.lint ? [{ label: `${name} lint`, command: lane.lint }] : []),
]

export const gateCommands = (contract: Contract, lanes: Record<string, LaneSettings>, changed: string[]) => ({
  done: contract.done_when.map(check => ({ label: check.criterion, command: check.command })),
  invariants: contract.must_not.invariants.map(invariant => ({ label: 'invariant', command: invariant.command })),
  lanes: touchedLanes(lanes, changed).flatMap(laneCommands),
})

export const exemptFiles = (run: SectionRun, contract: Contract) => [run.plan, run.contract_path, ...contract.done_when.flatMap(check => check.files)]

export const changedChecksWithoutAmendment = (changedSinceRed: string[], contract: Contract, amendmentCommits: number) => {
  const checkFiles = new Set(contract.done_when.flatMap(check => check.files))
  const changed = changedSinceRed.filter(file => checkFiles.has(file))
  return amendmentCommits > 0 && contract.amendments.length >= amendmentCommits ? [] : changed
}

export type FactsInput = {
  run: SectionRun
  sha: string
  redSha: string
  results: { done: CommandResult[]; invariants: CommandResult[]; lanes: CommandResult[] }
  scope: string[]
  changedCount: number
  noNew: string[]
  changedChecks: string[]
  amendments: number
  boxes: { ticked: number; total: number }
  redAtRedSha: { command: string; verdict: RedVerdict }[]
}

export const factsOf = (input: FactsInput): GateFacts => ({
  heading: input.run.heading, sha: input.sha, redSha: input.redSha,
  done: input.results.done, invariants: input.results.invariants, lanes: input.results.lanes,
  scope: input.scope, changedCount: input.changedCount, noNew: input.noNew,
  changedChecks: input.changedChecks, amendments: input.amendments, boxes: input.boxes, redAtRedSha: input.redAtRedSha,
})
```

- [ ] **Step 4: Run the pure tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 5: Write the failing hook tests**

In `section_hooks.test.ts`, with `process.run` answering by argv (git rev-parse HEAD → `abc1234`, `git log --grep=^checks(skip-open-units)` → `def5678`, `git diff --name-only` → `lib/a.rb`, `git diff -U0` → a diff with no forbidden lines, every gate command → exit 0 with `1 example, 0 failures`, the red-sha run → exit 1 with an rspec assertion failure, `gh pr create` → a PR URL):

```ts
test('a ready section result runs the gate in the hook, prints GATE PASS and opens a ready PR', async $ => {
  const sent: string[] = []
  const commands: string[][] = []
  const disk = sectionWorld($.on, { status: 'running' }, sent, commands)
  await $.session.receive({ text: readyNotification('skip-open-units'), origin: NOTIFICATION })
  await $.clock.advance(0)
  expect(sent.join('\n')).toContain('GATE PASS section "Skip open units" at abc1234')
  expect(commands.find(argv => argv[0] === 'gh' && argv[2] === 'create')).toContain('--title')
  expect(commands.find(argv => argv[0] === 'gh' && argv[2] === 'create')).not.toContain('--draft')
  expect(JSON.parse(disk.get('.claude/ouroboros/sections.json') ?? '{}').current.status).toBe('awaiting_merge')
})

test('a failing gate prints GATE FAIL, opens a draft PR listing the failures, and stops', async $ => {
  const sent: string[] = []
  const commands: string[][] = []
  const disk = sectionWorld($.on, { status: 'running', failCommand: 'bundle exec rspec' }, sent, commands)
  await $.session.receive({ text: readyNotification('skip-open-units'), origin: NOTIFICATION })
  await $.clock.advance(0)
  expect(sent.join('\n')).toContain('GATE FAIL section "Skip open units"')
  expect(commands.find(argv => argv[0] === 'gh' && argv[2] === 'create')).toContain('--draft')
  expect(JSON.parse(disk.get('.claude/ouroboros/sections.json') ?? '{}').current.status).toBe('failed')
})
```

(`sectionWorld` and `readyNotification` are test helpers in the same file: the first wires `fs.*`, `process.run` and `prompt.submit` capture as `worldBeneath` does, with the argv-keyed answers above; the second builds a task-notification text whose result JSON is the `ready` result of Task 9.)

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL.

- [ ] **Step 6: Implement in `hooks/register.ts`**

```ts
const GATE_TIMEOUT_MS = 600_000
const TAIL_LINES = 15

const tailOf = (text: string) => text.trim().split('\n').slice(-TAIL_LINES).join('\n')

const runGateCommand = async ($: EngineInterface, cwd: string, entry: GateCommand): Promise<CommandResult> => {
  const { exitCode, stdout, stderr } = await $.process.run(['sh', '-c', entry.command], { cwd, timeoutMs: GATE_TIMEOUT_MS }).catch(error => ({ exitCode: 124, stdout: '', stderr: String(error) }))
  return { label: entry.label, command: entry.command, exitCode, tail: tailOf(`${stdout}\n${stderr}`) }
}

const runAll = ($: EngineInterface, cwd: string, entries: GateCommand[]) => Promise.all(entries.map(entry => runGateCommand($, cwd, entry)))

const gitOut = async ($: EngineInterface, cwd: string, argv: string[]) => (await $.process.run(['git', ...argv], { cwd })).stdout.trim()

const redAtRedSha = async ($: EngineInterface, run: SectionRun, contract: Contract, redSha: string, patterns: OuroborosConfig['red_patterns']) => {
  const scratch = `${run.worktree}.red`
  await $.process.run(['git', 'worktree', 'add', '--detach', scratch, redSha], { cwd: run.worktree })
  const results = await runAll($, scratch, contract.done_when.map(check => ({ label: check.criterion, command: check.command })))
  await $.process.run(['git', 'worktree', 'remove', '--force', scratch], { cwd: run.worktree })
  return results.map(result => ({ command: result.command, verdict: redVerdict(result.tail, result.exitCode, patterns ?? {}).verdict }))
}

const gateFactsFor = async ($: EngineInterface, run: SectionRun, config: OuroborosConfig) => {
  const cwd = run.worktree
  const contract = withProjectDefaults(parseContract(await $.fs.read(`${cwd}/${run.contract_path}`)), config)
  const base = await gitOut($, cwd, ['merge-base', 'HEAD', 'origin/HEAD'])
  const changed = (await gitOut($, cwd, ['diff', '--name-only', `${base}..HEAD`])).split('\n').filter(Boolean)
  const redSha = await gitOut($, cwd, ['log', '-1', `--grep=^checks(${run.slug})`, '--format=%h'])
  const sinceRed = (await gitOut($, cwd, ['diff', '--name-only', `${redSha}..HEAD`])).split('\n').filter(Boolean)
  const amendmentCommits = Number(await gitOut($, cwd, ['rev-list', '--count', `--grep=^contract(${run.slug})`, `${redSha}..HEAD`]))
  const commands = gateCommands(contract, config.lanes ?? {}, changed)
  const section = sectionsOf(await $.fs.read(`${cwd}/${run.plan}`)).find(candidate => candidate.heading === run.heading)
  return {
    contract,
    facts: factsOf({
      run, sha: await gitOut($, cwd, ['rev-parse', '--short', 'HEAD']), redSha,
      results: { done: await runAll($, cwd, commands.done), invariants: await runAll($, cwd, commands.invariants), lanes: await runAll($, cwd, commands.lanes) },
      scope: scopeBreaks(changed, contract, exemptFiles(run, contract)), changedCount: changed.length,
      noNew: noNewHits(addedLines(await gitOut($, cwd, ['diff', '-U0', `${base}..HEAD`])), contract.must_not.no_new),
      changedChecks: changedChecksWithoutAmendment(sinceRed, contract, amendmentCommits), amendments: contract.amendments.length,
      boxes: { ticked: (section?.boxes ?? []).filter(box => box.ticked).length, total: (section?.boxes ?? []).length },
      redAtRedSha: await redAtRedSha($, run, contract, redSha, config.red_patterns),
    }),
  }
}

const openSectionPullRequest = async ($: EngineInterface, run: SectionRun, body: string, draft: boolean) => {
  await $.process.run(['git', 'push', '-u', 'origin', run.branch], { cwd: run.worktree })
  const argv = ['gh', 'pr', 'create', '--title', run.heading, '--body', body, '--head', run.branch, ...(draft ? ['--draft'] : [])]
  return (await $.process.run(argv, { cwd: run.worktree })).stdout.trim()
}

const gateSection = async ($: EngineInterface, loop: SectionLoop, result: { red_sha?: string }) => {
  const run = { ...(loop.current as SectionRun), status: 'gating' as const, ...(result.red_sha ? { red_sha: result.red_sha } : {}) }
  await writeSectionLoop($, { ...loop, current: run })
  const { contract, facts } = await gateFactsFor($, run, await readConfig($))
  const passed = gateFailures(facts).length === 0
  const prUrl = await openSectionPullRequest($, run, pullRequestBody(facts, contract), !passed)
  await writeSectionLoop($, { ...loop, current: { ...run, status: passed ? 'awaiting_merge' : 'failed', pr_url: prUrl } })
  submitWhenIdle($, `${gateBlock(facts)}\n${passed ? `PR ready for your merge: ${prUrl}` : `Stopped. Draft PR with the failures: ${prUrl}`}`)
}
```

Wire it in the existing notification path (`conductNotification`): when the finished run's workflow is `ouroboros:section` and its result `status` is `ready`, call `gateSection`; when `escalate`, hand to Task 12's `recordEscalation`; when `failed`, mark the run `failed` and submit the evidence. Commands that can exceed ten minutes are covered by `GATE_TIMEOUT_MS` (the engine maximum); a command killed by the timeout reads exit 124 and fails the gate with its reason in the tail, which is the intended stop.

- [ ] **Step 7: Run all tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 8: Commit**

```bash
git add hooks/conductor/gate_run.ts hooks/conductor/gate_run.test.ts hooks/conductor/section_hooks.test.ts hooks/register.ts
git commit -m "feat(conductor): the hook runs the section gate itself and opens the PR from its evidence"
```

### Task 12: Escalations and `/ouroboros answer`

**Files:**
- Create: `hooks/conductor/escalation.ts`
- Test: `hooks/conductor/escalation.test.ts`, cases in `section_hooks.test.ts`
- Modify: `hooks/register.ts`

**Interfaces:**
- Consumes: `SectionRun`, `SectionEscalation`, `SectionLoop`, `sectionLaunch` (Task 10)
- Produces: `escalationMessage(run: SectionRun): string`, `answerOf(run: SectionRun, answer: string, at: string): { amendment: { escalation: string; change: string; at: string }; from: 'validate' | 'implement' } | { error: string }`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'

import { answerOf, escalationMessage } from './escalation'

const RUN = {
  heading: 'Skip open units', slug: 'skip-open-units', plan: 'p.md', branch: 'work/s', worktree: '/w/s', contract_path: 'c.json', status: 'escalated' as const, launches: 1,
  escalation: {
    stage: 'validate', problem: 'skip_spec passes with a hard-coded empty list', evidence: 'diff: def queued = []',
    proposals: [{ change: 'assert the skipped unit id appears in the decision log', cost: 'one check', risk: 'none' }, { change: 'drive discovery through the real queue', cost: 'slower spec', risk: 'redis in test' }],
    recommended: 0,
  },
}

test('the escalation message states the problem, the evidence and numbered proposals, the recommended one marked', () => {
  expect(escalationMessage(RUN)).toBe([
    'Section "Skip open units" needs you (validate): skip_spec passes with a hard-coded empty list',
    'Evidence:',
    'diff: def queued = []',
    'Proposals:',
    '  1. assert the skipped unit id appears in the decision log (cost: one check; risk: none) [recommended]',
    '  2. drive discovery through the real queue (cost: slower spec; risk: redis in test)',
    'Answer with /ouroboros answer <number> or /ouroboros answer <your own change>.',
  ].join('\n'))
})

test('a numbered answer picks that proposal; free text is taken as the change', () => {
  expect(answerOf(RUN, '2', 't')).toEqual({ amendment: { escalation: 'skip_spec passes with a hard-coded empty list', change: 'drive discovery through the real queue', at: 't' }, from: 'validate' })
  expect(answerOf(RUN, 'drop criterion c2', 't')).toEqual({ amendment: { escalation: 'skip_spec passes with a hard-coded empty list', change: 'drop criterion c2', at: 't' }, from: 'validate' })
})

test('an out-of-range number or no open escalation is refused', () => {
  expect(answerOf(RUN, '7', 't')).toEqual({ error: 'pick 1 to 2, or write the change' })
  expect(answerOf({ ...RUN, escalation: undefined, status: 'running' }, '1', 't')).toEqual({ error: 'no open escalation' })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./escalation` not found.

- [ ] **Step 3: Implement `hooks/conductor/escalation.ts`**

```ts
import type { SectionRun } from './section_state'

const proposalLine = (proposal: { change: string; cost: string; risk: string }, index: number, recommended: number) =>
  `  ${index + 1}. ${proposal.change} (cost: ${proposal.cost}; risk: ${proposal.risk})${index === recommended ? ' [recommended]' : ''}`

export const escalationMessage = (run: SectionRun) => {
  const escalation = run.escalation
  if (escalation === undefined) return `Section "${run.heading}" has no open escalation.`
  return [
    `Section "${run.heading}" needs you (${escalation.stage}): ${escalation.problem}`,
    'Evidence:',
    escalation.evidence,
    'Proposals:',
    ...escalation.proposals.map((proposal, index) => proposalLine(proposal, index, escalation.recommended)),
    'Answer with /ouroboros answer <number> or /ouroboros answer <your own change>.',
  ].join('\n')
}

const resumeStage = (stage: string) => (stage === 'validate' ? 'validate' : 'implement') as 'validate' | 'implement'

export const answerOf = (run: SectionRun, answer: string, at: string) => {
  const escalation = run.escalation
  if (escalation === undefined) return { error: 'no open escalation' }
  const trimmed = answer.trim()
  const picked = /^\d+$/.test(trimmed) ? escalation.proposals[Number(trimmed) - 1] : undefined
  if (/^\d+$/.test(trimmed) && picked === undefined) return { error: `pick 1 to ${escalation.proposals.length}, or write the change` }
  return { amendment: { escalation: escalation.problem, change: picked?.change ?? trimmed, at }, from: resumeStage(escalation.stage) }
}
```

- [ ] **Step 4: Wire into `hooks/register.ts`**

```ts
const recordEscalation = async ($: EngineInterface, loop: SectionLoop, result: { stage: string; escalation: Omit<SectionEscalation, 'stage'> }) => {
  const run = { ...(loop.current as SectionRun), status: 'escalated' as const, escalation: { stage: result.stage, ...result.escalation } }
  await writeSectionLoop($, { ...loop, current: run })
  submitWhenIdle($, escalationMessage(run))
}

const answerCommand = async ($: EngineInterface, args: string) => {
  const loop = await readSectionLoop($)
  if (loop.current === undefined) return 'no section is running'
  const answered = answerOf(loop.current, args, new Date($.clock.now()).toISOString())
  if ('error' in answered) return answered.error
  const run = { ...loop.current, status: 'running' as const, escalation: undefined, launches: loop.current.launches + 1 }
  await writeSectionLoop($, { ...loop, current: run })
  const launch = sectionLaunch(run, $.plugin.root, { ...configArgs(await readConfig($)), amendment: answered.amendment, from: answered.from, red_sha: run.red_sha })
  submitWhenIdle($, `Amendment recorded: ${answered.amendment.change}\n${workflowCall(launch)}`)
  return `answered; section "${run.heading}" resumes from ${answered.from}`
}
```

Route `answer` in `runConductorCommand`; `escalations` prints `escalationMessage` for the current run. Add a hook test: an `escalate` result submits the message; `/ouroboros answer 1` submits a launch line containing `"amendment"` and `"from":"validate"` and sets the run back to `running`.

- [ ] **Step 5: Run all tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 6: Commit**

```bash
git add hooks/conductor/escalation.ts hooks/conductor/escalation.test.ts hooks/conductor/section_hooks.test.ts hooks/register.ts
git commit -m "feat(conductor): escalations reach the user with proposals, and /ouroboros answer amends the contract"
```

### Task 13: Auto-continue after the merge

**Files:**
- Modify: `hooks/register.ts` (`noticedMerge` path for sections)
- Test: cases in `hooks/conductor/section_hooks.test.ts`

**Interfaces:**
- Consumes: `SectionLoop`, `startSection`, `goalCondition`, `sectionLaunch` (Task 10)

- [ ] **Step 1: Write the failing hook tests**

```ts
test('a merged section PR marks it done and starts the next open section under a new goal', async $ => {
  const goals: string[] = []
  const disk = sectionWorld($.on, { status: 'awaiting_merge', prState: 'MERGED', plan: '## Skip open units\n- [x] a\n## Next one\n- [ ] b\n' }, [], [])
  $.on('command.run', { command: 'goal' }, (_, e) => { goals.push(e.args); return { text: 'Goal set' } })
  await $.prompt.context({ text: 'anything' })
  await $.clock.advance(0)
  const loop = JSON.parse(disk.get('.claude/ouroboros/sections.json') ?? '{}')
  expect(loop.done).toEqual(['skip-open-units'])
  expect(loop.current.heading).toBe('Next one')
  expect(goals[0]).toContain('Next one')
})

test('no open section left means the plan is done and no goal is set', async $ => {
  const goals: string[] = []
  const sent: string[] = []
  sectionWorld($.on, { status: 'awaiting_merge', prState: 'MERGED', plan: '## Skip open units\n- [x] a\n' }, sent, [])
  $.on('command.run', { command: 'goal' }, (_, e) => { goals.push(e.args); return { text: 'Goal set' } })
  await $.prompt.context({ text: 'anything' })
  await $.clock.advance(0)
  expect(goals).toEqual([])
  expect(sent.join('\n')).toContain('every section of p.md is done')
})

test('a paused loop does not continue', async $ => {
  const goals: string[] = []
  sectionWorld($.on, { status: 'awaiting_merge', prState: 'MERGED', paused: true, plan: '## A\n- [x] a\n## B\n- [ ] b\n' }, [], [])
  $.on('command.run', { command: 'goal' }, (_, e) => { goals.push(e.args); return { text: 'Goal set' } })
  await $.prompt.context({ text: 'anything' })
  await $.clock.advance(0)
  expect(goals).toEqual([])
})
```

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL.

- [ ] **Step 2: Implement**

In the existing throttled merge check (`noticedMerge`, every five minutes or on `/ouroboros resume`), add the section path:

```ts
const continueAfterMerge = async ($: EngineInterface, loop: SectionLoop) => {
  const finished = loop.current as SectionRun
  const settled: SectionLoop = { ...loop, current: { ...finished, status: 'done' }, done: [...loop.done, finished.slug] }
  await $.process.run(['git', 'fetch', 'origin'])
  const planText = (await $.process.run(['git', 'show', `origin/HEAD:${finished.plan}`])).stdout
  const config = await readConfig($)
  const root = checkoutRootOf((await $.process.run(GIT_COMMON_DIR)).stdout)
  const started = startSection(settled, finished.plan, planText, config.branch_prefix ?? 'work/', `${root}/.worktrees`, config.drafts_dir ?? 'docs/drafts')
  if ('error' in started) {
    await writeSectionLoop($, settled)
    submitWhenIdle($, `Section "${finished.heading}" merged; every section of ${finished.plan} is done.`)
    return
  }
  const next = { ...(started.loop.current as SectionRun), launches: 1 }
  await writeSectionLoop($, { ...started.loop, current: next })
  setGoalWhenIdle($, `${goalCondition(next)}. First launch: ${workflowCall(sectionLaunch(next, $.plugin.root, configArgs(config)))}`)
}

const noticedSectionMerge = async ($: EngineInterface) => {
  const loop = await readSectionLoop($)
  if (loop.paused || loop.current?.status !== 'awaiting_merge' || loop.current.pr_url === undefined) return
  const { stdout } = await $.process.run(['gh', 'pr', 'view', loop.current.pr_url, '--json', 'state', '--jq', '.state'])
  if (stdout.trim() === 'MERGED') await continueAfterMerge($, loop)
}
```

Call `noticedSectionMerge` from the same throttle point as the existing phase merge check. `/ouroboros pause` sets `paused: true` on the section loop too; `/ouroboros resume` clears it and runs `noticedSectionMerge` at once.

- [ ] **Step 3: Run all tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 4: Commit**

```bash
git add hooks/conductor/section_hooks.test.ts hooks/register.ts
git commit -m "feat(conductor): after a section PR is merged the next open section starts under a new goal"
```

### Task 14: Refuse edits to frozen checks (only if Task 1 found `tool.call` reaches workflow agents)

**Files:**
- Create: `hooks/conductor/frozen.ts`
- Test: `hooks/conductor/frozen.test.ts`, case in `section_hooks.test.ts`
- Modify: `hooks/register.ts` (`tool.call` Write, Edit, Bash)

**Interfaces:**
- Consumes: `Contract` (Task 3), `SectionRun` (Task 10)
- Produces: `frozenFiles(run: SectionRun, contract: Contract): string[]`, `touchesFrozen(frozen: string[], call: { tool: string; file_path?: string; command?: string }): string | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from 'claude-code/testing'

import { frozenFiles, touchesFrozen } from './frozen'

const FROZEN = ['docs/drafts/contracts/s.json', 'spec/acceptance/s_spec.rb']

test('the contract and every check file are frozen', () => {
  const run = { heading: 'S', slug: 's', plan: 'p.md', branch: 'b', worktree: '/w/s', contract_path: 'docs/drafts/contracts/s.json', status: 'running' as const, launches: 1 }
  const contract = { section: 'S', criteria: [], done_when: [{ criterion: 'c1', command: 'x', files: ['spec/acceptance/s_spec.rb'], proves: 'p' }], must_not: { may_change: [], protected: [], invariants: [], no_new: [] }, amendments: [] }
  expect(frozenFiles(run, contract)).toEqual(FROZEN)
})

test('a write or edit of a frozen file, or a shell command naming one with a writing verb, is caught', () => {
  expect(touchesFrozen(FROZEN, { tool: 'Edit', file_path: '/w/s/spec/acceptance/s_spec.rb' })).toBe('spec/acceptance/s_spec.rb')
  expect(touchesFrozen(FROZEN, { tool: 'Bash', command: "sed -i '' 's/eq(1)/be_truthy/' spec/acceptance/s_spec.rb" })).toBe('spec/acceptance/s_spec.rb')
  expect(touchesFrozen(FROZEN, { tool: 'Bash', command: 'git rm spec/acceptance/s_spec.rb' })).toBe('spec/acceptance/s_spec.rb')
})

test('reading or running a frozen check is allowed', () => {
  expect(touchesFrozen(FROZEN, { tool: 'Bash', command: 'bundle exec rspec spec/acceptance/s_spec.rb' })).toBeUndefined()
  expect(touchesFrozen(FROZEN, { tool: 'Write', file_path: '/w/s/lib/a.rb' })).toBeUndefined()
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`
Expected: FAIL, module `./frozen` not found.

- [ ] **Step 3: Implement `hooks/conductor/frozen.ts`**

```ts
import type { Contract } from '../gate/contract'
import type { SectionRun } from './section_state'

const WRITING_COMMAND = /\b(sed\s+-i|perl\s+-[a-z]*i|tee\b|git\s+(rm|mv|checkout\s+--)|rm\b|mv\b|cp\b|truncate\b)|>{1,2}/

export const frozenFiles = (run: SectionRun, contract: Contract) => [run.contract_path, ...contract.done_when.flatMap(check => check.files)]

export const touchesFrozen = (frozen: string[], call: { tool: string; file_path?: string; command?: string }) => {
  if ((call.tool === 'Write' || call.tool === 'Edit') && call.file_path !== undefined) return frozen.find(file => call.file_path?.endsWith(`/${file}`) || call.file_path === file)
  if (call.tool === 'Bash' && call.command !== undefined && WRITING_COMMAND.test(call.command)) return frozen.find(file => call.command?.includes(file))
  return undefined
}
```

- [ ] **Step 4: Wire the refusal into `hooks/register.ts`**

At the top of the existing `tool.call` handlers for `Write`, `Edit` and `Bash`:

```ts
const frozenRefusal = async ($: EngineInterface, call: { agentId?: string; tool: string; file_path?: string; command?: string }) => {
  if (call.agentId === undefined) return undefined
  const loop = await readSectionLoop($)
  if (loop.current?.status !== 'running') return undefined
  const contractText = await readIfExists($, `${loop.current.worktree}/${loop.current.contract_path}`)
  if (contractText === undefined) return undefined
  const file = touchesFrozen(frozenFiles(loop.current, parseContract(contractText)), call)
  return file === undefined ? undefined : { deny: `contract change needs the user: ${file} is frozen. Return status "escalate" with the problem, the evidence and 1 to 5 proposals.` }
}
```

Each handler starts with `const refused = await frozenRefusal($, { agentId: e.agentId, tool: '<Tool>', file_path: e.file_path, command: e.command }); if (refused) return refused`. The contract stage must still be able to write the checks, so `frozenRefusal` also returns `undefined` while `git log -1 --grep=^checks(<slug>) --format=%h` in the worktree prints nothing: files freeze only once the `checks(<slug>)` commit exists.

Add the hook test: with a section `running` and a `checks(s)` commit present, a workflow agent's `Edit` of `spec/acceptance/s_spec.rb` is denied with "contract change needs the user"; the main session's own edit is not.

- [ ] **Step 5: Run all tests and see them pass**

Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)|^ *[0-9]+ (pass|fail)'`
Expected: 0 fail.

- [ ] **Step 6: Commit**

```bash
git add hooks/conductor/frozen.ts hooks/conductor/frozen.test.ts hooks/conductor/section_hooks.test.ts hooks/register.ts
git commit -m "feat(conductor): workflow agents cannot edit a frozen check or the contract"
```

## Section E: Retire milestones and phases, document, release

### Task 15: Agents and skills speak sections and contracts

**Files:**
- Modify: `agents/auditor.md`, `agents/architect.md`, `agents/implementer.md`, `agents/reviewer.md`
- Modify: `skills/plan-authoring/SKILL.md`, `skills/phase-pr-workflow/SKILL.md` (rename directory to `skills/section-workflow/`), `skills/checkbox-progress/SKILL.md`
- Modify: `hooks/eager_skills/config.ts` (`PROCESS_SKILLS`: `phase-pr-workflow` → `section-workflow`)
- Test: `hooks/eager_skills/*.test.ts` expectations that name `phase-pr-workflow`

- [ ] **Step 1: Update tests that name the old skill, see them fail**

Replace `phase-pr-workflow` with `section-workflow` in the eager-skill tests. Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`. Expected: FAIL on those cases.

- [ ] **Step 2: Rename and rewrite**

```bash
git mv skills/phase-pr-workflow skills/section-workflow
```

- `skills/section-workflow/SKILL.md`: front matter `name: section-workflow`, `description: Load when implementing a plan section; outside-in TDD steps, the frozen contract, escalation instead of relaxing, evidence rules.` Body: replace phase and milestone wording with section; add the rules: checks and contract are frozen after the `checks(<slug>)` commit; a check that looks wrong is escalated with 1 to 5 proposals (aim for at least 2), never edited; the gate is run by the conductor, so never claim a gate passed.
- `skills/plan-authoring/SKILL.md`: a plan is `##` sections, each one PR-sized with its `- [ ]` boxes; no phase tags; each section states its success criteria in the user's terms, which the contract's `criteria` restate.
- `agents/auditor.md`: owns `done_when` checks: acceptance-level, through real boundaries, no mocks of the unit under test; runs `contract_check.mjs` until it exits 0; commits checks and contract alone as `checks(<slug>)`; never edits them afterwards except to apply a user amendment as `contract(<slug>)`.
- `agents/architect.md`: drafts the contract's `criteria` and `must_not` with the brief; never writes checks.
- `agents/implementer.md` and `agents/reviewer.md`: the frozen-contract rule and the escalation format, one line each.
- `hooks/eager_skills/config.ts`: `PROCESS_SKILLS` entries use `section-workflow`.

- [ ] **Step 3: Run all checks**

Run: `claude plugin test . && claude plugin validate .claude-plugin/plugin.json && scripts/guard_no_outside_skills.sh`
Expected: 0 fail, validation passed, guard silent.

- [ ] **Step 4: Commit**

```bash
git add agents skills hooks/eager_skills
git commit -m "feat(agents,skills): sections, frozen contracts and escalation replace phases"
```

### Task 16: Retire kickoff, phase and exit; README; release 0.22.0

**Files:**
- Modify: `workflows/milestone-kickoff.js`, `workflows/phase.js`, `workflows/milestone-exit.js`, `workflows/kickoff-phase.js` (thin aliases)
- Modify: `hooks/register.ts` (`OUROBOROS_COMMAND.description`; `kickoff`, `set phase`, `--phase` answer with the `start` hint)
- Modify: `README.md`, `.claude-plugin/plugin.json`
- Test: `hooks/conductor/conductor_hooks.test.ts` cases for `kickoff` now expect the hint

- [ ] **Step 1: Write the failing test for the retired command**

```ts
test('/ouroboros kickoff is retired and points at start', async $ => {
  worldBeneath($.on, { '.claude/ouroboros.json': CONFIG, 'docs/drafts/plan.md': PLAN })
  const { text } = await run($, 'kickoff M1')
  expect(text).toBe('kickoff is retired: plans run by section now. Run /ouroboros start [plan].')
})
```

Delete the old kickoff, phase-launch and exit test cases that this replaces. Run: `claude plugin test . 2>&1 | grep -E '^\(fail\)'`. Expected: FAIL on the new case.

- [ ] **Step 2: Implement the retirements**

- `runConductorCommand`: `kickoff`, `set phase` and `exit` return `kickoff is retired: plans run by section now. Run /ouroboros start [plan].` (same text for each, with the subcommand name).
- Each of the four old workflow files becomes:

```js
export const meta = { name: '<old name>', description: 'Retired: plans run by section. Use ouroboros:section through /ouroboros start.', phases: [{ title: 'Retired' }] }
log('retired: run /ouroboros start [plan] instead')
return { status: 'failed', failing_stage: 'retired', evidence: 'plans run by section now; run /ouroboros start [plan]' }
```

- Remove from `register.ts` the code only the retired paths used (kickoff discovery launch, phase launch, exit launch, phase checkpoint verification, `LOOP_WORKFLOWS` entries other than `section`), keeping incident filing, retro, eager skills, rollover, ADR scribe, guards and `collect`. Delete their now-dead pure modules and tests (`transitions.ts` phase paths, `reconcile.ts`, `repair.ts` if unused) only when `claude plugin test .` and `tsc` confirm nothing imports them.
- `OUROBOROS_COMMAND.description`: `'Conductor: /ouroboros start [plan] | status | pause | resume | answer <n|text> | escalations | collect <output-file> | adopt <task-id> section'`.

- [ ] **Step 3: README**

Rewrite the Workflows and Hooks paragraphs around: a plan's `##` sections; `/ouroboros start` and the goal; the section workflow's stages; the contract file and its fields; validation (red for the right reason, assertion lint, cheat attempt, coverage); frozen checks and escalation with 1 to 5 proposals; the hook-run gate and its block; PR from evidence; auto-continue after merge; new config keys `protected`, `no_new`, `red_patterns`, lane `test`/`lint`, `branch_prefix` default `work/`; migration note (old `M`/`P` plans are read as sections; old state is ignored).

- [ ] **Step 4: Bump and run every check**

Set `"version": "0.22.0"` in `.claude-plugin/plugin.json`, then:

```bash
claude plugin test .
claude plugin validate .claude-plugin/plugin.json
scripts/guard_no_outside_skills.sh
node --experimental-strip-types --no-warnings scripts/check_workflow_mirrors.mjs
```

Expected: 0 fail, validation passed, guard silent, mirrors ok.

- [ ] **Step 5: Commit**

```bash
git add workflows hooks README.md .claude-plugin/plugin.json
git commit -m "feat!: plans run by section with verified gates; kickoff, phase and exit retired (0.22.0)"
```

### Task 17: Live check in one project

**Files:** none in the plugin unless the run finds a bug (then a test-first fix commit per bug).

- [ ] **Step 1: Push and install** — `git push origin main`; in the project: `claude plugin marketplace update ouroboros && claude plugin update ouroboros@ouroboros`; restart that session.
- [ ] **Step 2: Run one real section** — in the project session: `/ouroboros start <plan>` on a small section. Expected: a goal is set, `ouroboros:section` launches, a `checks(<slug>)` commit lands red, the cheat stage reports, implementation and review finish, the transcript shows a `GATE PASS` or `GATE FAIL` block written by the conductor, and a PR (ready or draft) carries the same block.
- [ ] **Step 3: Force one escalation** — in a scratch section, give a criterion a check that a hard-coded value satisfies. Expected: the run stops at Validate with the cheat diff as evidence and at least one proposal; `/ouroboros answer 1` resumes from Validate with a `contract(<slug>)` commit.
- [ ] **Step 4: Record the outcome** — append a dated line per finding to `docs/specs/2026-10-10-sections-and-verified-gates.md` under a new `## Live check` heading, and commit it.
