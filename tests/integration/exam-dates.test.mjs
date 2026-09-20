import {test} from 'node:test';
import assert from 'node:assert/strict';
import {examDatePages} from '../../public/exam-dates.mjs';
const pages=days=>examDatePages(days.map(date=>({date})));
test('exam date columns only include actual exam days; short series do not paginate',()=>{
 assert.deepEqual(pages([]),[]);
 assert.deepEqual(pages(['2026-09-23','2026-09-21','2026-09-22','2026-09-21']),[['2026-09-21','2026-09-22','2026-09-23']]);
 const five=['2026-09-24','2026-09-25','2026-09-28','2026-09-29','2026-09-30'];assert.deepEqual(pages(five),[five]);
 assert.deepEqual(pages(['2026-09-27']),[['2026-09-27']]);
});
test('longer series page by actual weeks and skip empty weeks, retaining weekend exams',()=>{
 const first=['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-27'];
 assert.deepEqual(pages([...first,'2026-10-05']),[first,['2026-10-05']]);
});
