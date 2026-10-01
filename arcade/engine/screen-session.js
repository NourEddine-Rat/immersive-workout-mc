// One shared request establishes the HttpOnly screen cookie before any PC sockets open.
let pending, value, checkedAt=0;
export async function screenSession(refresh=false){
  if(pending)return pending;
  if(!refresh&&value&&Date.now()-checkedAt<3000)return value;
  pending=(async()=>{
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
    try{
      const response=await fetch('/where',{cache:'no-store',credentials:'same-origin',signal:abort.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'The connection service is unavailable. Please retry.');
      // This also detects disabled cookies before entering a reconnect loop.
      const check=await fetch('/screen-check',{cache:'no-store',credentials:'same-origin',signal:abort.signal});
      if(!check.ok)throw new Error('Allow cookies for this site, then reload to connect your phone.');
      value=data;checkedAt=Date.now();return data;
    }catch(error){value=null;throw error;}
    finally{clearTimeout(timer);pending=null;}
  })();
  return pending;
}
