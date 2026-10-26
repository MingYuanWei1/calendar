// 更新说明 dialog, shared by the student pages and the console preview so both look the same.
// It shows Chinese then English, so no one needs to switch the page language to read it.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Plain text to HTML: blank lines split paragraphs, lines starting with "- " become a list. */
export function noteBody(text){
 const blocks=[];
 for(const line of String(text||'').split(/\r?\n/)){
  const item=/^\s*[-•]\s+(.*)$/.exec(line),last=blocks.at(-1);
  if(item){if(last?.list)last.lines.push(item[1]);else blocks.push({list:true,lines:[item[1]]});}
  else if(!line.trim())blocks.push({gap:true});
  else if(last&&!last.list&&!last.gap)last.lines.push(line);
  else blocks.push({lines:[line]});
 }
 return blocks.filter(block=>!block.gap).map(block=>block.list?`<ul>${block.lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:`<p>${block.lines.map(esc).join('<br>')}</p>`).join('');
}

/**
 * Opens the dialog for notes ({release, zh, en, date}), newest first, and resolves once the reader
 * presses 我知道了 or Escape. Only one is open at a time.
 */
export function showReleaseNotes(notes){
 document.getElementById('release-notes')?.remove();
 const dialog=document.createElement('dialog');
 dialog.id='release-notes';dialog.className='release-notes';dialog.setAttribute('aria-labelledby','release-notes-title');
 dialog.innerHTML=`<h2 id="release-notes-title">更新说明 <span lang="en">What’s new</span></h2>
 <div class="release-notes-list">${notes.map(note=>`<article><h3>Release ${esc(note.release)}${note.date?` <span>· ${esc(note.date)}</span>`:''}</h3><div lang="zh-CN">${noteBody(note.zh)}</div>${note.en?.trim()?`<div lang="en">${noteBody(note.en)}</div>`:''}</article>`).join('')}</div>
 <button type="button" class="release-notes-ok">我知道了 <span lang="en">Got it</span></button>`;
 document.body.append(dialog);
 return new Promise(resolve=>{
  const done=()=>{if(!dialog.isConnected)return;dialog.close();dialog.remove();resolve();};
  dialog.querySelector('button').onclick=done;
  dialog.oncancel=event=>{event.preventDefault();done();};
  dialog.showModal();
 });
}
