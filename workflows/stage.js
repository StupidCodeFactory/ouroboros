export const meta = {
  name: 'stage',
  description: 'One ouroboros loop stage: the architect plans a milestone, the implementer works a sub-issue, or the reviewer checks it. The ouroboros hook applies the answer to GitHub.',
  phases: [{ title: 'Stage' }],
}

const COMMAND_ITEM = {
  type: 'object',
  properties: { text: { type: 'string' }, command: { type: 'string' } },
  required: ['text', 'command'],
}

const KICKOFF = {
  type: 'object',
  properties: {
    milestone: {
      type: 'object',
      properties: { goal: { type: 'string' }, brief: { type: 'string' }, acceptance: { type: 'array', items: COMMAND_ITEM, minItems: 1 } },
      required: ['goal', 'brief', 'acceptance'],
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue: { type: 'number' },
          title: { type: 'string' },
          goal: { type: 'string' },
          plan: { type: 'string' },
          checklist: { type: 'array', items: COMMAND_ITEM, minItems: 1 },
          depends_on: { type: 'array', items: { type: 'object', properties: { issue: { type: 'number' }, task: { type: 'number' } } } },
        },
        required: ['title', 'goal', 'plan', 'checklist', 'depends_on'],
      },
    },
  },
  required: ['milestone', 'tasks'],
}

const IMPLEMENT = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['done', 'blocked'] }, summary: { type: 'string' }, question: { type: 'string' } },
  required: ['status'],
}

const REVIEW = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { index: { type: 'number' }, pass: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['index', 'pass', 'evidence'] },
    },
    defects: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'defects'],
}

const SCHEMAS = { kickoff: KICKOFF, implement: IMPLEMENT, review: REVIEW }

phase('Stage')
return agent(`Read ${args.brief} in full: it is your task.`, { label: args.label, phase: 'Stage', agentType: args.agent, schema: SCHEMAS[args.stage] })
