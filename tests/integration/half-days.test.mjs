import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDayPlanResolver} from '../../public/day-plans.mjs';

const resolve=entries=>createDayPlanResolver(Object.fromEntries(entries.map(([date,kind])=>[date,{date,kind,title:['','']}])));

test('Fridays and pre-holiday dates never receive automatic half-day settings',()=>{
  const plan=resolve([['2026-09-28','off'],['2026-10-01','off'],['2027-01-01','off']]);
  for(const day of ['2026-09-24','2026-09-25','2026-09-26','2026-09-27','2026-09-30','2026-12-31']){
    assert.equal(plan(day),undefined);
  }
  assert.equal(plan('2026-09-28').kind,'off');
});

test('manual half days apply to any weekday or weekend without changing adjacent dates',()=>{
  const plan=resolve([['2026-09-23','half'],['2026-09-25','school'],['2026-09-27','half'],['2026-09-28','off']]);
  assert.equal(plan('2026-09-23').kind,'half');
  assert.equal(plan('2026-09-27').kind,'half');
  assert.equal(plan('2026-09-25').kind,'school');
  assert.equal(plan('2026-09-28').kind,'off');
  assert.equal(plan('2026-09-24'),undefined);
  assert.equal(plan('2026-09-26'),undefined);
});

test('clearing a manual half day restores an unconfigured date even on Friday',()=>{
  assert.equal(resolve([['2026-09-25','half']])('2026-09-25').kind,'half');
  assert.equal(resolve([])('2026-09-25'),undefined);
});
