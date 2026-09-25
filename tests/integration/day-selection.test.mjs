import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createDayPlanResolver} from '../../public/day-plans.mjs';
import {dayPlanSchema} from '../../server/validation.mjs';

// Run the real page's delegated click/save handlers with only DOM and transport stubbed.
test('one click saves one date, ranges save both dates, and the next selection starts fresh',async()=>{
  const page={},element={focus(){},hidden:true},requests=[];
  const main={innerHTML:'',querySelector:()=>page,querySelectorAll:()=>[]};
  const context=createContext({main,createDayPlanResolver,Blob,Event,
    localStorage:{getItem:()=>null},document:{querySelector:()=>element},
    window:{dispatchEvent(){}},
    fetch:async(path,options)=>{
      if(options.method==='PUT'){
        const body=JSON.parse(options.body);requests.push(body);
        const parsed=dayPlanSchema.safeParse(body);
        return new Response(parsed.success?null:JSON.stringify({error:'Invalid day range'}),{status:parsed.success?204:422});
      }
      return Response.json([]);
    }
  });
  const core=await readFile(new URL('../../public/console-core.js',import.meta.url),'utf8');
  const days=await readFile(new URL('../../public/console-days.js',import.meta.url),'utf8');
  runInContext(core.replace(/^export /gm,'')+'\n'+days.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context);
  await runInContext("app.today='2026-09-25';app.data.plans={};toast=()=>{};showDays(main)",context);
  const click=async(dataset,save=false)=>page.onclick({target:{closest:()=>({dataset,hasAttribute:name=>save&&name==='data-save'})}});
  const save=()=>click({},true);
  await click({day:'2026-09-23'});await click({kind:'half'});await save();
  assert.deepEqual(requests.at(-1),{start:'2026-09-23',end:'2026-09-23',kind:'half',title:['','']});
  await click({day:'2026-09-26'});await click({day:'2026-09-28'});await save();
  assert.equal(requests.at(-1).start,'2026-09-26');assert.equal(requests.at(-1).end,'2026-09-28');
  await click({day:'2026-09-24'});await save();
  assert.equal(requests.at(-1).start,'2026-09-24');assert.equal(requests.at(-1).end,'2026-09-24');
  assert.equal(element.hidden,true);
});
