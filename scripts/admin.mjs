import {resolve,join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {openStore,setAdminPassword} from '../server/store.mjs';
const directory=resolve(process.env.DATA_DIR||'.data'),username=process.env.ADMIN_USERNAME||'admin';
const generate=process.argv.includes('--generate');
const password=generate?randomBytes(24).toString('base64url'):process.env.ADMIN_PASSWORD;
if(!password)throw new Error('Set ADMIN_PASSWORD (12+ characters), or pass --generate to save random credentials locally.');
const db=openStore(directory);
try{
  await setAdminPassword(db,username,password);
  if(generate){
    const path=join(directory,'admin-login.txt');
    writeFileSync(path,`管理员账号：${username}\n管理员密码：${password}\n\n仅在本机保存，请妥善保管。重新运行 admin:create 会重置密码并注销已有会话。\n`,{mode:0o600});
    console.log(`Administrator initialized. Credentials saved to ${path}`);
  }else console.log('Administrator password set; existing sessions revoked.');
}finally{db.close();}
