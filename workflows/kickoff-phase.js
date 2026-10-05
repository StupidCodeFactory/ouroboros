export const meta = {
  name: 'kickoff-phase',
  description: 'Kickoff then one phase in a single run: the milestone-kickoff workflow, then the phase workflow on the kicked-off phase with the brief, tasks and acceptance checks handed over inline',
  phases: [{ title: 'Kickoff' }, { title: 'Phase' }],
}

const plannedTasks = (brief, phaseId) =>
  (brief.tasks ?? []).filter(task => task.phase === phaseId).map(task => ({ id: task.id, title: task.title, touches: task.touches, ...(task.lane ? { lane: task.lane } : {}) }))

phase('Kickoff')
const kicked = await workflow('ouroboros:milestone-kickoff', args)
if (!kicked || kicked.error) return { status: 'escalate', phase: args.phase ?? '', tasks: [], follow_ups: [], evidence: '', failing_gate: `kickoff: ${(kicked && kicked.error) || 'returned nothing'}`, kickoff: kicked }

const phaseId = args.phase ?? (kicked.phases ?? [])[0]
const tasks = plannedTasks(kicked.brief, phaseId)
log(`kickoff done: phase ${phaseId}, tasks ${tasks.map(task => task.id).join(', ') || 'none'}, checks ${(kicked.checks ?? []).length}`)

phase('Phase')
const { fresh_branch: _branchedAtKickoff, ...phaseArgs } = args
const ran = await workflow('ouroboros:phase', { ...phaseArgs, phase: phaseId, tasks, brief_slices: kicked.brief, checks: kicked.checks ?? [] })
return { ...(ran ?? { status: 'escalate', phase: phaseId, tasks: [], follow_ups: [], evidence: '', failing_gate: 'phase returned nothing' }), kickoff: { decisions: kicked.decisions, checks: kicked.checks, red: kicked.red, findings: kicked.findings } }
