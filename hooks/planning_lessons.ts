const bareName = (name: string) => name.slice(name.lastIndexOf(':') + 1)

export const isPlanningSkill = (planningSkills: string[] | undefined, skill: string) =>
  (planningSkills ?? []).some(planning => bareName(planning) === bareName(skill))

export const withPlanningLessons = (skillText: string, lessonsText: string) =>
  `${skillText}\n\n## Planning lessons (from past sessions)\n\n${lessonsText}`

export const candidateRow = (dateIso: string, phase: string, promptText: string) =>
  `| ${dateIso} | ${phase} | user | candidate | | ${promptText.replace(/\s*\n\s*/g, ' ')} | | candidate | |\n`
