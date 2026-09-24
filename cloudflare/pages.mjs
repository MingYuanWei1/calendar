import {pageRole} from '../server/page-access.mjs';
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/'))return env.CALENDAR_API.fetch(request);
    if(!pageRole(url))return env.ASSETS.fetch(request);
    const headers={'Cache-Control':'no-store'};
    try{
      const check=new URL('/api/page-access',url.origin);
      check.searchParams.set('path',url.pathname+url.search);
      const access=await env.CALENDAR_API.fetch(new Request(check,{headers:{Cookie:request.headers.get('Cookie')||''}}));
      if(access.status!==204)return new Response(null,{status:access.status>=400?access.status:503,headers});
      const asset=await env.ASSETS.fetch(request);
      const response=new Response(asset.body,asset);
      response.headers.set('Cache-Control','no-store');
      return response;
    }catch{return new Response(null,{status:503,headers});}
  }
};
