// Upload only build assets using the short-lived token issued by Cloudflare MCP.
import {readFile,readdir} from 'node:fs/promises';
const {jwt}=JSON.parse(await readFile('.scratch/cf-upload/token.json','utf8'));
const files=(await readdir('.scratch/cf-upload')).filter(n=>/^batch-\d+\.json$/.test(n));
for(let offset=0;offset<files.length;offset+=3){
 await Promise.all(files.slice(offset,offset+3).map(async name=>{
  const response=await fetch('https://api.cloudflare.com/client/v4/pages/assets/upload',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:await readFile('.scratch/cf-upload/'+name,'utf8')});
  const result=await response.json();
  if(!response.ok||!result.success)throw new Error(name+': '+JSON.stringify(result.errors));
  console.log('Uploaded '+name);
 }));
}
console.log('All Pages assets uploaded.');
