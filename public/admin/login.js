// Password accounts sign in here; the public pages only offer Microsoft sign-in.
document.getElementById('admin-login-form').onsubmit=async event=>{
 event.preventDefault();
 const form=/** @type {HTMLFormElement} */(event.target),button=/** @type {HTMLButtonElement} */(document.getElementById('admin-login-submit')),error=document.getElementById('admin-login-error');
 button.disabled=true;error.textContent='';
 try{
  const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'登录失败，请重试。');
  location.href='/console.html';
 }catch(e){error.textContent=e.message;}
 finally{button.disabled=false;}
};
