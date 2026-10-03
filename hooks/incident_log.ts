import type { Finding } from './findings'

export const PLUGIN_SKILLS = new Set(['phase-pr-workflow', 'code-style', 'planning-lessons', 'findings-contract', 'adr-format', 'checkbox-progress'])

export const incidentRow = (finding: Finding, phase: string, dateIso: string) =>
  `| ${dateIso} | ${phase} | ${finding.agent ?? ''} | ${finding.root_cause} | | ${finding.summary} | ${finding.file ?? ''}:${finding.line ?? ''} | open | |\n`

const skillIncidentPath = (skill: string | undefined, pluginRoot: string) =>
  PLUGIN_SKILLS.has(skill ?? '') ? `${pluginRoot}/skills/${skill}/incidents.md` : `.claude/skills/${skill}/incidents.md`

export const incidentLogPath = (finding: Finding, pluginRoot: string) =>
  finding.root_cause === 'agent-behaviour'
    ? `${pluginRoot}/agents/incidents/${finding.agent}.md`
    : skillIncidentPath(finding.skill, pluginRoot)
