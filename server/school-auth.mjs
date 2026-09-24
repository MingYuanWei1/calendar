import {schoolAccount} from './accounts.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {digest} from './passwords.mjs';
export async function verifySchoolIdentity(token,keys,{issuer,clientId,tenantId,nonce}){
 const {payload}=await jwtVerify(token,keys,{issuer,audience:clientId,algorithms:['RS256'],requiredClaims:['exp','iat','nonce','tid','oid']});
 if(payload.tid!==tenantId||payload.nonce!==nonce||typeof payload.oid!=='string')throw new Error('Identity mismatch');
 return payload;
}
// Accept only student pages on this site, never an external redirect destination.
function returnPath(value,origin){
 try{
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//'))return '/';
  const url=new URL(value,origin);
  if(url.origin!==origin||!['/','/index.html','/exams.html','/exams','/exams-admin.html','/accounts.html','/students','/students.html'].includes(url.pathname))return '/';
  url.searchParams.delete('auth');
  return url.pathname+url.search+url.hash;
 }catch{return '/';}
}
function authFailure(path,reason,origin){
 const url=new URL(path,origin);url.searchParams.set('auth',reason);
 return url.pathname+url.search+url.hash;
}
export function installSchoolAuth(app,db,{origin,tenantId='',clientId='',clientSecret='',loginUrl='',preview=false,previewEmail='',localUser=()=>null}){
 if(preview&&(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)))throw new Error('SSO preview is restricted to local development.');
 const localPreview=req=>preview&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&req.get('host')===new URL(origin).host;
 tenantId=tenantId.toLowerCase();
 db.exec(`CREATE TABLE IF NOT EXISTS school_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS school_identity_emails(user_id TEXT PRIMARY KEY,email TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS school_auth_states(state TEXT PRIMARY KEY,binding TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(school_auth_states)').all().some(column=>column.name==='return_to'))db.exec("ALTER TABLE school_auth_states ADD COLUMN return_to TEXT NOT NULL DEFAULT '/'");
 db.exec("INSERT OR IGNORE INTO accounts(id,provider,subject,name,role,created_at) SELECT user_id,'microsoft',user_id,MAX(name),1,strftime('%Y-%m-%dT%H:%M:%SZ','now') FROM school_sessions GROUP BY user_id");
 const configured=/^[a-f0-9-]{36}$/i.test(tenantId)&&!!clientId&&!!clientSecret;
 const secure=origin.startsWith('https:'),cookie={httpOnly:true,secure,sameSite:'lax',path:'/'};
 const readCookie=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
 const identity=req=>localPreview(req)?(readCookie(req,'school_preview_out')==='1'?null:{id:'local-preview-student',name:'体验学生 / Preview student'}):db.prepare('SELECT user_id AS id,name FROM school_sessions WHERE token=? AND expires>?').get(digest(readCookie(req,'school_session')),Date.now());
 const user=req=>{const identityUser=identity(req);if(!identityUser)return null;const account=schoolAccount(db,identityUser.id,identityUser.name);const email=localPreview(req)?previewEmail:db.prepare('SELECT email FROM school_identity_emails WHERE user_id=?').get(account.id)?.email;return account.disabled?null:{id:account.id,name:account.name,role:account.role,email:email||''};};
 const authorizationEndpoint=loginUrl||`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
 const tokenEndpoint=new URL('token',authorizationEndpoint);
 const issuer=`https://login.microsoftonline.com/${tenantId}/v2.0`;
 const keys=configured?createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)):null;
 const requireSignedOut=(req,res,next)=>{if(localUser(req)||user(req))return res.status(409).json({error:'当前已登录，请先退出登录。',code:'ALREADY_AUTHENTICATED'});next();};
 app.get('/api/school/session',(req,res)=>res.json({configured,preview:localPreview(req),user:localUser(req)||user(req)||null}));
 app.get('/api/school/login',requireSignedOut,(req,res)=>{
  const destination=returnPath(req.query.returnTo,origin);
  if(localPreview(req)){res.clearCookie('calendar_session',cookie);res.clearCookie('school_preview_out',cookie);return res.redirect(destination);}
  if(!configured)return res.redirect(authFailure(destination,'unconfigured',origin));
  const random=()=>randomBytes(32).toString('base64url'),state=random(),binding=random(),nonce=random(),verifier=random();
  db.prepare('DELETE FROM school_auth_states WHERE expires<?').run(Date.now());db.prepare('DELETE FROM school_sessions WHERE expires<?').run(Date.now());
  db.prepare('INSERT INTO school_auth_states(state,binding,nonce,verifier,expires,return_to) VALUES(?,?,?,?,?,?)').run(digest(state),digest(binding),nonce,verifier,Date.now()+600000,destination);
  res.cookie('school_auth',binding,{...cookie,maxAge:600000});
  const params=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:origin+'/api/school/callback',response_mode:'query',scope:'openid profile email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  const authorization=new URL(authorizationEndpoint);
  for(const [key,value] of params)authorization.searchParams.set(key,value);
  res.redirect(authorization.href);
 });
 app.get('/api/school/callback',requireSignedOut,async(req,res)=>{
  res.clearCookie('school_auth',cookie);
  const state=typeof req.query.state==='string'?req.query.state:'';
  const flow=db.prepare('SELECT * FROM school_auth_states WHERE state=? AND binding=? AND expires>?').get(digest(state),digest(readCookie(req,'school_auth')),Date.now());
  const destination=returnPath(flow?.return_to,origin);
  if(!configured||!flow||typeof req.query.code!=='string'){
   console.warn({event:'school_login_failed',stage:!configured?'configuration':!flow?'callback_state':'authorization'});
   return res.redirect(authFailure(destination,'failed',origin));
  }
  db.prepare('DELETE FROM school_auth_states WHERE state=?').run(digest(state));
  let stage='token_exchange';
  try{
   const response=await fetch(tokenEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'authorization_code',code:req.query.code,redirect_uri:origin+'/api/school/callback',code_verifier:flow.verifier}),signal:AbortSignal.timeout(15000)});
   if(!response.ok){
    const error=await response.json().catch(()=>({}));
    console.warn({event:'school_login_failed',stage,status:response.status,errorCodes:Array.isArray(error.error_codes)?error.error_codes.filter(Number.isInteger).slice(0,5):[]});
    return res.redirect(authFailure(destination,'failed',origin));
   }
   const token=await response.json();
   stage='identity_verification';
   const payload=await verifySchoolIdentity(token.id_token,keys,{issuer,clientId,tenantId,nonce:flow.nonce});
   stage='session_creation';
   const account=schoolAccount(db,tenantId+':'+payload.oid,String(payload.name||'校内用户').slice(0,160));
   if(account.disabled)return res.redirect(authFailure(destination,'disabled',origin));
   const email=typeof payload.email==='string'?payload.email.trim().toLowerCase():'';
   db.prepare('INSERT INTO school_identity_emails VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email').run(account.id,email);
   const session=randomBytes(32).toString('hex');
   db.prepare('DELETE FROM school_sessions WHERE token=?').run(digest(readCookie(req,'school_session')));
   db.prepare('INSERT INTO school_sessions VALUES(?,?,?,?)').run(digest(session),tenantId+':'+payload.oid,String(payload.name||'校内用户').slice(0,160),Date.now()+8*3600000);
   res.clearCookie('calendar_session',cookie);
   res.cookie('school_session',session,{...cookie,maxAge:8*3600000});res.redirect(destination);
  }catch(error){
   const code=typeof error?.code==='string'&&/^ERR_[A-Z_]+$/.test(error.code)?error.code:'UNCLASSIFIED';
   const claim=['iss','aud','exp','iat','nonce','tid','oid'].includes(error?.claim)?error.claim:undefined;
   console.warn({event:'school_login_failed',stage,code,claim});
   res.redirect(authFailure(destination,'failed',origin));
  }
 });
 const clearSession=(req,res)=>{if(localPreview(req))res.cookie('school_preview_out','1',cookie);db.prepare('DELETE FROM school_sessions WHERE token=?').run(digest(readCookie(req,'school_session')));res.clearCookie('school_session',cookie);};
 const logout=(req,res)=>{clearSession(req,res);res.status(204).end();};
 app.post('/api/school/logout',logout);
 return {user,logout,clearSession,requireSignedOut};
}
