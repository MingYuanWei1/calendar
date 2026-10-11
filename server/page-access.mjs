// Shared by the Node server and the Pages asset gateway, including clean HTML URLs.
function pagePath(url){
 try{
  const segments=[];
  for(const part of decodeURIComponent(url.pathname).replaceAll('\\','/').split('/')){
   if(part==='..')segments.pop();else if(part&&part!=='.')segments.push(part);
  }
  return segments.length?'/'+segments.join('/').toLowerCase():'';
 }catch{return null;}
}
export function pageRole(url){
 const path=pagePath(url);
 if(path===null)return 3;
 if(['/console','/console.html'].includes(path))return 2;
 return 0;
}
/** Retired pages that now live inside the console. */
export function pageRedirect(url){
 return ['/students','/students.html'].includes(pagePath(url))?'/console.html#students':null;
}
