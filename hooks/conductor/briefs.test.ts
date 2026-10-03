import { expect, test } from 'claude-code/testing'

import { briefFiles, briefSlicesOf } from './briefs'

const SLICED = {
  brief: {
    common: 'Forbidden: new .instance callers; every review gate in the M1 brief applies.',
    tasks: [
      { id: '3', guidance: 'DashboardGaps#call delegates to Backfill::DashboardClient.gaps.', touches: ['lib/shop/gap_source_planner.rb', 'lib/shop/backfill/dashboard_client.rb'] },
      { id: '17', guidance: 'One month-range helper in MonthBucket.', touches: ['lib/shop/month_bucket.rb'] },
    ],
  },
}

test('a sliced brief is read from the kickoff result', () => {
  expect(briefSlicesOf(SLICED)).toEqual(SLICED.brief)
})

test('a plain-text brief has no slices', () => {
  expect(briefSlicesOf({ brief: 'M1 Foundations design brief (P0, P1).' })).toBeUndefined()
  expect(briefSlicesOf(undefined)).toBeUndefined()
})

test('a sliced brief files as common.md plus one file per task naming what it touches', () => {
  expect(briefFiles(SLICED.brief)).toEqual([
    { name: 'common.md', text: 'Forbidden: new .instance callers; every review gate in the M1 brief applies.\n' },
    {
      name: '3.md',
      text: 'DashboardGaps#call delegates to Backfill::DashboardClient.gaps.\n\nTouches:\n- lib/shop/gap_source_planner.rb\n- lib/shop/backfill/dashboard_client.rb\n',
    },
    { name: '17.md', text: 'One month-range helper in MonthBucket.\n\nTouches:\n- lib/shop/month_bucket.rb\n' },
  ])
})
