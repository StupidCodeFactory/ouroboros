import { expect, test } from 'claude-code/testing'

import { afterLastColon, withoutPluginPrefix } from './names'

test('a two-colon name loses only its plugin prefix', () => {
  expect(withoutPluginPrefix('acme:acme:ultra')).toBe('acme:ultra')
})

test('a two-colon name keeps only the text after its last colon', () => {
  expect(afterLastColon('acme:acme:ultra')).toBe('ultra')
})

test('a bare name passes through both unchanged', () => {
  expect(withoutPluginPrefix('phase')).toBe('phase')
  expect(afterLastColon('phase')).toBe('phase')
})
