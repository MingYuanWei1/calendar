import {DurableObject} from 'cloudflare:workers';
import {handleAsNodeRequest} from 'cloudflare:node';
import {createServer} from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createApi} from '../server/api.mjs';
import {database} from './database.mjs';

// Each incoming request retains its school application through async operations.
const applications=new AsyncLocalStorage();
const server=createServer((req,res)=>{
  const {app,address}=applications.getStore();
  req.calendarClientAddress=address;
  app(req,res);
});
server.listen(8080);

export class SchoolCalendar extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    const db=database(ctx.storage);
    db.exec(`CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,username TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,status TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS day_plans(date TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS media_chunks(id TEXT NOT NULL,part INTEGER NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(id,part));
      CREATE TABLE IF NOT EXISTS login_attempts(address TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);`);
    if(!db.prepare('SELECT username FROM admins LIMIT 1').get()&&env.ADMIN_BOOTSTRAP){
      const {username,salt,hash}=JSON.parse(env.ADMIN_BOOTSTRAP);
      db.prepare('INSERT INTO admins VALUES(?,?,?)').run(username,salt,hash);
    }
    const media={
      save:async(id,bytes)=>{
        const stream=()=>new Blob([bytes]).stream();
        const info=await env.IMAGES.info(stream());
        if(!info.width||!info.height||info.width*info.height>40000000)throw new Error('Image too large');
        const image=await env.IMAGES.input(stream()).output({format:'image/webp',quality:88});
        const output=new Uint8Array(await image.response().arrayBuffer());
        if(output.length>10*1024*1024)throw new Error('Encoded image too large');
        db.transactionSync(()=>{
          for(let offset=0,part=0;offset<output.length;offset+=512*1024,part++)
            db.prepare('INSERT INTO media_chunks VALUES(?,?,?)').run(id,part,output.slice(offset,offset+512*1024));
        });
      },
      read:async id=>{
        const rows=db.prepare('SELECT bytes FROM media_chunks WHERE id=? ORDER BY part').all(id);
        return rows.length?Buffer.concat(rows.map(row=>Buffer.from(row.bytes))):null;
      }
    };
    this.application=createApi({db,media,origin:env.APP_ORIGIN,schoolName:env.SCHOOL_NAME||'学校校历',schoolNameEn:env.SCHOOL_NAME_EN||'School calendar',timeZone:env.SCHOOL_TIMEZONE||'Asia/Shanghai',
      sso:{tenantId:env.MICROSOFT_TENANT_ID||'',clientId:env.MICROSOFT_CLIENT_ID||'',clientSecret:env.MICROSOFT_CLIENT_SECRET||''},
      llm:{url:env.LLM_WORKER_URL||'',token:env.LLM_WORKER_TOKEN||''}});
  }
  async handle(request){
    return applications.run({app:this.application.app,address:request.headers.get('CF-Connecting-IP')||'unknown'},()=>handleAsNodeRequest(8080,request));
  }
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
    // One coordination boundary per school: publication, versions, choices, and seats.
    return env.SCHOOLS.getByName(env.SCHOOL_ID||'calendar').handle(request);
  }
};
