import type { Finding } from './findings'

export const PLUGIN_SKILLS = new Set(['phase-pr-workflow', 'code-style', 'planning-lessons', 'findings-contract', 'adr-format', 'checkbox-progress'])

const evidence = (finding: Finding) => (finding.file === undefined ? '' : `${finding.file}:${finding.line ?? ''}`)

export const incidentRow = (finding: Finding, phase: string, dateIso: string) =>
  `| ${dateIso} | ${phase} | ${finding.agent ?? ''} | ${finding.root_cause} | | ${finding.summary} | ${evidence(finding)} | open | |\n`

const bareName = (name: string) => name.slice(name.lastIndexOf(':') + 1)

const skillIncidentPath = (skill: string | undefined, pluginRoot: string) => {
  const skillName = bareName(skill ?? '')
  return PLUGIN_SKILLS.has(skillName) ? `${pluginRoot}/skills/${skillName}/incidents.md` : `.claude/skills/${skillName}/incidents.md`
}

export const incidentLogPath = (finding: Finding, pluginRoot: string) =>
  finding.root_cause === 'agent-behaviour'
    ? `${pluginRoot}/agents/incidents/${bareName(finding.agent ?? '')}.md`
    : skillIncidentPath(finding.skill, pluginRoot)
