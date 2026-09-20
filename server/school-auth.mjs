import {randomBytes,createHash} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {digest} from './store.mjs';
export async function verifySchoolIdentity(token,keys,{issuer,clientId,tenantId,nonce}){
 const {payload}=await jwtVerify(token,keys,{issuer,audience:clientId,algorithms:['RS256'],requiredClaims:['exp','iat','nonce','tid','oid']});
 if(payload.tid!==tenantId||payload.nonce!==nonce||typeof payload.oid!=='string')throw new Error('Identity mismatch');
 return payload;
}
export function installSchoolAuth(app,db,{origin,tenantId='',clientId='',clientSecret=''}){
 tenantId=tenantId.toLowerCase();
 db.exec(`CREATE TABLE IF NOT EXISTS school_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS school_auth_states(state TEXT PRIMARY KEY,binding TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);`);
 const configured=/^[a-f0-9-]{36}$/i.test(tenantId)&&!!clientId&&!!clientSecret;
 const secure=origin.startsWith('https:'),cookie={httpOnly:true,secure,sameSite:'lax',path:'/'};
 const readCookie=(req,name)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
 const user=req=>db.prepare('SELECT user_id AS id,name FROM school_sessions WHERE token=? AND expires>?').get(digest(readCookie(req,'school_session')),Date.now());
 const issuer=`https://login.microsoftonline.com/${tenantId}/v2.0`;
 const keys=configured?createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)):null;
 app.get('/api/school/session',(req,res)=>res.json({configured,user:user(req)||null}));
 app.get('/api/school/login',(req,res)=>{
  if(!configured)return res.redirect('/exams.html?auth=unconfigured');
  const random=()=>randomBytes(32).toString('base64url'),state=random(),binding=random(),nonce=random(),verifier=random();
  db.prepare('DELETE FROM school_auth_states WHERE expires<?').run(Date.now());db.prepare('DELETE FROM school_sessions WHERE expires<?').run(Date.now());
  db.prepare('INSERT INTO school_auth_states VALUES(?,?,?,?,?)').run(digest(state),digest(binding),nonce,verifier,Date.now()+600000);
  res.cookie('school_auth',binding,{...cookie,maxAge:600000});
  const params=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:origin+'/api/school/callback',response_mode:'query',scope:'openid profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`);
 });
 app.get('/api/school/callback',async(req,res)=>{
  res.clearCookie('school_auth',cookie);
  const state=typeof req.query.state==='string'?req.query.state:'';
  const flow=db.prepare('SELECT * FROM school_auth_states WHERE state=? AND binding=? AND expires>?').get(digest(state),digest(readCookie(req,'school_auth')),Date.now());
  if(!configured||!flow||typeof req.query.code!=='string')return res.redirect('/exams.html?auth=failed');
  db.prepare('DELETE FROM school_auth_states WHERE state=?').run(digest(state));
  try{
   const response=await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'authorization_code',code:req.query.code,redirect_uri:origin+'/api/school/callback',code_verifier:flow.verifier}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('Token exchange failed');
   const token=await response.json();
   const payload=await verifySchoolIdentity(token.id_token,keys,{issuer,clientId,tenantId,nonce:flow.nonce});
   const session=randomBytes(32).toString('hex');
   db.prepare('DELETE FROM school_sessions WHERE token=?').run(digest(readCookie(req,'school_session')));
   db.prepare('INSERT INTO school_sessions VALUES(?,?,?,?)').run(digest(session),tenantId+':'+payload.oid,String(payload.name||'校内用户').slice(0,160),Date.now()+8*3600000);
   res.cookie('school_session',session,{...cookie,maxAge:8*3600000});res.redirect('/exams.html');
  }catch{res.redirect('/exams.html?auth=failed');}
 });
 app.post('/api/school/logout',(req,res)=>{db.prepare('DELETE FROM school_sessions WHERE token=?').run(digest(readCookie(req,'school_session')));res.clearCookie('school_session',cookie);res.status(204).end();});
 return {user};
}
