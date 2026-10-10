export function roomExamsAt(batch,exam,room,point){
 return batch.sessions.filter(s=>!s.cancelled&&s.date===exam.date&&s.rooms.includes(room)&&s.start<=point&&point<s.end);
}
export function seatViewTimes(batch,exam,room){
 const times=new Set([exam.start]);
 for(const s of batch.sessions){
  if(s.cancelled||s.date!==exam.date||!s.rooms.includes(room))continue;
  for(const time of [s.start,s.end])if(exam.start<time&&time<exam.end)times.add(time);
 }
 return [...times].sort();
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
export const ROOM_MAX=40;
/**
 * Grows rooms so every seat fits: a seating sheet may hold more rows or columns than the room was set up with
 * (rooms from session extraction start at 5 × 5). Rooms only grow, never shrink, and each grown room is flagged
 * `sizeReview` until an administrator confirms it. Sizes beyond ROOM_MAX stay as they are, so seatErrors reports them.
 */
export function adaptRooms(batch,seats=batch.seats){
 const changes=[];
 const rooms=batch.rooms.map(room=>{
  const own=seats.filter(s=>s.room===room.name);
  const rows=Math.max(room.rows,...own.map(s=>s.row)),columns=Math.max(room.columns,...own.map(s=>s.column));
  if((rows===room.rows&&columns===room.columns)||rows>ROOM_MAX||columns>ROOM_MAX)return room;
  changes.push({name:room.name,from:{rows:room.rows,columns:room.columns},to:{rows,columns}});
  return {...room,rows,columns,sizeReview:true};
 });
 return {rooms,changes};
}
