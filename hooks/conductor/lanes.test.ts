import { expect, test } from 'claude-code/testing'

import { laneOfFiles, taskLane } from './lanes'

const PRICE_FEED_LANES = {
  ruby: ['lib/**', 'spec/**', 'bin/**', 'db/migrations/**', 'config/**'],
  python: ['services/**', 'proto/**'],
}

test('a task touching only Ruby paths is in the ruby lane', () => {
  expect(laneOfFiles(['lib/price_feed/web/api.rb', 'spec/price_feed/web/owners_spec.rb'], PRICE_FEED_LANES)).toBe('ruby')
})

test('a task touching only service paths is in the python lane', () => {
  expect(laneOfFiles(['services/parquet_writer/tests/test_events_contract.py', 'services/density/tests/test_events_contract.py'], PRICE_FEED_LANES)).toBe('python')
})

test('the lane owning most of the touched files wins, and a tie names no lane', () => {
  expect(laneOfFiles(['lib/a.rb', 'spec/a_spec.rb', 'services/x.py'], PRICE_FEED_LANES)).toBe('ruby')
  expect(laneOfFiles(['lib/a.rb', 'services/x.py'], PRICE_FEED_LANES)).toBeUndefined()
  expect(laneOfFiles(['README.md'], PRICE_FEED_LANES)).toBeUndefined()
})

test('an explicit heading lane wins over the touched files', () => {
  expect(taskLane({ lane: 'ruby', touches: ['proto/events.proto', 'services/a/events_pb2.py'] }, PRICE_FEED_LANES)).toBe('ruby')
  expect(taskLane({ touches: ['services/a/events_pb2.py'] }, PRICE_FEED_LANES)).toBe('python')
  expect(taskLane({}, PRICE_FEED_LANES)).toBeUndefined()
})
