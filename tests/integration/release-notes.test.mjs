import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../../server/app.mjs';
import {setAdminPassword} from '../../server/store.mjs';

test('更新说明 pop up once per reader, newest release first, until confirmed or expired',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'calendar-release-notes-'));
  const instance=createApplication({dataDir:directory,origin:'http://calendar.test'});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(r=>server.close(r));instance.close();await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const call=(path,method='GET',body,cookie='')=>fetch(base+path,{method,headers:{Origin:'http://calendar.test','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
  const signIn=async(username,password)=>(await call('/login','POST',{username,password})).headers.get('set-cookie').split(';')[0];
  const unread=async(cookie='')=>(await (await call('/release-notes','GET',null,cookie)).json()).map(n=>n.release);
  const confirm=async(cookie='')=>{const ids=(await (await call('/release-notes','GET',null,cookie)).json()).map(n=>n.id);return call('/release-notes/read','POST',{ids},cookie);};
  await setAdminPassword(instance.db,'admin','release-testing-password');
  const admin=await signIn('admin','release-testing-password');
  for(const [username,role] of [['moderator',2],['reader',1],['other',3]])
    assert.equal((await call('/admin/accounts','POST',{username,password:'release-test-password',name:username,role},admin)).status,201);
  const moderator=await signIn('moderator','release-test-password'),reader=await signIn('reader','release-test-password'),other=await signIn('other','release-test-password');
  const note={release:'0.0.1',zh:'新增考试订阅。',en:'',days:30,status:'published'};

  // Only system admins manage them; the text, release number and showing period are checked.
  assert.equal((await call('/admin/release-notes','POST',note)).status,401);
  assert.equal((await call('/admin/release-notes','POST',note,moderator)).status,403);
  assert.equal((await call('/admin/release-notes','GET',null,moderator)).status,403);
  for(const bad of [{...note,release:'1.0'},{...note,release:'01.0.0'},{...note,zh:'  '},{...note,days:0},{...note,status:'cancelled'}])
    assert.equal((await call('/admin/release-notes','POST',bad,admin)).status,422,JSON.stringify(bad));

  const draft=await (await call('/admin/release-notes','POST',{...note,status:'draft'},admin)).json();
  assert.equal(draft.publishedAt,null);
  assert.deepEqual(await unread(),[]);
  assert.equal((await call('/admin/release-notes','POST',{...note,release:'0.0.1'},admin)).status,422);
  // Publishing starts the showing period; the publisher has already read it.
  const first=await (await call(`/admin/release-notes/${draft.id}`,'PUT',{...note,version:1},admin)).json();
  assert.equal(first.version,2);assert.ok(first.publishedAt);
  assert.deepEqual(await unread(admin),[]);
  assert.deepEqual(await unread(other),['0.0.1']);
  const second=await (await call('/admin/release-notes','POST',{...note,release:'0.0.2',zh:'修复周历。',en:'Week view fixed.'},admin)).json();
  await call('/admin/release-notes','POST',{...note,release:'0.0.10',zh:'第三条'},admin);
  await call('/admin/release-notes','POST',{...note,release:'0.1.0',zh:'第四条'},admin);
  // At most three, newest release first by number, not by text.
  assert.deepEqual(await unread(),['0.1.0','0.0.10','0.0.2']);
  assert.deepEqual((await (await call('/admin/release-notes','GET',null,admin)).json()).map(n=>n.release),['0.1.0','0.0.10','0.0.2','0.0.1']);

  // A signed-out visitor gets a cookie on confirming, and then sees only what is left.
  const read=await confirm();assert.equal(read.status,204);
  const cookie=read.headers.get('set-cookie');assert.match(cookie,/release_reader=.+HttpOnly/i);assert.match(cookie,/SameSite=Lax/i);
  const visitor=cookie.split(';')[0];
  assert.deepEqual(await unread(visitor),['0.0.1']);
  assert.deepEqual(await unread(),['0.1.0','0.0.10','0.0.2']);
  // Signing in keeps what the visitor cookie has read; confirming while signed in also marks the account.
  assert.deepEqual(await unread(`${visitor}; ${reader}`),['0.0.1']);
  const both=await confirm(`${visitor}; ${reader}`);assert.equal(both.headers.get('set-cookie'),null);
  assert.deepEqual(await unread(visitor),[]);
  // The account has read only what it confirmed itself, so it sees the three notes the cookie read before sign-in.
  assert.deepEqual(await unread(reader),['0.1.0','0.0.10','0.0.2']);
  assert.equal((await call('/release-notes/read','POST',{ids:[]})).status,422);

  // Editing a published note leaves it read, unless 重新提醒 asks everyone again.
  const fixed=await (await call(`/admin/release-notes/${second.id}`,'PUT',{...note,release:'0.0.2',zh:'修复周历显示。',version:1},admin)).json();
  assert.equal(fixed.publishedAt,second.publishedAt);
  assert.deepEqual(await unread(visitor),[]);
  assert.equal((await call(`/admin/release-notes/${second.id}`,'PUT',{...note,release:'0.0.2',version:1},admin)).status,409);
  assert.equal((await call(`/admin/release-notes/${second.id}`,'PUT',{...note,release:'0.0.1',version:2},admin)).status,422);
  await call(`/admin/release-notes/${second.id}`,'PUT',{...note,release:'0.0.2',renotify:true,version:2},admin);
  assert.deepEqual(await unread(visitor),['0.0.2']);
  assert.deepEqual(await unread(admin),[]);
  // Withdrawn notes stop showing and keep their reads.
  await call(`/admin/release-notes/${second.id}`,'PUT',{...note,release:'0.0.2',status:'draft',version:3},admin);
  assert.deepEqual(await unread(visitor),[]);
  assert.equal((await call('/release-notes/read','POST',{ids:[second.id]},`${visitor}`)).status,204);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM release_note_reads WHERE note_id=?').get(second.id).n,1);

  // Once the showing period ends the note stops showing and its reads go.
  instance.db.prepare('UPDATE release_notes SET published_at=published_at-31*86400000 WHERE id=?').run(first.id);
  assert.deepEqual(await unread(other),['0.1.0','0.0.10']);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM release_note_reads WHERE note_id=?').get(first.id).n,0);
  assert.equal((await call(`/admin/release-notes/${second.id}`,'DELETE',null,moderator)).status,403);
  assert.equal((await call(`/admin/release-notes/${second.id}`,'DELETE',null,admin)).status,204);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM release_note_reads WHERE note_id=?').get(second.id).n,0);
});
