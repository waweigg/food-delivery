'use strict';
let token='',section='Overview';
const $=s=>document.querySelector(s),content=$('#content'),message=$('#message');
const sections=['Overview','Restaurants','Drivers','Dispatch','Deliveries','Payments','Users'];
function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;}
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',credentials:'omit',headers:{'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});if(r.status===401){token='';$('#workspace').hidden=true;$('#login').hidden=false;throw Error('Session expired. Sign in again.');}const data=await r.json();if(!r.ok)throw Error(typeof data.message==='string'?data.message:'Request failed. Refresh and try again.');return data;}
function button(label,action){const b=el('button',label,'secondary');b.type='button';b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){message.textContent=e.message;message.className='error';}finally{b.disabled=false;}};return b;}
function dialog(title,node){$('#dialog-title').textContent=title;$('#dialog-content').replaceChildren(node);$('#details').showModal();}
function table(headers,rows){const wrap=el('div',null,'table-wrap'),t=el('table'),head=el('tr');for(const h of headers)head.append(el('th',h));const thead=el('thead');thead.append(head);t.append(thead);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const v of row){const td=el('td');td.append(v instanceof Node?v:el('span',v??'—'));tr.append(td);}body.append(tr);}t.append(body);wrap.append(t);return wrap;}
function actions(...buttons){const d=el('div',null,'actions');d.append(...buttons);return d;}
function label(title,sub){const d=el('div',title);if(sub)d.append(el('small',sub));return d;}
function pill(value){return el('span',value,'pill');}
async function mutate(path,body){await api(path,body);await load();message.textContent='Saved successfully.';}
async function load(){
 $('#refresh').disabled=true;message.textContent='';message.className='';content.replaceChildren(el('p','Loading…'));$('#title').textContent=section;$('#subtitle').textContent=section==='Overview'?'Keep good food moving.':'Review and manage your '+section.toLowerCase()+'.';
 for(const b of document.querySelectorAll('nav button')){b.classList.toggle('active',b.textContent===section);b.setAttribute('aria-current',b.textContent===section?'page':'false');}
 try{
 if(section==='Overview'){
  const [r,d,j,p]=await Promise.all([api('/admin/restaurants'),api('/driver-admin'),api('/driver-admin/dispatch'),api('/orders/kitchen-admin/recovery')]);
  const stats=el('div',null,'stats');for(const [name,n] of [['Restaurants',r.length],['Approved drivers',d.filter(x=>x.status==='APPROVED').length],['Dispatch alerts',j.filter(x=>x.issue).length],['Payment reviews',p.length]]){const c=el('div',null,'stat');c.append(el('strong',n),el('span',name));stats.append(c);}
  const panel=el('div',null,'panel');panel.append(el('h2','A taste of Malappuram'),el('p','Three sample restaurants, Kerala dishes and test prices. Customers order in the app; restaurant teams prepare orders and drivers accept pickup offers.'),el('p','Local policy: 5 km coverage, ₹30 delivery, no other charges. Payments are simulated.'));
  content.replaceChildren(stats,panel);return;
 }
 if(section==='Restaurants'){
  const rows=await api('/admin/restaurants');content.replaceChildren(table(['Restaurant','Status','Review'],rows.map(r=>[label(r.name,r.address),pill(r.status),actions(...['APPROVED','SUSPENDED'].map(s=>button(s==='APPROVED'?'Approve':'Suspend',async()=>{const reason=prompt('Reason for this decision');if(reason?.trim())await mutate('/admin/restaurants/'+encodeURIComponent(r.id)+'/decision',{status:s,reason:reason.trim(),version:r.version});})))])));return;
 }
 if(section==='Drivers'){
  const rows=await api('/driver-admin');content.replaceChildren(table(['Driver','Status','Review'],rows.map(d=>[label(d.name,d.vehicle),pill(d.status),actions(...['APPROVED','REJECTED','SUSPENDED'].map(status=>button(status,()=>mutate('/driver-admin/'+encodeURIComponent(d.user_id)+'/review',{status,version:d.version}))))])));return;
 }
 if(section==='Dispatch'){
  const rows=await api('/driver-admin/dispatch');content.replaceChildren(table(['Order / pickup','Status','Attention','Actions'],rows.map(j=>[label(j.order_id.slice(0,8),j.pickup),label(j.state,`${j.attempts} offers · round ${j.round}`),el('span',j.issue||'No issue','issue'),actions(button('Customer resolution',async()=>{const c=await api('/driver-admin/dispatch/'+j.order_id+'/contact');dialog('Customer resolution',el('p',`Order ${j.order_id}\nPhone: ${c.phone||'Unavailable'}\nAgree a wait or escalate cancellation/refund review. Refunds are not issued automatically here.`));}),...(['SEARCHING','NEEDS_ATTENTION'].includes(j.state)?[button('Choose driver',async()=>{const ds=await api('/driver-admin/dispatch/'+j.order_id+'/candidates'),node=el('div');node.append(el('p','Distance is a straight-line estimate, not a road ETA. The driver must accept.'));if(!ds.length)node.append(el('p','No eligible drivers. Contact the customer to agree a wait or review cancellation.'));for(const d of ds)node.append(button(`${d.name} · ${d.distanceMetres} m`,async()=>{await mutate('/driver-admin/dispatch/'+j.order_id+'/manual',{driverId:d.user_id});$('#details').close();}));dialog('Offer to a nearby driver',node);})]:[]))])));return;
 }
 if(section==='Deliveries'){
  const rows=await api('/orders/delivery-admin');content.replaceChildren(el('p','Contact the customer and restaurant before resolving. Confirm delivered only after verified handover. Failed deliveries require payment review; no automatic refund or reassignment.'),table(['Order','State','Issue','Audited exception'],rows.map(o=>[o.id,o.delivery_state,o.issue|| (o.locked_until?'PIN attempts locked':'—'),actions(...['DELIVERED','FAILED'].map(state=>button(state==='DELIVERED'?'Confirm verified delivery':'Close as failed',async()=>{const reason=prompt('Document customer/restaurant verification and reason (minimum 10 characters)');if(reason?.trim())await mutate('/orders/delivery-admin/'+o.id,{state,reason:reason.trim()});})))])));return;
 }
 if(section==='Payments'){
  const rows=await api('/orders/kitchen-admin/recovery');content.replaceChildren(el('p','Review failed captures, rejected orders and expired kitchen tickets. This screen does not execute refunds.'),table(['Order','Status','Reason'],rows.map(r=>[r.order_id,r.status,r.reason])));return;
 }
 const users=await api('/admin/users');content.replaceChildren(table(['Account','Role','Access'],users.map(u=>[label(u.name,u.email),pill(u.role),u.role==='ADMIN'?'Protected admin':button(u.disabled?'Enable':'Disable',()=>mutate('/admin/users/'+encodeURIComponent(u.id)+'/disable',{disabled:!u.disabled}))])));
 }catch(e){content.replaceChildren(el('p','Could not load this view. Use Refresh to retry.'));message.textContent=e.message;message.className='error';}finally{$('#refresh').disabled=false;}
}
for(const name of sections)$('nav').append(button(name,async()=>{section=name;await load();}));
$('#refresh').onclick=load;$('#close-dialog').onclick=()=>$('#details').close();
$('#logout').onclick=async()=>{try{await api('/api/auth/sign-out',{});}finally{token='';content.replaceChildren();$('#workspace').hidden=true;$('#login').hidden=false;}};
$('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;$('#login-error').textContent='';try{const r=await fetch('/api/auth/sign-in/email',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({email:$('#email').value.trim(),password:$('#password').value}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Sign-in failed. Check your email and password.');token=r.headers.get('set-auth-token')||'';if(!token)throw Error('Session could not be established.');const me=await api('/me');if(me.role!=='ADMIN'){await api('/api/auth/sign-out',{});token='';throw Error('Use an admin account here. Other roles use the mobile app.');}$('#password').value='';$('#login').hidden=true;$('#workspace').hidden=false;await load();}catch(e){token='';$('#login-error').textContent=e.message;}finally{b.disabled=false;}};
