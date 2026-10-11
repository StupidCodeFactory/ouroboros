import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const CHECKOUT_ROOT = new URL('../../', import.meta.url).pathname
const ACCEPTANCE_DIR = `${CHECKOUT_ROOT}scripts/acceptance/`

const shell = command => spawnSync('sh', ['-c', command], { cwd: CHECKOUT_ROOT, encoding: 'utf8' })

const assertSucceeds = command => {
  const run = shell(command)
  assert.equal(run.status, 0, `${command}\nexit ${run.status}\n${run.stdout}${run.stderr}`)
}

const developmentSection = () => readFileSync(`${CHECKOUT_ROOT}README.md`, 'utf8').split(/^## /m).find(section => section.startsWith('Development')) ?? ''

const configuredGithub = () => JSON.parse(readFileSync(`${CHECKOUT_ROOT}.claude/ouroboros.json`, 'utf8')).github ?? {}

const projectValues = () => {
  const github = configuredGithub()
  const owner = github.repo?.split('/')[0]
  return [github.repo, owner, github.project].filter(value => typeof value === 'string' && value !== '')
}

const acceptanceSources = () =>
  existsSync(ACCEPTANCE_DIR)
    ? readdirSync(ACCEPTANCE_DIR, { recursive: true })
        .filter(name => /\.(mjs|sh|md)$/.test(name) && name !== 'acceptance_scripts.test.mjs')
        .map(name => ({ name, text: readFileSync(`${ACCEPTANCE_DIR}${name}`, 'utf8') }))
    : []

const GH_WRITES = /issue['", ]+(edit|close|comment|create)|item-edit|item-add|-X['", ]+(POST|PATCH|PUT|DELETE)|--method['", ]+(POST|PATCH|PUT|DELETE)|\bmutation\b/

describe('the kickoff acceptance scripts', () => {
  test('exist, the shell entry points executable', () => {
    assertSucceeds('test -x scripts/acceptance/kickoff_creates.sh -a -x scripts/acceptance/kickoff_rerun.sh -a -x scripts/acceptance/board_planned.sh -a -f scripts/acceptance/contract_sections.mjs')
  })

  test('fail naming the scratch repository variable when it is unset', () => {
    assertSucceeds(`sh -c 'out=$(env -u OUROBOROS_SCRATCH_REPO scripts/acceptance/kickoff_creates.sh 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q OUROBOROS_SCRATCH_REPO'`)
  })

  test('fail naming the kickoff record when it does not exist', () => {
    assertSucceeds(`sh -c 'out=$(OUROBOROS_SCRATCH_REPO=o/r OUROBOROS_SCRATCH_ISSUE=1 OUROBOROS_KICKOFF_RECORD=/nonexistent scripts/acceptance/kickoff_rerun.sh 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q "kickoff record"'`)
  })

  test('judge the kickoff record against sub-issues and the board in their own examples', () => {
    assertSucceeds('node --experimental-strip-types --no-warnings --test scripts/acceptance/kickoff_record.test.mjs')
  })

  test('never write to GitHub', () => {
    const sources = acceptanceSources()
    assert.notEqual(sources.length, 0, 'no acceptance script found')
    assert.deepEqual(sources.filter(source => GH_WRITES.test(source.text)).map(source => source.name), [])
  })

  test('name no configured repository, account or board, here or in the README development section', () => {
    const sources = acceptanceSources()
    assert.notEqual(sources.length, 0, 'no acceptance script found')
    const texts = [{ name: 'README.md Development', text: developmentSection() }, ...sources]
    const leaks = texts.flatMap(({ name, text }) => projectValues().filter(value => text.includes(value)).map(value => `${name}: ${value}`))
    assert.deepEqual(leaks, [])
  })

  test('pass the plugin guard', () => {
    assert.notEqual(acceptanceSources().length, 0, 'no acceptance script found')
    assertSucceeds('./scripts/guard_no_outside_skills.sh')
  })
})

describe('the contract sections check', () => {
  test('passes a body with all seven sections filled', () => {
    assertSucceeds('node --experimental-strip-types scripts/acceptance/contract_sections.mjs --body-file scripts/acceptance/fixtures/valid_task.md')
  })

  test('fails on an empty Must not, naming it', () => {
    assertSucceeds(`sh -c 'out=$(node --experimental-strip-types scripts/acceptance/contract_sections.mjs --body-file scripts/acceptance/fixtures/empty_must_not.md 2>&1); [ $? -eq 1 ] && echo "$out" | grep -q "Must not"'`)
  })

  test('fails naming both scratch variables when they are unset and no body file is given', () => {
    const run = shell('env -u OUROBOROS_SCRATCH_REPO -u OUROBOROS_SCRATCH_ISSUE node --experimental-strip-types --no-warnings scripts/acceptance/contract_sections.mjs')
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /OUROBOROS_SCRATCH_REPO/)
    assert.match(run.stderr, /OUROBOROS_SCRATCH_ISSUE/)
  })
})

describe('the README development section', () => {
  test('tells how to run the acceptance scripts through their env vars', () => {
    const section = developmentSection()
    for (const name of ['OUROBOROS_SCRATCH_REPO', 'OUROBOROS_SCRATCH_ISSUE', 'OUROBOROS_KICKOFF_RECORD', '--body-file', 'scripts/acceptance']) assert.ok(section.includes(name), `README Development lacks ${name}`)
  })
})
