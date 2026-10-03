import { expect, test } from 'claude-code/testing'

import { duplicateLoadWarning, isAnotherInstance } from './double_load'

const ACTIVE = { name: 'ouroboros', root: '/code/ouroboros' }

test('another directory holding this same plugin is a second instance', () => {
  expect(isAnotherInstance({ name: 'ouroboros', root: '/home-dir/.claude/plugins/cache/ouroboros/ouroboros/0.13.1' }, ACTIVE)).toBe(true)
  expect(isAnotherInstance({ name: 'ouroboros', root: '/code/ouroboros' }, ACTIVE)).toBe(false)
  expect(isAnotherInstance({ name: 'other-plugin', root: '/code/other' }, ACTIVE)).toBe(false)
})

test('the warning names both roots and which one stays', () => {
  expect(duplicateLoadWarning(ACTIVE, { root: '/cache/ouroboros/0.13.1', provenance: 'ouroboros@ouroboros' })).toBe(
    'ouroboros is loaded twice: /code/ouroboros stays active, /cache/ouroboros/0.13.1 (ouroboros@ouroboros) is refused so every hook runs once; remove the stale plugin link or install',
  )
})
