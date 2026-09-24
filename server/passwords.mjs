import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const digest=value=>createHash('sha256').update(value).digest('hex');
export async function passwordCredentials(username,password){
  if(!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)||password.length<12||password.length>256)throw new Error('Username must be 3–64 ASCII letters/digits/_.- and password 12–256 characters.');
  const salt=randomBytes(16).toString('hex');
  const hash=Buffer.from(await scrypt(password,salt,64)).toString('hex');
  return [username,salt,hash];
}
export async function setAdminPassword(db,username,password){
  const credentials=await passwordCredentials(username,password);
  db.prepare('INSERT OR REPLACE INTO admins VALUES(?,?,?)').run(...credentials);
  db.prepare('DELETE FROM sessions WHERE username=?').run(username);
}
export async function verifyPassword(db,username,password){
  const account=db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  const actual=Buffer.from(await scrypt(password,account?.salt||'nonexistent-account',64));
  return timingSafeEqual(actual,Buffer.from(account?.hash||'00'.repeat(64),'hex'))&&Boolean(account);
}
