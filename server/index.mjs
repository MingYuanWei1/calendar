import {resolve} from 'node:path';
import {createApplication} from './app.mjs';
const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
const origin=process.env.APP_ORIGIN||`http://localhost:${port}`;
if(process.env.NODE_ENV==='production'&&!origin.startsWith('https://'))throw new Error('Production requires an HTTPS APP_ORIGIN and TLS reverse proxy.');
const application=createApplication({dataDir:resolve(process.env.DATA_DIR||'.data'),origin,schoolName:process.env.SCHOOL_NAME||'学校校历',schoolNameEn:process.env.SCHOOL_NAME_EN||'School calendar',timeZone:process.env.SCHOOL_TIMEZONE||'Asia/Shanghai',trustProxy:process.env.TRUST_PROXY||'',sso:{tenantId:process.env.MICROSOFT_TENANT_ID||'',clientId:process.env.MICROSOFT_CLIENT_ID||'',clientSecret:process.env.MICROSOFT_CLIENT_SECRET||''}});
const server=application.app.listen(port,host,()=>console.log(`School calendar listening at ${origin}`));
server.on('error',error=>{console.error(error.message);process.exitCode=1;application.close();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{application.close();process.exit(0);}));
