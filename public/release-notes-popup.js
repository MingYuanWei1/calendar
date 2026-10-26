import {showReleaseNotes} from './release-notes.mjs';
// Shows unread 更新说明 once the page has no other dialog open; confirming marks them read for this
// account and browser. If the confirmation cannot be saved, they simply show again next visit.
async function start(){
 const response=await fetch('/api/release-notes',{credentials:'same-origin'});
 if(!response.ok)return;
 const notes=await response.json();
 if(!notes.length)return;
 if(document.querySelector('dialog[open]'))await new Promise(resolve=>{
  const wait=()=>queueMicrotask(()=>{if(document.querySelector('dialog[open]'))return;document.removeEventListener('close',wait,true);resolve();});
  document.addEventListener('close',wait,true);
 });
 await showReleaseNotes(notes);
 await fetch('/api/release-notes/read',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:notes.map(note=>note.id)})}).catch(()=>{});
}
start().catch(()=>{});
