import {resolve,join} from 'node:path';
import {mkdirSync,chmodSync,existsSync,cpSync} from 'node:fs';
import {openStore} from '../server/store.mjs';
const data=resolve(process.env.DATA_DIR||'.data');
if(!existsSync(join(data,'calendar.sqlite')))throw new Error('Database not found. Start the application first.');
const target=resolve(process.argv[2]||join('backups',new Date().toISOString().replace(/[:.]/g,'-')));
mkdirSync(target,{recursive:true,mode:0o700});
const db=openStore(data);
try{
  db.prepare('VACUUM INTO ?').run(join(target,'calendar.sqlite'));
  chmodSync(join(target,'calendar.sqlite'),0o600);
  if(existsSync(join(data,'media')))cpSync(join(data,'media'),join(target,'media'),{recursive:true,errorOnExist:true,force:false});
  console.log(`Database and media backup created: ${target}`);
}finally{db.close();}
