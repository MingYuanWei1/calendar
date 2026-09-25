// Shared by the Node server and the Pages asset gateway, including clean HTML URLs.
export function pageRole(url){
 let path;
 try{
  const segments=[];
  for(const part of decodeURIComponent(url.pathname).replaceAll('\\','/').split('/')){
   if(part==='..')segments.pop();else if(part&&part!=='.')segments.push(part);
  }
  path=segments.length?'/'+segments.join('/').toLowerCase():'';
 }catch{return 3;}
  if(['/console','/console.html','/students','/students.html'].includes(path))return 2;
 return 0;
}
