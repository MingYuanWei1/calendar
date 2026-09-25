import {resolve} from 'node:path';
import {openStore} from '../server/store.mjs';
import {eventSchema} from '../server/validation.mjs';

// Explicit, repeatable sample import. Existing records (including edited samples) stay intact.
const month=process.argv.find(arg=>arg.startsWith('--month='))?.slice(8)||new Intl.DateTimeFormat('en-CA',{timeZone:process.env.SCHOOL_TIMEZONE||'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
if(!/^\d{4}-\d{2}$/.test(month)||Number(month.slice(5))<1||Number(month.slice(5))>12)throw new Error('Use --month=YYYY-MM');
const [year,monthNumber]=month.split('-').map(Number);
const date=day=>`${month}-${String(Math.min(day,new Date(year,monthNumber,0).getDate())).padStart(2,'0')}`;
const nextMonth=monthNumber===12?`${year+1}-01`:`${year}-${String(monthNumber+1).padStart(2,'0')}`;
const schoolwide=['schoolwide'],primary=['primary'],middle=['middle'],high=['high'];
const samples=[
  ['opening','新学期开学典礼','Opening ceremony','activity',1,schoolwide,'08:30','09:30','学校礼堂','School auditorium','各学部共同参加开学典礼，介绍学期重要安排。'],
  ['library','图书馆阅读分享会','Library reading circle','activity',4,primary,'15:30','16:30','小学部图书馆','Primary library','分享一本喜爱的书，现场设有主题书展。'],
  ['science','科学探索开放日','Science discovery day','activity',8,['primary','middle'],'14:00','16:00','科学实验楼','Science building','面向小学和初中的科学体验活动，请按现场指引参加。'],
  ['debate','英语辩论赛初赛','English debate preliminaries','competition',10,['middle','high'],'15:00','17:00','报告厅','Lecture theatre','参赛队伍提前 20 分钟签到，其他同学可到场观赛。'],
  ['high-exam','高中阶段检测','High school assessment','exam',14,high,null,null,'高中部教学楼','High school building','考试期间保持走廊安静，具体考场以学部通知为准。',{timeMode:'multi',end:date(16)}],
  ['club-due','社团选择截止','Club selection deadline','deadline',18,['middle','high'],'17:00',null,'','','请在截止时刻前通过学校指定渠道完成社团选择。'],
  ['garden','校园自然观察日','Campus nature observation','activity',19,primary,'09:00','10:30','校园生态园','Campus garden','观察植物与昆虫，建议携带水杯和遮阳帽。'],
  ['reading-week','校园阅读周','Campus reading week','activity',21,schoolwide,null,null,'图书馆与各学部阅读区','Library and reading areas','跨日阅读活动，每天开放主题书单和交流区域。',{timeMode:'multi',end:date(27)}],
  ['sports','秋季田径运动会','Autumn athletics meet','competition',22,schoolwide,'08:30','16:30','田径场','Athletics field','因场地安排调整，运动会由原定日期改至本日举行。',{oldDate:date(20),previousSchedule:{start:date(20),time:'08:30',endTime:'16:30',type:'competition'}}],
  ['math','初中数学思维挑战赛','Middle school maths challenge','competition',23,middle,'10:00','11:30','初中部多功能室','Middle school multipurpose room','个人思维挑战与团队协作题，观赛席向本学部开放。'],
  ['makers','创客工作坊','Maker workshop','activity',23,['primary','middle'],'13:00','14:00','创客空间','Maker space','通过纸桥搭建体验结构设计，材料由学校提供。',{registrationUrl:'https://example.org/?sample=maker-workshop'}],
  ['arts','校园艺术节','Campus arts festival','activity',23,schoolwide,'14:00','17:00','学校礼堂与艺术长廊','Auditorium and arts corridor','包含学生作品展、器乐演奏和舞台节目。\n请留意现场分区指引；报名链接仅用于展示入口样式。',{registrationUrl:'https://example.org/?sample=arts-festival'}],
  ['careers','高中生涯探索讲座','High school careers talk','activity',23,high,'15:30','16:30','报告厅','Lecture theatre','了解不同专业方向与学习路径，讲座末尾设交流环节。'],
  ['team-due','校队报名截止','School team registration deadline','deadline',23,['middle','high'],'17:00',null,'','','请核对适用项目与报名要求，截止后统一安排选拔。',{registrationUrl:'https://example.org/?sample=school-team'}],
  ['choir','校园合唱交流会','Campus choir gathering','activity',24,schoolwide,'16:00','17:00','音乐教室','Music room','原计划的合唱交流活动。',{status:'cancelled',cancelled:true,cancelReason:'示例：音乐教室临时维护，本次活动取消。'}],
  ['volunteer','校园志愿服务日','Campus volunteering day','activity',25,['middle','high'],'14:00','16:00','学生服务中心','Student service centre','参与图书整理、校园导览和公共区域维护。'],
  ['primary-exam','小学学习成果展示与测评','Primary learning assessment','exam',28,primary,'09:00','11:00','小学部教学楼','Primary school building','按年级安排学习成果展示与阶段测评。'],
  ['middle-exam','初中阶段检测','Middle school assessment','exam',29,middle,null,null,'初中部教学楼','Middle school building','涵盖阶段学习内容，各科时段以学部通知为准。',{timeMode:'multi',end:date(30)}],
  ['electives','下阶段选课截止','Elective selection deadline','deadline',30,high,'18:00',null,'','','请确认课程选择；本平台仅提供截止提醒，不办理选课。'],
  ['exhibition','跨学科项目成果展','Interdisciplinary project exhibition','activity',28,schoolwide,null,null,'综合楼一层','Main building, ground floor','跨周、跨月成果展，欢迎各学部同学参观。',{timeMode:'multi',end:nextMonth+'-03'}],
  ['english','English Reading Meetup','English Reading Meetup','activity',20,['middle','high'],'14:30','15:30','阅览室','Reading room','English-language reading and discussion. This sample demonstrates fallback when a Chinese translation is absent.',{englishOnly:true}],
  ['next-open','校园开放日','Campus open day','activity',1,schoolwide,'09:00','12:00','学校主入口','Main entrance','下一月份的校园开放活动，可切换月份查看。',{start:nextMonth+'-05'}],
  ['next-final','高中学期学习总结测评','High school end-of-term review','exam',1,high,null,null,'高中部教学楼','High school building','示例测评安排，用于展示后续月份的跨日考试。',{start:nextMonth+'-12',end:nextMonth+'-14',timeMode:'multi'}],
  ['draft-robotics','机器人挑战赛（筹备中）','Robotics challenge — planning','competition',27,['middle','high'],'13:30','16:00','科技中心','Technology centre','尚未发布的筹备草稿，仅管理员可见。',{status:'draft'}],
  ['draft-winter','冬季校园音乐会（筹备中）','Winter campus concert — planning','activity',30,schoolwide,'18:00','20:00','学校礼堂','School auditorium','草稿用于体验后台编辑、预览和发布。',{status:'draft'}]
];
const now=new Date().toISOString();
const records=samples.map(([key,zh,en,type,day,scope,time,endTime,locationZh,locationEn,description,options={}])=>{
  const candidate={title:options.englishOnly?['',`[Sample] ${en}`]:[`[示例] ${zh}`,`[Sample] ${en}`],type,start:date(day),scope,time:time||undefined,endTime:endTime||undefined,timeMode:type==='deadline'?'deadline':time?'timed':'allDay',status:'published',location:[locationZh,locationEn],host:['学校活动中心（示例）','School events office (sample)'],description:[`【虚构示例，仅供界面预览】\n${description}\n所有日期、地点与报名入口均非学校真实通知。`,`Fictional sample for interface preview only. ${en}. Dates, venues and registration links are not official school notices.`],...options};
  const validated=eventSchema.parse(candidate);
  return {...validated,id:`sample-${month}-${key}`,version:1,updatedAt:now,cancelled:options.cancelled||false,...(options.cancelReason?{cancelReason:options.cancelReason}:{}),...(options.oldDate?{oldDate:options.oldDate,previousSchedule:options.previousSchedule}:{})};
});
const db=openStore(resolve(process.env.DATA_DIR||'.data'));
let added=0;
try{
  db.exec('BEGIN IMMEDIATE');
  const insert=db.prepare('INSERT INTO events(id,status,version,body) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING');
  for(const event of records)added+=Number(insert.run(event.id,event.status,event.version,JSON.stringify(event)).changes);
  const dayInsert=db.prepare('INSERT INTO day_plans VALUES(?,?,?) ON CONFLICT(date) DO NOTHING');
  for(const day of [25,26,27])dayInsert.run(date(day),'off',JSON.stringify(['秋季休假 · 示例','Autumn break · Sample']));
  const sunday=Array.from({length:7},(_,i)=>date(19+i)).find(iso=>new Date(iso+'T12:00:00').getDay()===0);
  dayInsert.run(sunday,'school',JSON.stringify(['调休上课 · 示例','Make-up day · Sample']));
  db.exec('COMMIT');
  console.log(JSON.stringify({month,added,alreadyPresent:records.length-added,samples:records.length,public:records.filter(e=>e.status!=='draft').length,drafts:records.filter(e=>e.status==='draft').length}));
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
