import { expect, test } from 'claude-code/testing'

import { parseFindings } from './findings'
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
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'implementer-ruby' }, WRITABLE)).toBe('/code/ouroboros/agents/incidents/implementer.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'ouroboros:auditor' }, INSTALLED)).toBe('/work/shop/.claude/ouroboros/plugin-incidents/ouroboros/agents/auditor.md')
  expect(incidentLogPath({ summary: 's', root_cause: 'agent-behaviour', agent: 'planner' }, WRITABLE)).toBe('/work/shop/.claude/ouroboros/plugin-incidents/ouroboros/agents/planner.md')
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
