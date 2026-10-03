import { expect, test } from 'claude-code/testing'

import { parseFindings, resultIncidents } from './findings'
import { incidentLogPath, incidentRow, openIncidentCount } from './incident_log'

test('reads the fenced findings block', () => {
  const agentText = [
    'review done',
    '```json',
    '{"findings":[{"summary":"skipped the retry step","root_cause":"skill-misread","skill":"example-domain"}]}',
    '```',
  ].join('\n')

  expect(parseFindings(agentText)).toEqual([
    { summary: 'skipped the retry step', root_cause: 'skill-misread', skill: 'example-domain' },
  ])
})

test('returns nothing when the agent wrote no findings block', () => {
  expect(parseFindings('all good')).toEqual([])
})

const WRITABLE = {
  pluginName: 'ouroboros',
  pluginRoot: '/code/ouroboros',
  projectRoot: '/work/shop',
  pluginWritable: true,
  pluginSkills: ['code-style', 'planning-lessons', 'phase-pr-workflow'],
  pluginAgents: ['architect', 'auditor', 'implementer', 'reviewer'],
}
const INSTALLED = { ...WRITABLE, pluginRoot: '/home-dir/.claude/plugins/cache/ouroboros/ouroboros/0.13.1', pluginWritable: false }

test('a plugin skill incident goes to the plugin checkout when it is a writable git checkout', () => {
  expect(incidentLogPath({ summary: 's', root_cause: 'skill-gap', skill: 'ouroboros:planning-lessons' }, WRITABLE)).toBe('/code/ouroboros/skills/planning-lessons/incidents.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'skill-gap', skill: 'planning-lessons' }, WRITABLE)).toBe('/code/ouroboros/skills/planning-lessons/incidents.md')
})

test('a plugin skill incident goes to the project\'s plugin-incidents when the plugin is an installed copy', () => {
  expect(incidentLogPath({ summary: 's', root_cause: 'skill-gap', skill: 'planning-lessons' }, INSTALLED)).toBe('/work/shop/.claude/ouroboros/plugin-incidents/ouroboros/skills/planning-lessons.md')
})

test('a project skill incident goes to the project\'s own skill, from the project root', () => {
  expect(incidentLogPath({ summary: 's', root_cause: 'skill-gap', skill: 'pipeline-invariants' }, INSTALLED)).toBe('/work/shop/.claude/skills/pipeline-invariants/incidents.md')
})

test('another plugin\'s skill is never written in place', () => {
  expect(incidentLogPath({ summary: 's', root_cause: 'skill-misread', skill: 'other-plugin:code-review' }, WRITABLE)).toBe('/work/shop/.claude/ouroboros/plugin-incidents/other-plugin/skills/code-review.md')
})

test('an agent incident names the plugin agent without its lane', () => {
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'implementer-ruby' }, WRITABLE)).toBe('/code/ouroboros/incidents/agents/implementer.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'ouroboros:auditor' }, INSTALLED)).toBe('/work/shop/.claude/ouroboros/plugin-incidents/ouroboros/agents/auditor.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'implementer:ruby' }, WRITABLE)).toBe('/code/ouroboros/incidents/agents/implementer.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'architect-m1' }, WRITABLE)).toBe('/code/ouroboros/incidents/agents/architect.md')
})

test('the planner and the curator are named by the plugin agent that plays them', () => {
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'planner' }, WRITABLE)).toBe('/code/ouroboros/incidents/agents/architect.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'curator' }, { ...WRITABLE, pluginAgents: [...WRITABLE.pluginAgents, 'skill-curator'] })).toBe('/code/ouroboros/incidents/agents/skill-curator.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'researcher' }, WRITABLE)).toBe('/work/shop/.claude/ouroboros/plugin-incidents/ouroboros/agents/researcher.md')
})

test('a process finding that names only an agent goes to that agent, one that names nobody to the unowned log', () => {
  expect(incidentLogPath({ summary: 's', root_cause: 'skill-gap', agent: 'auditor' }, WRITABLE)).toBe('/code/ouroboros/incidents/agents/auditor.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour' }, WRITABLE)).toBe('/work/shop/.claude/ouroboros/plugin-incidents/ouroboros/unowned.md')
})

test('an incident row names its evidence relative to the project, never by an absolute home path', () => {
  const finding = { summary: 'memory points at renamed files', root_cause: 'agent-behaviour' as const, agent: 'auditor', file: '/work/shop/.claude/agent-memory/auditor.md', line: 13 }
  expect(incidentRow(finding, 'P0', '2026-10-03', '/work/shop')).toBe('| 2026-10-03 | P0 | auditor | agent-behaviour | | memory points at renamed files | .claude/agent-memory/auditor.md:13 | open | |\n')
})

test('plan drift rows never count as open skill incidents', () => {
  const rows = [
    '| 2026-10-03 | P1 | main | plan-drift | | draft edited after kickoff | docs/plans/m1.md | open | |',
    '| 2026-10-03 | P0 | auditor | agent-behaviour | | memory points at renamed files | .claude/agent-memory/auditor.md:13 | open | |',
    '| 2026-10-03 | P0 | architect | skill-gap | | verify task names no spec | | fixed | evals/x.md |',
  ].join('\n')
  expect(openIncidentCount(rows)).toBe(1)
})

const P0_ARCHITECT_PLANNING_GAP = {
  root_cause: 'skill-gap',
  skill: 'planning-lessons',
  agent: 'architect',
  blocking: false,
  file: 'lib/shop/backfill/dashboard_client.rb',
  line: 50,
  summary: 'Task 2 is verification only and adds no code; a verify task should name the spec that pins its contract.',
}
const P0_AUDITOR_INVARIANT_GAP = {
  root_cause: 'skill-gap',
  skill: 'pipeline-invariants',
  agent: null,
  blocking: false,
  file: 'lib/shop/backfill/dashboard_client.rb',
  line: 50,
  summary: 'The plan says DashboardClient fails loudly on any non-200, but no spec checks the raise.',
}
const P0_AUDITOR_STALE_MEMORY = {
  root_cause: 'agent-behaviour',
  skill: null,
  agent: 'auditor',
  blocking: false,
  file: '/work/shop/.claude/agent-memory/auditor.md',
  line: 13,
  summary: "The auditor memory's 'Open task' line still points at spec files a later commit renamed.",
}
const P0_PASSING_NOTE = { root_cause: 'agent-behaviour', skill: null, agent: null, blocking: false, summary: "Task 2 passes. The plan's only step is ticked." }
const P0_CODE_BUG = { root_cause: 'code-bug', blocking: true, file: 'lib/shop/gap_source_planner.rb', line: 19, summary: 'still .instance' }

const P0_RESULT = {
  status: 'checkpointed',
  phase: 'P0',
  tasks: [
    { id: '2', status: 'done', findings: [P0_ARCHITECT_PLANNING_GAP, P0_AUDITOR_INVARIANT_GAP, P0_AUDITOR_STALE_MEMORY, P0_PASSING_NOTE] },
    { id: '3', status: 'done', findings: [P0_CODE_BUG, P0_ARCHITECT_PLANNING_GAP] },
  ],
}

test('a phase result yields every process finding once, owned or not, never code bugs', () => {
  expect(resultIncidents(P0_RESULT).map(finding => finding.summary)).toEqual([
    P0_ARCHITECT_PLANNING_GAP.summary,
    P0_AUDITOR_INVARIANT_GAP.summary,
    P0_AUDITOR_STALE_MEMORY.summary,
    P0_PASSING_NOTE.summary,
  ])
})

test('a workflow result\'s own findings count as well as its tasks\'', () => {
  const kickoff = { brief: 'b', findings: [P0_AUDITOR_STALE_MEMORY, P0_CODE_BUG] }
  expect(resultIncidents(kickoff).map(finding => finding.summary)).toEqual([P0_AUDITOR_STALE_MEMORY.summary])
})

test('a result without tasks yields nothing', () => {
  expect(resultIncidents(undefined)).toEqual([])
  expect(resultIncidents({ status: 'escalate' })).toEqual([])
})
