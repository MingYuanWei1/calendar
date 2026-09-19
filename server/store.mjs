import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function openStore(directory){
  mkdirSync(directory,{recursive:true,mode:0o700});
  const path=join(directory,'calendar.sqlite');
  const db=new DatabaseSync(path);chmodSync(path,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,username TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,status TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts(address TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);`);
  return db;
}
export async function setAdminPassword(db,username,password){
  if(!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)||password.length<12||password.length>256)throw new Error('Username must be 3–64 ASCII letters/digits/_.- and password 12–256 characters.');
  const salt=randomBytes(16).toString('hex');
  const hash=Buffer.from(await scrypt(password,salt,64)).toString('hex');
  db.prepare('INSERT OR REPLACE INTO admins VALUES(?,?,?)').run(username,salt,hash);
  db.prepare('DELETE FROM sessions WHERE username=?').run(username);
}
export async function verifyPassword(db,username,password){
  const account=db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  const actual=Buffer.from(await scrypt(password,account?.salt||'nonexistent-account',64));
  return timingSafeEqual(actual,Buffer.from(account?.hash||'00'.repeat(64),'hex'))&&Boolean(account);
}
