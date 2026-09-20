import {examSlotRows} from './exam-times.mjs';
export function roomSlotExams(batch,exam,room){
 const sessions=batch.sessions.filter(s=>s.date===exam.date&&s.rooms.includes(room));
 return examSlotRows(batch.timeSlots,sessions).find(row=>row.sessions.some(s=>s.id===exam.id))?.sessions||[];
}
export function moveSeat(batch,index,row,column,examIds=null){
 const seat=batch.seats[index],exam=seat&&batch.sessions.find(s=>s.id===seat.examId),room=seat&&batch.rooms.find(r=>r.name===seat.room);
 if(!exam||!room||!Number.isInteger(row)||!Number.isInteger(column)||row<1||row>room.rows||column<1||column>room.columns)throw new Error('目标座位无效');
 if(seat.row===row&&seat.column===column)return false;
 const eligible=examIds||[seat.examId];
 const target=batch.seats.find(s=>s.room===seat.room&&eligible.includes(s.examId)&&s.row===row&&s.column===column);
 const occupied=(moving,r,c)=>{const source=batch.sessions.find(e=>e.id===moving.examId);return batch.seats.some(s=>s!==seat&&s!==target&&s.room===moving.room&&s.row===r&&s.column===c&&batch.sessions.some(e=>e.id===s.examId&&e.date===source.date&&e.start<source.end&&source.start<e.end));};
 if(occupied(seat,row,column)||(target&&occupied(target,seat.row,seat.column)))throw new Error('该座位已被同一时间的其他考试占用，请选择其他位置。');
 if(target){target.row=seat.row;target.column=seat.column;}
 seat.row=row;seat.column=column;return true;
}
