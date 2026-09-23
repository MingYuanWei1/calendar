import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
export {digest,setAdminPassword,verifyPassword} from './passwords.mjs';
export function openStore(directory){
  mkdirSync(directory,{recursive:true,mode:0o700});
  const path=join(directory,'calendar.sqlite');
  const db=new DatabaseSync(path);chmodSync(path,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,username TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,status TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS day_plans(date TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts(address TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);`);
  db.transactionSync=callback=>{db.exec('BEGIN IMMEDIATE');try{const result=callback();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  return db;
}
