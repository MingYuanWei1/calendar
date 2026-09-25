import {z} from 'zod';
import {defaultExamSlots} from '../public/exam-times.mjs';
const text=n=>z.string().trim().max(n);
const required=n=>text(n).min(1);
const id=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T12:00:00Z');return !isNaN(+d)&&d.toISOString().slice(0,10)===v;});
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const sessionSchema=z.object({id,title:required(180),titleEn:text(180).default(''),subject:text(100).default(''),subjectEn:text(100).default(''),level:text(40).default(''),division:z.enum(['primary','middle','high']),grades:z.array(required(30)).min(1).max(20),date:day,start:time,end:time,rooms:z.array(required(60)).min(1).max(30),cancelled:z.boolean().default(false),note:text(1000).default('')}).refine(s=>s.end>s.start,'考试结束必须晚于开始');
export const seatSchema=z.object({examId:id,room:required(60),row:z.number().int().min(1).max(40),column:z.number().int().min(1).max(40),className:required(60),name:text(80),englishName:text(120),grade:z.number().int().min(1).max(12).nullable().optional(),studentId:id.optional()}).refine(s=>s.name||s.englishName,'至少填写一种姓名');
export const batchSchema=z.object({academicYear:z.number().int().min(2000).max(2199).optional(),division:z.enum(['primary','middle','high']).optional(),title:required(180),titleEn:text(180).default(''),start:day,end:day,version:z.number().int().min(1).optional(),timeSlots:z.array(z.object({start:time,end:time})).min(1).max(20).default(defaultExamSlots),sessions:z.array(sessionSchema).max(500),rooms:z.array(z.object({name:required(60),rows:z.number().int().min(1).max(40),columns:z.number().int().min(1).max(40)})).max(100),seats:z.array(seatSchema).max(20000)}).superRefine((b,ctx)=>{
 const fail=message=>ctx.addIssue({code:'custom',message});
 const slots=[...b.timeSlots].sort((a,b)=>a.start.localeCompare(b.start));
 if(slots.some((s,i)=>s.end<=s.start||(i>0&&s.start<slots[i-1].end)))fail('时间段结束须晚于开始，且时间段不能重叠');
 if(b.end<b.start||Date.parse(b.end)-Date.parse(b.start)>366*86400000)fail('考试批次日期范围无效（最多 366 天）');
 if(new Set(b.sessions.map(s=>s.id)).size!==b.sessions.length)fail('考试编号重复');
 if(new Set(b.rooms.map(r=>r.name)).size!==b.rooms.length)fail('教室名称重复');
 for(const s of b.sessions){if(s.level&&!s.subject)fail('填写 Level 时请选择学科');if(s.date<b.start||s.date>b.end)fail(`考试 ${s.title} 超出批次日期`);if(s.rooms.some(r=>!b.rooms.some(room=>room.name===r)))fail(`考试 ${s.title} 使用了未定义的教室`);}
});
export function seatErrors(batch,seats=batch.seats){
 const errors=[],occupied=new Map();
 seats.forEach((seat,i)=>{
  const s=batch.sessions.find(s=>s.id===seat.examId),room=batch.rooms.find(r=>r.name===seat.room),prefix=`第 ${i+2} 行`;
  if(!s||!s.rooms.includes(seat.room)){errors.push(`${prefix}：考试编号或教室不匹配`);return;}
  if(!room||seat.row>room.rows||seat.column>room.columns){errors.push(`${prefix}：排或列超出教室范围`);return;}
  const key=`${s.date}|${seat.room}|${seat.row}|${seat.column}`,previous=occupied.get(key)||[];
  if(previous.some(p=>p.start<s.end&&s.start<p.end))errors.push(`${prefix}：同一时段座位重复占用`);
  previous.push(s);occupied.set(key,previous);
 });
 return errors.slice(0,100);
}
// Fields students see once published; `changed` flags and timestamps are publication metadata.
export const scheduleKey=b=>JSON.stringify([b.title,b.titleEn,b.start,b.end,b.timeSlots||defaultExamSlots,b.sessions.map(({changed,...s})=>s),b.rooms]);
export const schedule=b=>({id:b.id,title:b.title,titleEn:b.titleEn,start:b.start,end:b.end,timeSlots:b.timeSlots||defaultExamSlots,sessions:b.sessions,rooms:b.rooms,updatedAt:b.updatedAt});
export const divisionNames={primary:'小学部',middle:'初中部',high:'高中部'};
