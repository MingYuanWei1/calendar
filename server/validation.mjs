import {z} from 'zod';
import {repeatProblem} from '../public/recurrence.mjs';
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value&&value>='1900-01-01'&&value<='2200-12-31';
},'Invalid calendar date');
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const bilingual=length=>z.tuple([z.string().trim().max(length),z.string().trim().max(length)]);
const optionalLink=z.string().trim().max(2048).default('').refine(value=>{
  if(!value)return true;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
},'Use an HTTP or HTTPS URL without credentials');
const weekday=z.number().int().min(1).max(7);
const repeatSchema=z.object({
  freq:z.enum(['daily','weekly','monthly']),interval:z.number().int().min(1).max(99).default(1),schoolDays:z.boolean().optional(),
  weekdays:z.array(weekday).min(1).max(7).optional(),monthDays:z.array(z.number().int().min(1).max(31)).min(1).max(31).optional(),
  ordinal:z.union([z.literal(-1),z.literal(1),z.literal(2),z.literal(3),z.literal(4)]).optional(),weekday:weekday.optional(),
  until:day.optional(),count:z.number().int().min(1).max(999).optional()
}).transform(({freq,interval,schoolDays,weekdays,monthDays,ordinal,weekday,until,count})=>{
  const sorted=values=>[...new Set(values)].sort((a,b)=>a-b);
  return {freq,interval:schoolDays?1:interval,...(freq==='daily'&&schoolDays?{schoolDays:true}:{}),
    ...(freq==='weekly'?{weekdays:sorted(weekdays||[])}:{}),
    ...(freq==='monthly'?monthDays?{monthDays:sorted(monthDays)}:{ordinal,weekday}:{}),
    ...(until?{until}:{}),...(count?{count}:{})};
});
const media=z.string().regex(/^\/api\/media\/[a-f0-9-]{36}$/).or(z.literal('')).default('');
export const eventSchema=z.object({
  title:bilingual(250).refine(value=>value.some(Boolean),'A title in at least one language is required'),
  type:z.enum(['exam','competition','activity','deadline']),
  timeMode:z.enum(['timed','allDay','multi','deadline']),start:day,end:day.optional(),time:time.optional(),endTime:time.optional(),
  scope:z.array(z.enum(['schoolwide','primary','middle','high'])).min(1).max(3).refine(value=>new Set(value).size===value.length&&(!value.includes('schoolwide')||value.length===1),'Choose school-wide or specific divisions'),
  status:z.enum(['draft','published','cancelled']),
  location:bilingual(300).default(['','']),host:bilingual(300).default(['','']),description:bilingual(15000).default(['','']),
  poster:media,qr:media,registrationUrl:optionalLink,
  repeat:repeatSchema.nullable().optional(),
  version:z.number().int().positive().optional()
}).superRefine((event,ctx)=>{
  const invalid=(path,message)=>ctx.addIssue({code:'custom',path:[path],message});
  if(event.type==='deadline'&&event.timeMode!=='deadline')invalid('timeMode','Deadline events require the deadline time format');
  if(event.timeMode==='deadline'&&event.type!=='deadline')invalid('type','Deadline time format requires Deadline event type');
  if(event.timeMode==='timed'&&!event.time)invalid('time','Time is required');
  if(event.timeMode==='timed'&&(!event.endTime||event.endTime<event.time))invalid('endTime','End time must not precede start time');
  if(event.timeMode==='multi'&&(!event.end||event.end<event.start))invalid('end','End date must not precede start date');
  if(event.repeat&&event.timeMode==='multi')invalid('repeat','Multi-day events cannot repeat');
  const problem=event.repeat&&repeatProblem(event.repeat,event.start);
  if(problem)invalid('repeat',problem);
}).transform(event=>({...event,end:event.timeMode==='multi'?event.end:undefined,time:['timed','deadline'].includes(event.timeMode)?event.time:undefined,endTime:event.timeMode==='timed'?event.endTime:undefined,repeat:event.repeat||undefined}));

export const dayPlanSchema=z.object({start:day,end:day.or(z.literal('')).optional(),kind:z.enum(['off','school','half','default']),title:bilingual(60).default(['','']),follows:z.number().int().min(1).max(5).nullable().default(null)})
  .transform(value=>({...value,end:value.end||value.start,follows:['school','half'].includes(value.kind)?value.follows:null}))
  .refine(value=>value.end>=value.start&&(Date.parse(value.end)-Date.parse(value.start))/86400000<366,'Choose a date range of at most 366 days');
