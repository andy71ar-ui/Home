import * as pdfjs from './vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const KEY='hogar-vault-v1', encoder=new TextEncoder(), decoder=new TextDecoder();
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID(), today=()=>new Date().toLocaleDateString('en-CA'), currentTime=()=>new Date().toTimeString().slice(0,5), monthNow=()=>today().slice(0,7), money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:2}).format(Number(n)||0), usd=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(n)||0), number=n=>Number(String(n??'').replace(',','.'))||0;
const defaultCategories=()=>[['servicios','Servicios'],['supermercado','Supermercado'],['hogar','Hogar'],['salud','Salud'],['transporte','Transporte'],['educacion','Educación'],['otros','Otros']].map(([id,name])=>({id:'cat-'+id,name}));
const defaultPayees=()=>[['edenor','Edenor','cat-servicios'],['aysa','AySA','cat-servicios'],['coto','Coto','cat-supermercado']].map(([id,name,categoryId])=>({id:'payee-'+id,name,categoryId}));
const textKey=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-AR').replace(/[^a-z0-9]+/g,' ').trim();
const roundMoney=n=>Math.round((number(n)+Number.EPSILON)*100)/100;
const accountCurrency=a=>a?.currency==='USD'?'USD':'ARS';
const currencyMoney=(n,currency='ARS')=>currency==='USD'?usd(n):money(n);
function prepareDollarAccounts(data){
  data.accounts=(data.accounts||[]).map(a=>({...a,currency:accountCurrency(a),cbu:a.cbu||'',debitLast:a.debitLast||'',usdOpening:number(a.usdOpening)}));
  const pesos=data.accounts.filter(a=>accountCurrency(a)==='ARS');
  const banks=[['nacion','Banco Nación','#2073ad'],['santander','Santander','#db323e'],['icbc','ICBC','#8065b2']];
  const create=(name,key,source,color,bankKey='')=>{
    let id='usd-'+key,i=2;
    while(data.accounts.some(a=>a.id===id))id=`usd-${key}-${i++}`;
    const account={id,name,type:'bank',currency:'USD',opening:0,usdOpening:0,cbu:'',debitLast:'',color:source?.color||color||'#3287a5',arsAccountId:source?.id||'',bankKey};
    data.accounts.push(account);return account;
  };
  for(const [bank,name,color] of banks){
    const candidates=pesos.filter(a=>textKey(a.name).includes(bank));
    const source=candidates.find(a=>textKey(a.name).includes('nuevo'))||candidates.find(a=>!textKey(a.name).includes('viejo'))||candidates[0];
    const existing=data.accounts.find(a=>accountCurrency(a)==='USD'&&(a.bankKey===bank||source&&a.arsAccountId===source.id||textKey(a.name).includes(bank)&&(!a.arsAccountId||!source)));
    if(existing){existing.bankKey=bank;if(source&&!existing.arsAccountId)existing.arsAccountId=source.id}
    else create(name,source?.id||bank,source,color,bank);
  }
  // Move legacy dollar opening balances once, preserving the peso accounts.
  for(const source of pesos.filter(a=>a.usdOpening!==0)){
    const dollar=data.accounts.find(a=>accountCurrency(a)==='USD'&&a.arsAccountId===source.id)||create(source.name,source.id,source);
    dollar.opening=roundMoney(number(dollar.opening)+source.usdOpening);
    source.usdOpening=0;
  }
}
function ensureCategory(data,name,id){
  const key=textKey(name),found=data.expenseCategories.find(c=>textKey(c.name)===key);
  if(found)return found.id;
  let nextId=id,i=2;
  while(data.expenseCategories.some(c=>c.id===nextId))nextId=`${id}-${i++}`;
  data.expenseCategories.push({id:nextId,name});
  return nextId;
}
const normalizeState=data=>{
  prepareDollarAccounts(data);
  if(!Array.isArray(data.expenseCategories))data.expenseCategories=defaultCategories();
  if(!Array.isArray(data.payees))data.payees=defaultPayees();
  if(!Array.isArray(data.payeeMonths))data.payeeMonths=[];
  const incomeYieldCategoryId=ensureCategory(data,'Ingreso - rendimiento','cat-ingreso-rendimiento');
  data.transactions=(data.transactions||[]).map(t=>{
    const tx={...t,time:t.time||'',expenseCategoryId:t.expenseCategoryId||''};
    if(tx.kind==='income'&&textKey(tx.category)==='ingreso rendimiento')tx.expenseCategoryId=incomeYieldCategoryId;
    // Older edits kept the automatic detail from the opposite movement type.
    if((tx.kind==='income'&&textKey(tx.description)==='gasto')||(tx.kind==='expense'&&textKey(tx.description)==='ingreso'))tx.description=tx.kind==='income'?'Ingreso':'Gasto';
    return tx;
  });
  data.accounts=(data.accounts||[]).map(a=>({...a,cbu:a.cbu||'',debitLast:a.debitLast||'',usdOpening:number(a.usdOpening)}));data.cards=(data.cards||[]).map(c=>({...c,active:c.active!==false}));data.charges=(data.charges||[]).map(c=>{const p=installmentParts(c);return {...c,usdAmount:number(c.usdAmount),installmentCurrent:p.current||'',installmentTotal:p.total||'',installmentGroupId:c.installmentGroupId||''}});data.statements=(data.statements||[]).map(s=>({...s,usdAmount:number(s.usdAmount)}));return data};
const initial=()=>normalizeState({version:1,accounts:[['Banco Nación (nuevo)','bank','#2073ad'],['Banco Nación (viejo)','bank','#4987bc'],['Banco Patagonia','bank','#4b8a47'],['Santander','bank','#db323e'],['ICBC','bank','#8065b2'],['Mercado Pago','wallet','#10a5ac'],['Personal Pay','wallet','#2b7789'],['Naranja X','wallet','#ff7942'],['Efectivo','cash','#677d8b']].map(([name,type,color])=>({id:uid(),name,type,color,opening:0})),cards:[],members:['Yo'],transactions:[],charges:[],statements:[],loans:[],bills:[]});
let state=null,secret=null,salt=null,view='inicio',selectedMonth=monthNow(),docDraft=null,noticeTimer=null,homeAmountsVisible=true,txSort={key:'date',dir:'desc'},dueStatusFilter='',storageMode='local',cloud=null,currentUser=null,cloudMirror=null;
const CLOUD_COLLECTIONS=['accounts','expenseCategories','payees','payeeMonths','transactions','cards','charges','statements','loans','bills'];
let payeeStatusFilter='';
const forceLocalMode=location.hostname==='localhost'||location.hostname==='127.0.0.1'?new URLSearchParams(location.search).get('local')==='1':false;
const CLOUD_SESSION_KEY='hogar-cloud-session-started-v1', CLOUD_SESSION_MS=60*60*1000;
let cloudSessionTimer=null;
const enc64=a=>btoa(String.fromCharCode(...new Uint8Array(a))), dec64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function derive(pass,s){let k=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:s,iterations:310000,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function encrypted(data,key,s){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(data)));return {format:'hogar-cifrado',version:1,kdf:'PBKDF2-SHA256',iterations:310000,salt:enc64(s),iv:enc64(iv),data:enc64(cipher)}}
async function unlocked(blob,pass){if(blob?.format!=='hogar-cifrado'||blob?.version!==1||!blob.salt||!blob.iv||!blob.data)throw Error('Archivo de respaldo no reconocido.');const s=dec64(blob.salt),k=await derive(pass,s),bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:dec64(blob.iv)},k,dec64(blob.data));const data=JSON.parse(decoder.decode(bytes));if(!Array.isArray(data.accounts)||!Array.isArray(data.transactions)||!Array.isArray(data.cards))throw Error('Datos no válidos.');return {data:normalizeState(data),key:k,s}}
function stableDoc(x){const o={};for(const k of Object.keys(x||{}).sort())if(x[k]!==undefined)o[k]=x[k];return JSON.stringify(o)}
function cloudSnapshot(data){const snap={};for(const key of CLOUD_COLLECTIONS){snap[key]={};for(const item of data[key]||[])if(item.id)snap[key][item.id]=stableDoc(item)}return snap}
function sameCloudSnapshot(a,b){return JSON.stringify(a||{})===JSON.stringify(b||{})}
async function commitCloudOps(ops){for(let i=0;i<ops.length;i+=450){const batch=cloud.dbApi.writeBatch(cloud.db);for(const op of ops.slice(i,i+450))op.type==='delete'?batch.delete(op.ref):batch.set(op.ref,op.data);await batch.commit()}}
async function loadCloudState(){
  const data={version:1,members:['Yo'],accounts:[],expenseCategories:[],payees:[],transactions:[],cards:[],charges:[],statements:[],loans:[],bills:[]};
  const {collection,doc,getDoc,getDocs}=cloud.dbApi,userId=currentUser.uid;
  let hasData=false;
  const meta=await getDoc(doc(cloud.db,'users',userId,'meta','app'));
  if(meta.exists()){const m=meta.data();data.version=m.version||1;data.members=Array.isArray(m.members)?m.members:data.members;hasData=true}
  for(const key of CLOUD_COLLECTIONS){
    const snap=await getDocs(collection(cloud.db,'users',userId,key));
    data[key]=snap.docs.map(x=>({id:x.id,...x.data()}));
    if(!snap.empty)hasData=true;
  }
  if(!hasData)return null;
  const mirror=cloudSnapshot(data);
  return {data:normalizeState(data),mirror};
}
async function saveCloudState(){
  if(!cloud||!currentUser)throw Error('No hay sesión de Firebase activa.');
  const {collection,doc,serverTimestamp}=cloud.dbApi,userId=currentUser.uid,mirror=cloudMirror||{},ops=[];
  ops.push({type:'set',ref:doc(cloud.db,'users',userId,'meta','app'),data:{version:state.version||1,members:state.members||[],schema:'firestore-v1',updatedAt:serverTimestamp()}});
  for(const key of CLOUD_COLLECTIONS){
    const current={};
    for(const item of state[key]||[]){
      if(!item.id)item.id=uid();
      const value=stableDoc(item),ref=doc(collection(cloud.db,'users',userId,key),item.id);
      current[item.id]=value;
      if(mirror[key]?.[item.id]!==value)ops.push({type:'set',ref,data:JSON.parse(value)});
    }
    for(const id of Object.keys(mirror[key]||{}))if(!current[id])ops.push({type:'delete',ref:doc(collection(cloud.db,'users',userId,key),id)});
  }
  await commitCloudOps(ops);
  cloudMirror=cloudSnapshot(state);
}
async function save(){if(!state)return;if(storageMode==='cloud')return saveCloudState();if(!secret)return;localStorage.setItem(KEY,JSON.stringify(await encrypted(state,secret,salt)))}
function toast(msg){const el=$('#notice');el.textContent=msg;el.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>el.hidden=true,5500)}
function togglePassword(button){
  const input=button.closest('.password-wrap')?.querySelector('input');
  if(!input)return;
  const show=input.type==='password';
  input.type=show?'text':'password';
  button.classList.toggle('is-visible',show);
  button.textContent='👁';
  button.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña');
}
function start(){ $('#auth').hidden=true;$('#app').hidden=false;$('#month').value=selectedMonth; render(); if(storageMode==='local')void save() }
function authMode(){const exists=!!localStorage.getItem(KEY);$('#auth-form').hidden=false;$('#cloud-auth-form').hidden=true;$('#auth-title').textContent=exists?'Bienvenida de nuevo':'Finanzas';$('#auth-help').textContent=exists?'Ingresá tu contraseña para abrir tus datos.':'Creá una contraseña de al menos 8 caracteres para proteger tus datos en esta computadora.';$('#auth-note').textContent='Tus datos se cifran en este navegador. Para usarlos en otra computadora, descargá un respaldo y abrilo allí.';$('#auth-button').textContent=exists?'Abrir mi espacio':'Crear espacio';$('#confirm-wrap').hidden=exists;$('#confirm-password').required=!exists}
function cloudLoadingMode(){storageMode='cloud';$('#auth').hidden=false;$('#app').hidden=true;$('#auth-form').hidden=true;$('#cloud-auth-form').hidden=true;$('#auth-title').textContent='Abriendo tu espacio';$('#auth-help').textContent='Verificando la sesión…';$('#auth-note').textContent='Un momento.'}
function cloudAuthMode(){storageMode='cloud';$('#auth-form').hidden=true;$('#cloud-auth-form').hidden=false;$('#auth-title').textContent='Control del hogar';$('#auth-help').textContent='Ingresá con tu cuenta para sincronizar tus datos en la nube.';$('#auth-note').textContent='Tus datos se guardan en Firebase y quedan disponibles desde otros dispositivos con este mismo usuario.'}
function cloudSessionStarted(){return Number(localStorage.getItem(CLOUD_SESSION_KEY))||0}
function markCloudSession(){localStorage.setItem(CLOUD_SESSION_KEY,String(Date.now()));scheduleCloudSessionExpiry()}
function clearCloudSession(){localStorage.removeItem(CLOUD_SESSION_KEY);clearTimeout(cloudSessionTimer);cloudSessionTimer=null}
function cloudSessionExpired(){const started=cloudSessionStarted();return !!started&&Date.now()-started>CLOUD_SESSION_MS}
function scheduleCloudSessionExpiry(){clearTimeout(cloudSessionTimer);const started=cloudSessionStarted();if(!started)return;const remaining=Math.max(0,CLOUD_SESSION_MS-(Date.now()-started));cloudSessionTimer=setTimeout(async()=>{if(storageMode==='cloud'&&cloud){clearCloudSession();await cloud.authApi.signOut(cloud.auth)}},remaining)}
function setupLocalAuth(){
  authMode();
  $('#auth-form').onsubmit=async e=>{e.preventDefault();const pass=$('#password').value,err=$('#auth-error');err.textContent='';$('#auth-button').disabled=true;try{let raw=localStorage.getItem(KEY);if(raw){const result=await unlocked(JSON.parse(raw),pass);state=result.data;secret=result.key;salt=result.s}else{if(pass!==$('#confirm-password').value)throw Error('Las contraseñas no coinciden.');salt=crypto.getRandomValues(new Uint8Array(16));secret=await derive(pass,salt);state=initial();await save()}start()}catch(ex){err.textContent=ex.name==='OperationError'?'Contraseña incorrecta o archivo dañado.':ex.message}finally{$('#auth-button').disabled=false}};
}
function firebaseConfigReady(settings){const c=settings?.config||{};return !!(settings?.enabled&&c.apiKey&&c.authDomain&&c.projectId&&c.appId)}
async function initFirebaseCloud(){
  try{
    const {firebaseSettings}=await import('./firebase-config.js');
    if(!firebaseConfigReady(firebaseSettings))return null;
    const v=firebaseSettings.sdkVersion||'12.19.0';
    const [appApi,authApi,dbApi]=await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`)
    ]);
    const app=appApi.initializeApp(firebaseSettings.config);
    return {settings:firebaseSettings,authApi,dbApi,auth:authApi.getAuth(app),db:dbApi.getFirestore(app)};
  }catch(ex){console.warn('Firebase no disponible, se usa modo local.',ex);return null}
}
async function openCloudSpace(user){
  currentUser=user;storageMode='cloud';cloudMirror=null;
  const loaded=await loadCloudState();
  state=loaded?.data||initial();
  cloudMirror=loaded?.mirror||null;
  if(!loaded||!sameCloudSnapshot(cloudMirror,cloudSnapshot(state)))await saveCloudState();
  start();
}
function setupCloudAuth(){
  cloudLoadingMode();
  const form=$('#cloud-auth-form'),err=$('#cloud-auth-error'),login=$('#cloud-login-button'),create=$('#cloud-create-button');
  const credentials=()=>({email:$('#cloud-email').value.trim(),password:$('#cloud-password').value});
  form.onsubmit=async e=>{e.preventDefault();err.textContent='';login.disabled=true;create.disabled=true;try{const c=credentials();await cloud.authApi.signInWithEmailAndPassword(cloud.auth,c.email,c.password)}catch(ex){err.textContent='No se pudo entrar: '+(ex.message||ex.code)}finally{login.disabled=false;create.disabled=false}};
  create.onclick=async()=>{err.textContent='';login.disabled=true;create.disabled=true;try{const c=credentials();await cloud.authApi.createUserWithEmailAndPassword(cloud.auth,c.email,c.password)}catch(ex){err.textContent='No se pudo crear la cuenta: '+(ex.message||ex.code)}finally{login.disabled=false;create.disabled=false}};
  cloud.authApi.onAuthStateChanged(cloud.auth,async user=>{
    if(user){
      if(cloudSessionExpired()){clearCloudSession();await cloud.authApi.signOut(cloud.auth);return}
      if(!cloudSessionStarted())markCloudSession();else scheduleCloudSessionExpiry();
      cloudLoadingMode();
      try{await openCloudSpace(user)}catch(ex){err.textContent='No se pudieron cargar los datos: '+(ex.message||ex.code);clearCloudSession();await cloud.authApi.signOut(cloud.auth)}
    }else{state=null;currentUser=null;cloudMirror=null;secret=null;salt=null;clearCloudSession();$('#app').hidden=true;$('#auth').hidden=false;cloudAuthMode()}
  });
}
async function bootAuth(){cloud=forceLocalMode?null:await initFirebaseCloud();if(cloud)setupCloudAuth();else setupLocalAuth()}
bootAuth();
$('#lock').onclick=async()=>{if(storageMode==='cloud'&&cloud){clearCloudSession();await cloud.authApi.signOut(cloud.auth);return}state=null;secret=null;$('#app').hidden=true;$('#auth').hidden=false;$('#password').value='';authMode()};
document.addEventListener('click',e=>{const button=e.target.closest('[data-toggle-password]');if(button)togglePassword(button)});
$('#month').onchange=e=>{selectedMonth=e.target.value||monthNow();render()};$('#add-main').onclick=()=>openTransaction();$('#nav').onclick=e=>{const b=e.target.closest('[data-view]');if(b){view=b.dataset.view;render()}};
const byId=(arr,id)=>arr.find(x=>x.id===id), accountName=id=>byId(state.accounts,id)?.name||'Cuenta eliminada', accountColor=id=>byId(state.accounts,id)?.color||'#087894', cardName=id=>byId(state.cards,id)?.name||'Tarjeta eliminada';
const cashAccount=()=>state.accounts.find(a=>accountCurrency(a)==='ARS'&&a.type==='cash')||state.accounts.find(a=>accountCurrency(a)==='ARS'&&textKey(a.name)==='efectivo');
const currentCurrency=()=>['inicio-usd','movimientos-usd'].includes(view)?'USD':'ARS';
const txCurrency=t=>t.currency==='USD'?'USD':t.currency==='ARS'?'ARS':accountCurrency(byId(state.accounts,t.accountId));
const nameSorter=new Intl.Collator('es-AR',{sensitivity:'base',numeric:true});
const txMonth=t=>t.date?.slice(0,7), inMonth=t=>txMonth(t)===selectedMonth;
function balance(a){return accountBalanceThrough(a)}
function accountDelta(a,m=selectedMonth){return roundMoney(state.transactions.filter(t=>t.accountId===a.id&&txCurrency(t)===accountCurrency(a)&&txMonth(t)===m).reduce((n,t)=>n+(['income','transfer_in'].includes(t.kind)?number(t.amount):-number(t.amount)),0))}
function accountBalanceThrough(a,m=selectedMonth){return roundMoney(number(a.opening)+state.transactions.filter(t=>t.accountId===a.id&&txCurrency(t)===accountCurrency(a)&&txMonth(t)<=m).reduce((n,t)=>n+(['income','transfer_in'].includes(t.kind)?number(t.amount):-number(t.amount)),0))}
function accountDisplayBalance(a,m=selectedMonth){return m>monthNow()?accountDelta(a,m):accountBalanceThrough(a,m)}
const homeMoney=n=>homeAmountsVisible?money(n):'$ --';
const homeUsd=n=>homeAmountsVisible?usd(n):'US$ --';
const amountPair=(ars,usdAmount,empty='—')=>{const a=number(ars),u=number(usdAmount),parts=[];if(a>0)parts.push(money(a));if(u>0)parts.push(usd(u));return parts.join(' + ')||empty};
const homeAmountPair=(ars,usdAmount,empty='—')=>{const a=number(ars),u=number(usdAmount),parts=[];if(a>0)parts.push(homeMoney(a));if(u>0)parts.push(homeUsd(u));return parts.join(' + ')||empty};
const trType=t=>({income:'Ingreso',expense:'Gasto',transfer_out:'Transferencia',transfer_in:'Transferencia recibida',cash_withdrawal:'Extracción',card_payment:'Pago de tarjeta',loan_payment:'Cuota de préstamo'}[t.kind]||t.kind);
function accountOptions(selected='',all=false,showBalance=false,currency='ARS'){return (all?'<option value="">Todas las cuentas</option>':'<option value="">Elegí una cuenta</option>')+state.accounts.filter(a=>accountCurrency(a)===currency).map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)}${showBalance?' · saldo '+currencyMoney(accountBalanceThrough(a,monthNow()),currency):''}</option>`).join('')}
const cardOptions=(selected='',includeInactive=false)=>'<option value="">Elegí una tarjeta</option>'+state.cards.filter(c=>c.active!==false||includeInactive||selected===c.id).map(c=>`<option value="${c.id}" ${selected===c.id?'selected':''}>${esc(c.name)}${c.active===false?' (de baja)':''}</option>`).join('');
const memberOptions=(selected=state.members[0]||'Yo')=>state.members.map(m=>`<option ${selected===m?'selected':''}>${esc(m)}</option>`).join('');
const categoryName=id=>byId(state.expenseCategories,id)?.name||'Sin rubro';
const payeeName=id=>byId(state.payees,id)?.name||'';
const categoryOptions=(selected='')=>'<option value="">Elegí un rubro</option>'+state.expenseCategories.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('');
const payeeOptions=(selected='')=>'<option value="">Otro / sin guardar</option>'+state.payees.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('');
const txCategoryName=t=>t.expenseCategoryId?categoryName(t.expenseCategoryId):(t.category||'');
const cardDisplaySort=(a,b)=>nameSorter.compare(accountName(a.accountId),accountName(b.accountId))||nameSorter.compare(a.name,b.name);
function render(){
  if(!state)return;
  const titles={inicio:'Resumen','inicio-usd':'Resumen dólares',movimientos:'Movimientos','movimientos-usd':'Movimientos dólares',tarjetas:'Tarjetas',vencimientos:'Vencimientos',servicios:'Lugares y servicios',prestamos:'Préstamos',documentos:'Leer documentos',configuracion:'Cuentas, rubros y respaldo'};
  $('#page-title').textContent=titles[view];$('#month').value=selectedMonth;
  $('#add-main').textContent=currentCurrency()==='USD'?'+ Movimiento en dólares':'+ Nuevo movimiento';
  $('#page-currency').textContent=currentCurrency()==='USD'?'DÓLARES · USD':'CONTROL DEL HOGAR';
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#view').innerHTML=({inicio:renderHome,'inicio-usd':renderDollarHome,movimientos:renderTransactions,'movimientos-usd':renderTransactions,tarjetas:renderCards,vencimientos:renderDues,servicios:renderPayeeMonths,prestamos:renderLoans,documentos:renderDocuments,configuracion:renderSettings})[view]();
  cleanBackupControls();wire();
}
const rowsOrEmpty=(html,msg)=>html||`<div class="empty"><strong>Todavía no hay datos</strong>${msg}</div>`;
function expenseSummaryHtml(){
  const totals=new Map();
  for(const t of state.transactions.filter(t=>inMonth(t)&&txCurrency(t)==='ARS'&&t.kind==='expense')){
    const key=t.expenseCategoryId||'sin-rubro';
    totals.set(key,(totals.get(key)||0)+number(t.amount));
  }
  if(!totals.size)return '';
  const rows=[...totals].sort((a,b)=>b[1]-a[1]);
  return `<div class="section-head"><div><h2>Gastos por rubro</h2><p>Gastos pagados desde cuentas en ${formatMonth(selectedMonth)}. Los pagos de tarjeta se muestran aparte.</p></div></div><div class="panel">${rows.map(([id,amount])=>`<div class="list-row"><strong>${esc(id==='sin-rubro'?'Sin rubro':categoryName(id))}</strong><strong>${homeMoney(amount)}</strong></div>`).join('')}</div>`;
}
const validServiceMonth=m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m||'');
function serviceMonthOf(item,dateField='date'){return item.serviceMonth||(item[dateField]||'').slice(0,7)}
function serviceMonthField(item={}){return field('Mes que estás pagando','serviceMonth','month',item.serviceMonth||(item.date||item.due||'').slice(0,7)||selectedMonth,'required')}
function linkedPayeeId(item,nameField='description'){
  if(item.payeeId)return item.payeeId;
  const key=textKey(item[nameField]);if(!key)return '';
  const matches=state.payees.filter(p=>textKey(p.name)===key);
  return matches.length===1?matches[0].id:'';
}

function payeeMonthStatus(payeeId,month=selectedMonth){
  const payments=state.transactions.filter(t=>t.kind==='expense'&&number(t.amount)>0&&linkedPayeeId(t)===payeeId&&serviceMonthOf(t)===month);
  const bills=state.bills.filter(b=>linkedPayeeId(b,'name')===payeeId&&serviceMonthOf(b,'due')===month);
  const manual=state.payeeMonths.find(p=>p.payeeId===payeeId&&p.month===month&&p.paid===true);
  const expenses={ARS:0,USD:0},billed={ARS:0,USD:0};
  for(const t of payments)expenses[txCurrency(t)]+=number(t.amount);
  for(const b of bills)billed[b.currency==='USD'?'USD':'ARS']+=number(b.amount);
  const covered=bills.length>0&&['ARS','USD'].every(c=>roundMoney(expenses[c])>=roundMoney(billed[c]));
  const automatic=bills.length>0?(bills.every(b=>b.paid===true)||covered):payments.length>0;
  const paid=!!manual||automatic;
  const detail=manual&&!automatic?'Confirmado manualmente':automatic?(payments.length?'Pago registrado en Movimientos':'Factura marcada pagada'):payments.length?'Pago parcial registrado':'Sin pago registrado';
  return {payeeId,month,paid,automatic,manual,payments,bills,detail,expenses};
}
function payeeStatusBadge(status){return `<strong class="service-status ${status.paid?'service-paid':'service-unpaid'}">${status.paid?'Pagado':'No pagado'}</strong>`}
function renderPayeeMonths(){
  const all=[...state.payees].sort((a,b)=>nameSorter.compare(a.name,b.name)).map(p=>({payee:p,status:payeeMonthStatus(p.id)}));
  const paid=all.filter(row=>row.status.paid).length,rows=all.filter(row=>!payeeStatusFilter||(payeeStatusFilter==='paid')===row.status.paid);
  const body=rows.map(({payee:p,status:s})=>{
    const dates=[...new Set(s.bills.map(b=>b.due).filter(Boolean))].sort();
    const action=s.automatic?'':s.paid?`<button class="text-button small-action" data-payee-month="${esc(p.id)}" data-month="${selectedMonth}" data-paid="false">Marcar no pagado</button>`:`<button class="secondary small-action" data-payee-month="${esc(p.id)}" data-month="${selectedMonth}" data-paid="true">Marcar pagado</button>`;
    return `<tr><td><strong>${esc(p.name)}</strong><br><small class="muted">${esc(categoryName(p.categoryId))}</small></td><td>${payeeStatusBadge(s)}<br><small class="muted">${esc(s.detail)}</small></td><td>${dates.length?dates.map(formatDate).join('<br>'):'<span class="muted">Sin vencimiento cargado</span>'}</td><td>${s.payments.length?amountPair(s.expenses.ARS,s.expenses.USD):'—'}</td><td class="service-actions">${action}${s.payments.length||s.bills.length?`<button class="text-button small-action" data-payee-records="${esc(p.id)}" data-month="${selectedMonth}">Ver registros</button>`:''}<button class="text-button small-action" data-payee-expense="${esc(p.id)}" data-month="${selectedMonth}">Registrar gasto</button></td></tr>`;
  }).join('');
  return `<div class="section-head"><div><h2>Control de ${formatMonth(selectedMonth)}</h2><p>Todos tus lugares y servicios, tengan o no vencimiento cargado.</p></div><button class="secondary" data-action="new-payee">+ Lugar o servicio</button></div><div class="grid-cards total-grid"><div class="metric"><span>Pagados</span><strong class="positive">${paid}</strong></div><div class="metric"><span>No pagados</span><strong class="negative">${all.length-paid}</strong><small>Sin confirmación de pago en este mes</small></div></div><div class="filters"><button class="secondary small-action" data-payee-shift="-1">‹ Mes anterior</button><button class="secondary small-action" data-payee-shift="1">Mes siguiente ›</button><select id="filter-payee-status" aria-label="Filtrar servicios por estado"><option value="" ${!payeeStatusFilter?'selected':''}>Todos los estados</option><option value="unpaid" ${payeeStatusFilter==='unpaid'?'selected':''}>No pagados</option><option value="paid" ${payeeStatusFilter==='paid'?'selected':''}>Pagados</option></select></div>${all.length?`<div class="table-wrap"><table class="service-table"><thead><tr><th>Lugar o servicio</th><th>Estado del mes</th><th>Vencimiento</th><th>Gastos registrados</th><th>Acciones</th></tr></thead><tbody>${body||'<tr><td colspan="5">No hay servicios con este estado en el mes elegido.</td></tr>'}</tbody></table></div>`:'<div class="empty"><strong>Agregá tus lugares y servicios</strong>Van a aparecer cada mes para que puedas controlar sus pagos.</div>'}<p class="footnote">Pagado se reconoce por los gastos vinculados, las facturas pagadas o una confirmación manual de este mes. No pagado significa que falta registrar o confirmar el pago. Si pagás un mes atrasado, elegí ese período en “Mes que estás pagando”.</p>`;
}
async function setPayeeMonthPaid(payeeId,month,paid){
  if(!byId(state.payees,payeeId)||!validServiceMonth(month)||typeof paid!=='boolean')throw Error('Lugar, mes o estado no válido.');
  const previous=state.payeeMonths;
  const old=previous.find(p=>p.payeeId===payeeId&&p.month===month);
  const item={id:old?.id||`pm-${payeeId}-${month}`,payeeId,month,paid,markedAt:new Date().toISOString(),markedDate:today()};
  state.payeeMonths=[...previous.filter(p=>!(p.payeeId===payeeId&&p.month===month)),item];
  try{await save()}catch(ex){state.payeeMonths=previous;throw ex}
  render();toast(`${paid?'Pagado':'No pagado'} · ${formatMonth(month)}. La marca no modifica los saldos.`);
}
function openPayeeExpense(payeeId,month){
  const payee=byId(state.payees,payeeId);if(!payee||!validServiceMonth(month))return;
  openTransaction({kind:'expense',currency:'ARS',payeeId,expenseCategoryId:payee.categoryId,description:payee.name,serviceMonth:month});
}
function openPayeeMonthRecords(payeeId,month){
  const payee=byId(state.payees,payeeId);if(!payee||!validServiceMonth(month))return;
  const s=payeeMonthStatus(payeeId,month);
  const payments=s.payments.map(t=>`<div class="list-row"><div><strong>${esc(t.description||payee.name)}</strong><small>Movimiento · ${formatDate(t.date)} · ${esc(accountName(t.accountId))}</small></div><div class="right"><strong>${currencyMoney(t.amount,txCurrency(t))}</strong><br><button class="text-button small-action" data-edit-tx="${esc(t.id)}">Editar gasto</button></div></div>`).join('');
  const bills=s.bills.map(b=>`<div class="list-row"><div><strong>${esc(b.name||payee.name)}</strong><small>Factura · ${formatDate(b.due)} · ${b.paid?'Marcada pagada':'Sin confirmar pago'}</small></div><div class="right"><strong>${currencyMoney(b.amount,b.currency||'ARS')}</strong><br><button class="text-button small-action" data-edit-bill="${esc(b.id)}">Editar factura</button></div></div>`).join('');
  modal(`${payee.name} · ${formatMonth(month)}`,`${payeeStatusBadge(s)}<p class="fine">${esc(s.detail)}${s.manual?.markedAt?' · Confirmado el '+formatDate(s.manual.markedDate||s.manual.markedAt.slice(0,10)):''}</p>${payments}${bills}`);
}
function accountCards(currency){
  return state.accounts.filter(a=>accountCurrency(a)===currency).map(a=>{
    const b=accountDisplayBalance(a),delta=accountDelta(a),format=n=>homeAmountsVisible?currencyMoney(n,currency):(currency==='USD'?'US$ --':'$ --');
    const meta=[a.cbu?`CBU/Alias: ${esc(a.cbu)}`:'',a.debitLast?`Débito: **** ${esc(a.debitLast)}`:''].filter(Boolean).join(' · ');
    return `<div class="account-card" style="--accent:${esc(a.color)}"><div class="top"><strong>${esc(a.name)}</strong><small>${currency==='USD'?'USD':a.type==='wallet'?'Billetera':a.type==='cash'?'Efectivo':'Banco'}</small></div><div class="amount ${b<0?'negative':''}">${format(b)}</div><small class="account-detail">Movimiento del mes: ${format(delta)}</small>${meta?`<small class="account-detail">${meta}</small>`:''}${currency==='USD'?`<button class="text-button small-action" data-edit-account="${esc(a.id)}">Editar cuenta y saldo inicial</button>`:''}</div>`;
  }).join('');
}
function recentTransactions(tx,currency){
  const recent=tx.filter(t=>t.kind!=='transfer_in').sort((a,b)=>txDateKey(b).localeCompare(txDateKey(a))).slice(0,6);
  return rowsOrEmpty(recent.map(t=>`<div class="list-row"><div><strong>${esc(t.description||trType(t))}</strong><small>${esc(accountName(t.accountId))} · ${formatDateTime(t)} · ${esc(t.member||'')}</small></div><strong class="right ${t.kind==='income'?'positive':''}">${t.kind==='income'?'+':'−'}${homeAmountsVisible?currencyMoney(t.amount,currency):(currency==='USD'?'US$ --':'$ --')}</strong></div>`).join(''),'Cargá un ingreso, gasto o transferencia para empezar.');
}
function renderHome(){
  const tx=state.transactions.filter(t=>inMonth(t)&&txCurrency(t)==='ARS'),incomes=tx.filter(t=>t.kind==='income').reduce((n,t)=>n+number(t.amount),0),out=tx.filter(t=>['expense','card_payment','loan_payment'].includes(t.kind)).reduce((n,t)=>n+number(t.amount),0),forecast=state.charges.filter(c=>c.month===nextMonth(selectedMonth)).reduce((n,c)=>n+number(c.amount),0),balances=state.accounts.filter(a=>accountCurrency(a)==='ARS').reduce((n,a)=>n+accountDisplayBalance(a),0),future=selectedMonth>monthNow(),dues=dueItems().filter(d=>dueIsPending(d)&&d.amount>0).slice(0,4);
  return `<div class="home-summary ${homeAmountsVisible?'':'amounts-hidden'}"><div class="section-head home-privacy"><button class="secondary small-action" data-toggle-home-amounts="1">${homeAmountsVisible?'Ocultar montos':'Mostrar montos'}</button></div><div class="grid-cards"><div class="metric"><span>${future?'Movimiento neto en cuentas':'Disponible en cuentas'}</span><strong class="${balances<0?'negative':''}">${homeMoney(balances)}</strong><small>${future?'Solo movimientos cargados en este mes':'Saldo al cierre de '+formatMonth(selectedMonth)}</small></div><div class="metric"><span>Ingresos del mes</span><strong class="positive">${homeMoney(incomes)}</strong></div><div class="metric"><span>Salidas del mes</span><strong>${homeMoney(out)}</strong><small>Gastos y pagos desde cuentas</small></div><div class="metric"><span>Tarjetas · mes siguiente</span><strong>${homeMoney(forecast)}</strong><small>Consumos en pesos para ${formatMonth(nextMonth(selectedMonth))}</small></div></div><div class="section-head"><div><h2>Cuentas y billeteras</h2><p>${future?'Movimientos cargados en '+formatMonth(selectedMonth):'Saldo de cada cuenta al cierre de '+formatMonth(selectedMonth)}</p></div><button class="text-button" data-go="configuracion">Administrar</button></div><div class="account-grid">${accountCards('ARS')}</div><div class="two-col"><div><div class="section-head"><h2>Últimos movimientos del mes</h2><button class="text-button" data-go="movimientos">Ver todos</button></div><div class="panel">${recentTransactions(tx,'ARS')}</div></div><div><div class="section-head"><h2>Próximos vencimientos</h2><button class="text-button" data-go="vencimientos">Ver todos</button></div><div class="panel">${rowsOrEmpty(dues.map(d=>`<div class="list-row"><div><strong>${esc(d.name)}</strong><small>${formatDate(d.date)} · ${esc(d.detail)}</small></div><div class="right"><strong>${homeMoney(d.amount)}</strong><br>${dueBadge(d)}</div></div>`).join(''),'No hay vencimientos pendientes en pesos.')}</div></div></div>${expenseSummaryHtml()}</div>`;
}
function renderDollarHome(){
  const tx=state.transactions.filter(t=>inMonth(t)&&txCurrency(t)==='USD'),incomes=tx.filter(t=>t.kind==='income').reduce((n,t)=>n+number(t.amount),0),out=tx.filter(t=>['expense','card_payment'].includes(t.kind)).reduce((n,t)=>n+number(t.amount),0),balances=state.accounts.filter(a=>accountCurrency(a)==='USD').reduce((n,a)=>n+accountDisplayBalance(a),0),future=selectedMonth>monthNow();
  const statements=state.statements.filter(s=>s.month===selectedMonth).map(s=>({...s,due:dueForCard({id:s.cardId},s.month)})).filter(s=>!s.due.carriedForward&&s.due.usdRemaining>0),pending=statements.reduce((n,s)=>n+s.due.usdRemaining,0);
  return `<div class="home-summary dollar-summary"><div class="section-head home-privacy"><button class="secondary small-action" data-toggle-home-amounts="1">${homeAmountsVisible?'Ocultar montos':'Mostrar montos'}</button></div><div class="grid-cards"><div class="metric"><span>${future?'Movimiento neto en dólares':'Disponible en dólares'}</span><strong class="${balances<0?'negative':''}">${homeUsd(balances)}</strong><small>${future?'Solo movimientos cargados en este mes':'Saldo al cierre de '+formatMonth(selectedMonth)}</small></div><div class="metric"><span>Ingresos del mes</span><strong class="positive">${homeUsd(incomes)}</strong></div><div class="metric"><span>Salidas del mes</span><strong>${homeUsd(out)}</strong><small>Gastos y pagos en dólares</small></div><div class="metric"><span>Tarjetas · pendiente del mes</span><strong>${homeUsd(pending)}</strong><small>Parte en dólares de los resúmenes</small></div></div><div class="section-head"><div><h2>Cuentas en dólares</h2><p>Saldos y movimientos en USD de ${formatMonth(selectedMonth)}.</p></div><button class="secondary" data-action="new-usd-account">+ Cuenta en dólares</button></div><div class="account-grid">${accountCards('USD')}</div><div class="two-col"><div><div class="section-head"><h2>Últimos movimientos en dólares</h2><button class="text-button" data-go="movimientos-usd">Ver todos</button></div><div class="panel">${recentTransactions(tx,'USD')}</div></div><div><div class="section-head"><h2>Tarjetas por pagar en dólares</h2><button class="text-button" data-go="tarjetas">Ver tarjetas</button></div><div class="panel">${rowsOrEmpty(statements.map(s=>`<div class="list-row"><div><strong>${esc(cardName(s.cardId))}</strong><small>Resumen de ${formatMonth(s.month)} · ${formatDate(s.due.due)}</small></div><div class="right"><strong>${homeUsd(s.due.usdRemaining)}</strong><br><button class="text-button small-action" data-pay-card="${esc(s.cardId)}" data-currency="USD">Registrar pago en dólares</button></div></div>`).join(''),'No hay dólares pendientes en los resúmenes de este mes.')}</div></div></div></div>`;
}
function renderTransactions(){
  const currency=currentCurrency(),dollars=currency==='USD',arr=state.transactions.filter(t=>inMonth(t)&&txCurrency(t)===currency&&t.kind!=='transfer_in').sort(compareTransactions);
  return `<div class="filters"><button class="primary" data-action="new-transaction">${dollars?'+ Movimiento en dólares':'+ Movimiento'}</button>${dollars?'':'<button class="secondary" data-go="configuracion">Administrar rubros</button>'}<select id="filter-account" aria-label="Filtrar por cuenta">${accountOptions('',true,false,currency)}</select><select id="filter-kind" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="income">Ingresos</option><option value="expense">Gastos</option><option value="transfer_out">Transferencias</option>${dollars?'':'<option value="cash_withdrawal">Extracciones</option>'}<option value="card_payment">Pagos de tarjeta</option>${dollars?'':'<option value="loan_payment">Cuotas de préstamo</option>'}</select><input id="filter-search" type="search" placeholder="Buscar en movimientos" aria-label="Buscar en movimientos"></div><div id="tx-results">${txTable(arr)}</div><p class="footnote">${dollars?'Todos los importes de esta pantalla son en dólares. Los pagos de tarjeta descuentan únicamente la parte en USD del resumen indicado.':'Las transferencias mueven dinero entre cuentas y no se suman a ingresos ni gastos del hogar. Los pagos de tarjeta descuentan el saldo en pesos del resumen indicado.'}</p>`;
}
function txSortButton(key,label){const active=txSort.key===key;return `<button class="sort-head ${active?'active':''}" data-sort-tx="${key}" type="button">${label}<span aria-hidden="true">${active?(txSort.dir==='asc'?'▲':'▼'):'↕'}</span></button>`}
function txDetailText(t){return `${trType(t)} ${['expense','income'].includes(t.kind)?txCategoryName(t):t.category||''} ${t.kind==='expense'?payeeName(t.payeeId):''} ${['transfer_out','cash_withdrawal'].includes(t.kind)?accountName(t.toAccountId):''} ${t.cardId?`${cardName(t.cardId)} ${t.statementMonth||''}`:''} ${t.loanId?(byId(state.loans,t.loanId)?.name||''):''}`}
function txSearchText(t){return [formatDateTime(t),t.date,t.time,t.description,trType(t),accountName(t.accountId),txDetailText(t),t.member,currencyMoney(t.amount,txCurrency(t)),String(t.amount)].join(' ').toLocaleLowerCase('es-AR')}
function txStamp(t){return `${t.date||''}T${t.time||'00:00'}`}function txOrderIndex(t){const i=state.transactions.indexOf(t);return String(i<0?0:i).padStart(8,'0')}function txDateKey(t){return `${txStamp(t)}#${txOrderIndex(t)}`}function txSortValue(t,key){return key==='date'?txDateKey(t):key==='description'?(t.description||trType(t)):key==='account'?accountName(t.accountId):key==='kind'?txDetailText(t):key==='member'?(t.member||''):key==='amount'?number(t.amount):''}
function compareTransactions(a,b){const av=txSortValue(a,txSort.key),bv=txSortValue(b,txSort.key);let result=typeof av==='number'||typeof bv==='number'?number(av)-number(bv):String(av).localeCompare(String(bv),'es-AR',{numeric:true,sensitivity:'base'});if(result===0)result=txDateKey(b).localeCompare(txDateKey(a));return txSort.dir==='asc'?result:-result}
function getTransactionRows(){const acc=$('#filter-account')?.value||'',kind=$('#filter-kind')?.value||'',q=($('#filter-search')?.value||'').trim().toLocaleLowerCase('es-AR');let arr=state.transactions.filter(t=>inMonth(t)&&txCurrency(t)===currentCurrency()&&(t.kind!=='transfer_in'||!!acc));if(acc)arr=arr.filter(t=>t.accountId===acc);if(kind)arr=arr.filter(t=>t.kind===kind);if(q)arr=arr.filter(t=>txSearchText(t).includes(q));return arr.sort(compareTransactions)}
function applyTransactionFilters(){const target=$('#tx-results');if(target)target.innerHTML=txTable(getTransactionRows())}
function txTable(arr){return arr.length?`<div class="table-wrap"><table><thead><tr><th>${txSortButton('date','Fecha')}</th><th>${txSortButton('description','Detalle')}</th><th>${txSortButton('account','Cuenta')}</th><th>${txSortButton('kind','Tipo')}</th><th>${txSortButton('member','Persona')}</th><th class="right">${txSortButton('amount','Importe')}</th><th></th></tr></thead><tbody>${arr.map(t=>{const editId=t.linkedId||t.id,cat=txCategoryName(t);return `<tr><td>${formatDate(t.date)}</td><td><strong>${esc(t.description||trType(t))}</strong>${t.cardId?`<br><small>${esc(cardName(t.cardId))} · ${esc(t.statementMonth||'')}</small>`:''}</td><td>${esc(accountName(t.accountId))}</td><td>${esc(trType(t))}${['expense','income'].includes(t.kind)&&cat?` · ${esc(cat)}`:''}${t.kind==='expense'&&t.payeeId?' · '+esc(payeeName(t.payeeId)):''}${['transfer_out','cash_withdrawal'].includes(t.kind)?` → <span class="transfer-target" style="color:${esc(accountColor(t.toAccountId))}">${esc(accountName(t.toAccountId))}</span>`:''}</td><td>${esc(t.member||'')}</td><td class="right ${['income','transfer_in'].includes(t.kind)?'positive':''}">${['income','transfer_in'].includes(t.kind)?'+':'−'}${currencyMoney(t.amount,txCurrency(t))}</td><td><button class="text-button small-action" data-edit-tx="${editId}">Editar</button>${t.kind==='expense'?`<button class="text-button small-action" data-classify-tx="${t.id}">Clasificar</button>`:''}<button class="text-button small-action" data-delete-tx="${t.id}">Borrar</button></td></tr>`}).join('')}</tbody></table></div>`:`<div class="empty"><strong>Sin movimientos para ${formatMonth(selectedMonth)}</strong>Podés ajustar los filtros, buscar otra palabra o consultar otros meses con el selector de arriba.</div>`}
function nextMonth(m){const [y,mo]=m.split('-').map(Number);return `${y+(mo===12?1:0)}-${String(mo===12?1:mo+1).padStart(2,'0')}`};function addMonths(m,n){let [y,mo]=m.split('-').map(Number),d=new Date(y,mo-1+n,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}function formatMonth(m){if(!/^\d{4}-\d{2}$/.test(m||''))return '—';return new Date(`${m}-01T12:00:00`).toLocaleDateString('es-AR',{month:'long',year:'numeric'})}function formatDate(d){if(!d)return 'Sin fecha';const [y,m,day]=d.split('-');return `${day}/${m}/${y}`}function formatDateTime(t){return `${formatDate(t.date)}${t.time?' '+t.time:''}`}
function installmentParts(x={}){const m=String(x.installment||'').match(/(\d+)\s*(?:de|\/)\s*(\d+)/i);return {current:Math.trunc(Number(x.installmentCurrent)||Number(m?.[1])||0),total:Math.trunc(Number(x.installmentTotal)||Number(m?.[2])||0)}}
function chargeRow(x){return `<div class="list-row"><div><strong>${esc(x.description)}</strong><small>${x.date?formatDate(x.date)+' · ':''}${esc(x.installment||'')}${x.member?' · '+esc(x.member):''}${x.expenseCategoryId?' · '+esc(categoryName(x.expenseCategoryId)):''}</small></div><div class="right"><strong>${amountPair(x.amount,x.usdAmount)}</strong><br><button class="text-button small-action" data-edit-charge="${x.id}">Editar</button> <button class="text-button small-action" data-delete-charge="${x.id}">Borrar</button></div></div>`}
function cardStatement(c,m=selectedMonth){return byId(state.statements.filter(s=>s.month===m),c.id)||null}
function dueForCard(c,m=selectedMonth){
  const s=state.statements.find(s=>s.cardId===c.id&&s.month===m),payments=state.transactions.filter(t=>t.kind==='card_payment'&&t.cardId===c.id&&t.statementMonth===m);
  const paid=roundMoney(payments.filter(t=>txCurrency(t)==='ARS').reduce((n,t)=>n+number(t.amount),0)),usdPaid=roundMoney(payments.filter(t=>txCurrency(t)==='USD').reduce((n,t)=>n+number(t.amount),0)),total=number(s?.amount),usdTotal=number(s?.usdAmount),remaining=roundMoney(total-paid),usdRemaining=roundMoney(usdTotal-usdPaid),carriedForward=s?.carriedForward===true;
  return {total,usdTotal,paid,usdPaid,carriedForward,carriedAmount:carriedForward?Math.max(0,remaining):0,carriedUsdAmount:carriedForward?Math.max(0,usdRemaining):0,remaining:carriedForward?0:remaining,usdRemaining:carriedForward?0:usdRemaining,due:s?.due||''};
}
function openCardPayment(cardId,currency='ARS'){
  const card=byId(state.cards,cardId);if(!card)return;
  const bank=byId(state.accounts,card.accountId),d=dueForCard(card),dollar=state.accounts.find(a=>accountCurrency(a)==='USD'&&a.arsAccountId===card.accountId)||state.accounts.find(a=>accountCurrency(a)==='USD'&&['nacion','santander','icbc'].some(key=>textKey(bank?.name).includes(key)&&textKey(a.name).includes(key)));
  openTransaction({kind:'card_payment',currency,cardId,statementMonth:selectedMonth,accountId:currency==='USD'?dollar?.id||'':card.accountId,amount:Math.max(0,currency==='USD'?d.usdRemaining:d.remaining)||''});
}
function renderCards(){let nm=nextMonth(selectedMonth),statementAll=state.statements.filter(s=>s.month===selectedMonth).reduce((n,s)=>n+number(s.amount),0),statementUsd=state.statements.filter(s=>s.month===selectedMonth).reduce((n,s)=>n+number(s.usdAmount),0),all=state.cards.reduce((a,c)=>a+state.charges.filter(x=>x.cardId===c.id&&x.month===nm).reduce((n,x)=>n+number(x.amount),0),0),allUsd=state.cards.reduce((a,c)=>a+state.charges.filter(x=>x.cardId===c.id&&x.month===nm).reduce((n,x)=>n+number(x.usdAmount),0),0),cards=[...state.cards].sort(cardDisplaySort);return `<div class="section-head"><div><h2>Consumos para ${formatMonth(nm)}</h2><p>La próxima liquidación se estima con los consumos que cargues. El resumen actual se ingresa cuando lo recibís.</p></div><button class="primary" data-action="new-card">+ Tarjeta</button></div><div class="filters"><button class="secondary small-action" data-view-carried-statements="1">Ver lo que pasó al resumen siguiente</button></div><div class="grid-cards total-grid"><div class="metric"><span>Total de resúmenes de ${formatMonth(selectedMonth)}</span><strong>${statementUsd>0?amountPair(statementAll,statementUsd):money(statementAll)}</strong></div><div class="metric"><span>Estimado total del mes siguiente</span><strong>${allUsd>0?amountPair(all,allUsd):money(all)}</strong><small>Consumos para ${formatMonth(nm)}</small></div></div>${cards.length?`<div class="card-grid">${cards.map(c=>{const a=byId(state.accounts,c.accountId),d=dueForCard(c),statement=state.statements.find(s=>s.cardId===c.id&&s.month===selectedMonth),hasStatement=!!statement,closingDate=c.closingDates?.[selectedMonth]||'',charges=state.charges.filter(x=>x.cardId===c.id&&x.month===nm),future=charges.reduce((n,x)=>n+number(x.amount),0),futureUsd=charges.reduce((n,x)=>n+number(x.usdAmount),0);return `<div class="card-tile ${c.active===false?'inactive':''}" style="--accent:${esc(a?.color||'#638da5')}"><div class="heading"><div><h3>${esc(c.name)} ${c.active===false?'<span class="badge">De baja</span>':''}</h3><small class="muted">${esc(a?.name||'Sin banco')}</small></div><button class="text-button small-action" data-edit-card="${c.id}">Editar</button></div><div class="list-row card-closing"><div><small>Cierre del resumen de ${formatMonth(selectedMonth)}</small><strong>${closingDate?formatDate(closingDate):'Sin cargar'}</strong></div><button class="text-button small-action" data-card-closing="${c.id}">${closingDate?'Editar cierre':'Cargar cierre'}</button></div><div class="card-stats"><div><span>Resumen ${formatMonth(selectedMonth)}</span><strong>${hasStatement?amountPair(d.total,d.usdTotal):'Sin cargar'}</strong></div><div><span>Pagado</span><strong>${d.usdPaid>0?amountPair(d.paid,d.usdPaid):money(d.paid)}</strong></div><div><span>Queda por pagar</span><strong class="${d.remaining<0?'positive':''}">${hasStatement&&(d.total>0||d.usdTotal>0||d.paid>0||d.usdPaid>0)?(d.usdRemaining>0?amountPair(d.remaining,d.usdRemaining):money(d.remaining)):'—'}</strong></div></div>${d.carriedForward?`<p class="hint"><strong>Pasó al resumen siguiente</strong><strong class="carried-amount">${amountPair(d.carriedAmount,d.carriedUsdAmount,money(0))}</strong>&ensp;&ensp;Incluido en el resumen de ${formatMonth(nextMonth(statement.month))}.</p>`:''}${charges.slice(0,4).map(chargeRow).join('')}${charges.length?`<button class="text-button small-action" data-view-charges="${c.id}" data-charge-month="${nm}">Ver todos los consumos (${charges.length})</button>`:''}<div class="card-actions">${c.active!==false?`<button class="secondary small-action" data-new-charge="${c.id}">+ Consumo futuro</button>`:''}<button class="secondary small-action" data-statement="${c.id}">Resumen actual</button>${hasStatement?`<button class="text-button small-action" data-delete-statement="${statement.id}">Borrar resumen</button>`:''}${hasStatement&&(d.carriedForward||d.remaining>0||d.usdRemaining>0)?`<button class="secondary small-action" data-carry-statement="${statement.id}">${d.carriedForward?'Deshacer pase':'Pasó al resumen siguiente'}</button>`:''}<button class="secondary small-action" data-pay-card="${c.id}" data-currency="ARS">Registrar pago en pesos</button>${hasStatement&&d.usdRemaining>0&&!d.carriedForward?`<button class="secondary small-action" data-pay-card="${c.id}" data-currency="USD">Registrar pago en dólares</button>`:''}${hasStatement&&!d.carriedForward&&d.remaining<=0&&d.usdRemaining<=0?'<span class="badge paid">Pagado</span>':''}<button class="text-button small-action" data-toggle-card-active="${c.id}">${c.active===false?'Reactivar':'Dar de baja'}</button><div class="action-total"><span>Consumido para ${formatMonth(nm)}</span><strong>${futureUsd>0?amountPair(future,futureUsd):money(future)}</strong></div></div></div>`}).join('')}</div>`:`<div class="empty"><strong>Agregá tus tarjetas</strong>Podés asociar Visa, Master o Amex a un banco y llevar los consumos de cada mes.</div>`}<p class="footnote">Cada pago parcial se registra por separado con su fecha y cuenta de origen. Las fechas de cierre y vencimiento quedan vacías hasta que las confirmes. Las tarjetas dadas de baja conservan su historial.</p>`}
function dueItems(){let list=[];for(const b of state.bills){if(b.due)list.push({id:b.id,kind:'bill',name:b.name,date:b.due,amount:b.amount,usdAmount:0,detail:'Servicio / gasto',paid:b.paid})}for(const s of state.statements){const c=byId(state.cards,s.cardId),d=dueForCard(c||{id:s.cardId},s.month);if(s.due)list.push({id:s.id,kind:'statement',name:c?.name||'Tarjeta',date:s.due,amount:d.remaining,usdAmount:d.usdRemaining,detail:`Resumen ${formatMonth(s.month)}`,carriedForward:d.carriedForward,carriedAmount:d.carriedAmount,carriedUsdAmount:d.carriedUsdAmount,paid:!d.carriedForward&&d.remaining<=0&&d.usdRemaining<=0})}for(const l of state.loans){if(l.due)list.push({id:l.id,kind:'loan',name:l.name,date:l.due,amount:l.installment,usdAmount:0,detail:'Préstamo · próxima cuota',paid:l.paid})}return list.sort((a,b)=>a.date.localeCompare(b.date))}
function dueIsPending(d){return !d.paid&&!d.carriedForward}
function tomorrow(){const d=new Date(`${today()}T12:00:00`);d.setDate(d.getDate()+1);return d.toLocaleDateString('en-CA')}
function dueStatus(d){return d.carriedForward?'carried':d.paid?'paid':d.date<today()?'overdue':'pending'}
function dueStatusOptions(){return [['','Todos'],['pending','Pendientes'],['overdue','Vencidos'],['paid','Pagados'],['carried','Pasaron al resumen siguiente']].map(([v,n])=>`<option value="${v}" ${dueStatusFilter===v?'selected':''}>${n}</option>`).join('')}
function dueFilterEmpty(){return {pending:'No hay vencimientos pendientes en este mes.',overdue:'No hay vencimientos vencidos en este mes.',paid:'No hay vencimientos pagados en este mes.',carried:'No hay resúmenes que hayan pasado al siguiente en este mes.'}[dueStatusFilter]||'Todavía no hay vencimientos cargados en este mes.'}
function dueBadge(d){let cls='',label='Pendiente';if(d.carriedForward){label='Pasó al resumen siguiente'}else if(d.paid){cls='paid';label='Pagado'}else if(d.date<today()){cls='overdue';label='Vencido'}else if(d.date===today()||d.date===tomorrow()){cls='soon'}return `<span class="badge ${cls}">${label}</span>`}
function renderDues(){const due=dueItems(),pending=due.filter(dueIsPending),sum=pending.reduce((n,x)=>n+number(x.amount),0),sumUsd=pending.reduce((n,x)=>n+number(x.usdAmount),0),monthDue=due.filter(d=>d.date.slice(0,7)===selectedMonth),rows=dueStatusFilter?monthDue.filter(d=>dueStatus(d)===dueStatusFilter):monthDue;return `<div class="grid-cards" style="grid-template-columns:repeat(2,minmax(0,1fr));max-width:700px"><div class="metric"><span>Importe pendiente</span><strong>${sumUsd>0?amountPair(sum,sumUsd):money(sum)}</strong></div><div class="metric"><span>Vencimientos pendientes</span><strong>${pending.length}</strong></div></div><div class="section-head"><div><h2>Agenda de pagos</h2><p>Los avisos aparecen al abrir el sitio; podés filtrar por mes desde arriba.</p></div><button class="primary" data-action="new-bill">+ Servicio o gasto</button></div><div class="filters"><select id="filter-due-status" aria-label="Filtrar vencimientos por estado">${dueStatusOptions()}</select></div><div class="panel">${rowsOrEmpty(rows.map(d=>`<div class="list-row"><div><strong>${esc(d.name)}</strong><small>${esc(d.detail)} · ${formatDate(d.date)}</small></div><div class="right"><strong class="${d.carriedForward?'carried-amount':''}">${amountPair(d.carriedForward?d.carriedAmount:d.amount,d.carriedForward?d.carriedUsdAmount:d.usdAmount,money(0))}</strong><br>${dueBadge(d)}${d.kind==='bill'?`<br><button class="text-button small-action" data-toggle-bill="${d.id}">${d.paid?'Marcar pendiente':'Marcar pagado'}</button> <button class="text-button small-action" data-edit-bill="${d.id}">Editar</button> <button class="text-button small-action" data-delete-bill="${d.id}">Borrar</button>`:''}</div></div>`).join(''),dueFilterEmpty())}</div><p class="footnote">El navegador no puede mostrar avisos automáticos cuando el sitio está cerrado. Revisá esta agenda al abrirlo.</p>`}
function renderLoans(){const monthLoans=state.loans.filter(l=>l.due?.slice(0,7)===selectedMonth),monthTotal=monthLoans.reduce((n,l)=>n+number(l.installment),0);return `<div class="section-head"><div><h2>Préstamos</h2><p>Cargá cada préstamo y su próxima cuota. Las cuotas pagadas quedan en Movimientos.</p></div><button class="primary" data-action="new-loan">+ Préstamo</button></div><div class="grid-cards total-grid"><div class="metric"><span>Total de cuotas de ${formatMonth(selectedMonth)}</span><strong>${money(monthTotal)}</strong></div><div class="metric"><span>Cuotas que vencen este mes</span><strong>${monthLoans.length}</strong></div></div>${state.loans.length?`<div class="card-grid">${state.loans.map(l=>`<div class="panel loan-tile" style="--accent:${esc(accountColor(l.accountId))}"><div class="heading"><h3>${esc(l.name)}</h3><small>${esc(accountName(l.accountId))}</small></div><div class="card-stats"><div><span>Próxima cuota</span><strong>${money(l.installment)}</strong></div><div><span>Cuota número</span><strong>${esc(l.current||'—')} / ${esc(l.total||'—')}</strong></div><div><span>Vence</span><strong>${formatDate(l.due)}</strong></div></div><p class="muted" style="font-size:.83rem">${esc(l.member||'')}</p><div class="card-actions"><button class="secondary small-action" data-pay-loan="${l.id}">Registrar pago</button><button class="secondary small-action" data-edit-loan="${l.id}">Editar</button><button class="text-button small-action" data-delete-loan="${l.id}">Borrar</button></div></div>`).join('')}</div>`:`<div class="empty"><strong>No hay préstamos cargados</strong>Podés agregar los préstamos de cada banco o billetera.</div>`}`}
function renderDocuments(){return `<div class="two-col"><div class="panel"><h2>Leer un PDF</h2><p class="muted">Elegí un resumen de tarjeta o una factura de servicios en PDF. Se lee en esta computadora; no se envía a ningún servidor.</p><div class="document-box"><label>Tipo de documento<select id="doc-type"><option value="bill">Factura de servicio</option><option value="card">Resumen de tarjeta</option></select></label><label style="margin-top:1rem">Archivo PDF<input type="file" id="doc-file" accept="application/pdf,.pdf"></label><button class="primary" style="margin-top:1rem" id="read-pdf">Leer documento</button></div><div id="doc-result" style="margin-top:1rem"></div></div><div class="panel"><h2>Revisión antes de guardar</h2><div class="note-list"><div class="hint">Solo se proponen datos reconocidos explícitamente en el texto del PDF. Revisá importes y vencimientos antes de guardarlos.</div><div class="hint">Si el archivo es una imagen escaneada, está protegido o faltan datos, aparece “No se pudo leer”. Podés cargarlos manualmente.</div><div class="hint">El PDF no se guarda en el sitio ni en el respaldo. Solo se conservan los datos que confirmes.</div></div></div></div>`}
function renderSettings(){return `<div class="two-col"><div class="stack"><div class="panel setting-section"><div class="section-head" style="margin:0 0 1rem"><h2>Bancos y billeteras · pesos</h2><button class="secondary" data-action="new-account">+ Cuenta</button></div>${state.accounts.filter(a=>accountCurrency(a)==='ARS').map(a=>`<div class="list-row"><div><strong><span class="color-chip" style="background:${esc(a.color)}"></span>${esc(a.name)}</strong><small>Saldo inicial: ${money(a.opening)}${number(a.usdOpening)>0?` · Dólares: ${usd(a.usdOpening)}`:''}${a.cbu?` · CBU/Alias: ${esc(a.cbu)}`:''}${a.debitLast?` · Débito: **** ${esc(a.debitLast)}`:''}</small></div><div class="item-tools"><button data-edit-account="${a.id}">Editar</button>${!state.transactions.some(t=>t.accountId===a.id||t.toAccountId===a.id)&&!state.cards.some(c=>c.accountId===a.id)&&!state.loans.some(l=>l.accountId===a.id)?`<button class="delete" data-delete-account="${a.id}">Borrar</button>`:''}</div></div>`).join('')}</div><div class="panel"><h2>Personas del hogar</h2><p>Asignalas a gastos, ingresos, consumos y préstamos.</p><div>${state.members.map(m=>`<span class="pill" style="margin:.2rem">${esc(m)} <button class="text-button" data-delete-member="${esc(m)}" aria-label="Borrar ${esc(m)}">×</button></span>`).join('')}</div><form id="member-form" style="display:flex;gap:.5rem;margin-top:1rem"><input name="member" required placeholder="Nombre de la persona"><button class="secondary">Agregar</button></form></div><div class="panel"><h2>Cambiar contraseña</h2><p>La contraseña cifra tus datos en este navegador. Elegí una nueva que no aparezca en la dirección del sitio.</p><form id="change-password-form" class="password-form"><label>Contraseña actual<input name="current" type="password" autocomplete="current-password" required></label><label>Contraseña nueva<input name="newPassword" type="password" autocomplete="new-password" minlength="12" required></label><label>Repetir contraseña nueva<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></label><button class="primary">Cambiar contraseña</button><p id="change-password-message" class="fine" role="status">Después descargá un respaldo nuevo: las copias anteriores conservan la contraseña vieja.</p></form></div></div><div class="stack"><div class="panel setting-section"><div class="section-head" style="margin:0 0 1rem"><h2>Rubros de gastos e ingresos</h2><button class="secondary" data-action="new-category">+ Rubro</button></div><p>Sirven para agrupar gastos e ingresos en movimientos y estadísticas.</p>${state.expenseCategories.map(c=>`<div class="list-row"><strong>${esc(c.name)}</strong><div class="item-tools"><button data-edit-category="${esc(c.id)}">Editar</button><button class="delete" data-delete-category="${esc(c.id)}">Borrar</button></div></div>`).join('')}</div><div class="panel setting-section"><div class="section-head" style="margin:0 0 1rem"><h2>Lugares y servicios</h2><button class="secondary" data-action="new-payee">+ Lugar o servicio</button></div><p>Estado de ${formatMonth(selectedMonth)}. <button class="text-button" data-go="servicios">Ver control mensual e historial</button></p>${state.payees.map(x=>`<div class="list-row"><div><strong>${esc(x.name)}</strong><small>${esc(categoryName(x.categoryId))}</small>${payeeStatusBadge(payeeMonthStatus(x.id))}</div><div class="item-tools"><button data-edit-payee="${esc(x.id)}">Editar</button><button class="delete" data-delete-payee="${esc(x.id)}">Borrar</button></div></div>`).join('')}</div><div class="panel"><h2>Respaldo cifrado</h2><p>Descargá un archivo cifrado o guardalo en la carpeta de Google Drive de esta computadora. En otra computadora, abrí este sitio, elegí “Importar respaldo” y escribí la contraseña de ese archivo.</p><div class="card-actions"><button class="primary" id="export-backup">Descargar respaldo</button><button class="secondary" id="save-drive-backup">Guardar en Google Drive</button><label class="secondary" style="cursor:pointer">Importar respaldo<input type="file" id="import-backup" accept=".json,application/json" hidden></label></div><p class="fine" style="margin-top:1rem">Si Google Drive está instalado, elegí tu carpeta de Drive cuando se abra “Guardar como”. Drive sincroniza ese archivo después.</p></div><div class="panel"><h2>Cómo se calculan los saldos</h2><p>Las cuentas en dólares se administran desde <button class="text-button" data-go="inicio-usd">Resumen dólares</button>.</p><p>En Inicio, los meses pasados muestran el saldo al cierre del mes elegido. Los meses futuros muestran solamente movimientos cargados en ese mes.</p><p>Los consumos futuros de tarjeta se mantienen aparte para evitar contarlos dos veces como dinero que salió de una cuenta.</p></div></div></div>`}
function cleanBackupControls(){const passwordPanel=$('#change-password-form')?.closest('.panel');if(passwordPanel)passwordPanel.hidden=storageMode==='cloud';const input=$('#import-backup');if(!input)return;const panel=input.closest('.panel');panel?.querySelector('#save-drive-backup')?.remove();panel?.querySelector('#open-drive-import')?.remove();const intro=panel?.querySelector('p:not(.fine)'),note=panel?.querySelector('.fine');if(intro)intro.textContent=storageMode==='cloud'?'Descargá un respaldo cifrado de los datos guardados en la nube, o importá un respaldo anterior para reemplazar esta cuenta.':'Descargá un archivo cifrado y guardalo donde prefieras, por ejemplo en tu carpeta de Google Drive. En otra computadora, abrí este sitio, elegí “Importar respaldo” y escribí la contraseña de ese archivo.';if(note)note.textContent=storageMode==='cloud'?'El respaldo se cifra con la contraseña que escribas al descargarlo. Esa contraseña puede ser distinta de la de inicio de sesión.':'Para llevar solo tus datos a otra computadora, descargá este respaldo e importalo allá. Para llevar también la app actualizada, usá el ZIP nuevo.'}
function modal(title,body){$('#modal-title').textContent=title;$('#modal-body').innerHTML=body;$('#modal').showModal();wireModal()}
function close(){ $('#modal').close() }
function formHtml(fields){return `<form id="edit-form"><div class="form-grid">${fields}</div><div class="form-actions"><button type="button" class="secondary" id="cancel-modal">Cancelar</button><button class="primary">Guardar</button></div></form>`}
const field=(label,name,type='text',value='',extra='')=>`<label>${label}<input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
const select=(label,name,options)=>`<label>${label}<select name="${name}" required>${options}</select></label>`;
function wireModal(){$('#cancel-modal')?.addEventListener('click',close);$('#modal-body')?.addEventListener('click',async e=>{let el=e.target.closest('button');if(!el)return;const d=el.dataset;if(d.editTx){const t=byId(state.transactions,d.editTx);close();if(t)openTransaction(t)}else if(d.editBill){const b=byId(state.bills,d.editBill);close();if(b)openBill(b)}else if(d.editCharge){const x=byId(state.charges,d.editCharge);close();if(x)openCharge('',x)}else if(d.deleteCharge&&confirm('¿Borrar este consumo futuro?')){state.charges=state.charges.filter(x=>x.id!==d.deleteCharge);await save();close();render()}})}
function submit(handler){$('#edit-form').onsubmit=async e=>{e.preventDefault();if(e.submitter?.disabled)return;const data=Object.fromEntries(new FormData(e.target));let undo;if(e.submitter)e.submitter.disabled=true;try{undo=await handler(data);await save();close();render();toast('Guardado correctamente.')}catch(ex){if(typeof undo==='function')undo();alert(ex.message)}finally{if(e.submitter)e.submitter.disabled=false}}}
function requireAmount(v){const n=number(v);if(!Number.isFinite(n)||n<=0)throw Error('Ingresá un importe mayor a cero.');return n}
function syncLoanPaid(loanId){const loan=byId(state.loans,loanId);if(loan)loan.paid=state.transactions.some(t=>t.kind==='loan_payment'&&t.loanId===loanId)}
function openTransaction(seed={}){
  if(seed.linkedId)seed=byId(state.transactions,seed.linkedId)||seed;
  const editing=!!seed.id,type=seed.kind||'expense',currency=seed.currency||(seed.accountId?accountCurrency(byId(state.accounts,seed.accountId)):currentCurrency()),dollars=currency==='USD';
  const types=[['expense','Gasto'],['income','Ingreso'],['transfer_out','Transferencia entre cuentas'],...dollars?[]:[['cash_withdrawal','Extracción']],['card_payment','Pago de tarjeta'],...dollars?[]:[['loan_payment','Pago de préstamo']]];
  const body=formHtml(`<div class="hint span-all">${dollars?'Movimiento en dólares (USD)':'Movimiento en pesos (ARS)'}</div>${select('Tipo de movimiento','kind',types.map(([v,n])=>`<option value="${v}" ${v===type?'selected':''}>${n}</option>`).join(''))}${field('Fecha','date','date',seed.date||today(),'required')}${field('Hora','time','time',seed.id?seed.time||'':seed.time||currentTime())}${field(dollars?'Importe en dólares':'Importe en pesos','amount','number',seed.amount||'','required min="0.01" step="0.01"')}${select('Cuenta de origen','accountId',accountOptions(seed.accountId,false,true,currency))}<div id="tx-destination" class="span-all"></div>${field('Detalle','description','text',seed.description||'','placeholder="Ej.: pago de tarjeta"')}${select('Persona','member',memberOptions(seed.member))}`);
  modal(editing?'Editar movimiento':dollars?'Nuevo movimiento en dólares':'Nuevo movimiento',body);
  const form=$('#edit-form');let descriptionKind=type;
  const update=()=>{
    const t=form.elements.kind.value,description=form.elements.description;
    if(textKey(description.value)===textKey(trType({kind:descriptionKind})))description.value=trType({kind:t});
    descriptionKind=t;
    form.querySelector('#tx-destination').innerHTML=t==='expense'?expenseFields(t===type?seed:{})+serviceMonthField(t===type?seed:{}):t==='income'?select('Rubro de ingreso','expenseCategoryId',categoryOptions(t===type?seed.expenseCategoryId:'')):t==='transfer_out'?select('Cuenta de destino','toAccountId',accountOptions(t===type?seed.toAccountId:'',false,false,currency)):t==='cash_withdrawal'?'<div class="hint span-all">La extracción se suma automáticamente a la cuenta Efectivo.</div>':t==='card_payment'?`${select('Tarjeta','cardId',cardOptions(t===type?seed.cardId:'',true))}${field('Mes del resumen al que se aplica el pago','statementMonth','month',t===type?seed.statementMonth||selectedMonth:selectedMonth,'required')}<div class="hint span-all">${dollars?'Este pago descuenta los dólares pendientes del resumen y de la cuenta en USD que elijas.':'Este pago descuenta los pesos pendientes del resumen.'}</div>`:t==='loan_payment'?select('Préstamo','loanId','<option value="">Elegí un préstamo</option>'+state.loans.map(l=>`<option value="${l.id}" ${l.id===(t===type?seed.loanId:'')?'selected':''}>${esc(l.name)}</option>`).join('')):'';
    form.elements.accountId.closest('label').firstChild.textContent=t==='income'?'Cuenta que recibe el ingreso':'Cuenta de origen';
    if(t==='expense')attachCatalogForm(form,'description');
  };
  form.elements.kind.onchange=update;update();
  submit(d=>recordTransaction({...d,currency},seed));
}
function recordTransaction(d,seed={}){
  if(seed.linkedId)seed=byId(state.transactions,seed.linkedId)||seed;
  const amount=requireAmount(roundMoney(d.amount)),currency=d.currency||'ARS',account=byId(state.accounts,d.accountId),editing=!!seed.id;
  if(!['ARS','USD'].includes(currency))throw Error('Moneda no válida.');
  if(!account)throw Error('Elegí una cuenta.');
  if(accountCurrency(account)!==currency)throw Error('Elegí una cuenta de la misma moneda que el movimiento.');
  if(editing&&txCurrency(seed)!==currency)throw Error('La moneda del movimiento original debe conservarse.');
  const allowed=currency==='USD'?['income','expense','transfer_out','card_payment']:['income','expense','transfer_out','cash_withdrawal','card_payment','loan_payment'];
  if(!allowed.includes(d.kind))throw Error('Ese tipo de movimiento no está disponible en esta moneda.');
  if(['expense','income'].includes(d.kind)&&!d.expenseCategoryId)throw Error(d.kind==='income'?'Elegí un rubro de ingreso.':'Elegí un rubro de gastos.');
  const serviceMonth=d.kind==='expense'?(d.serviceMonth||(d.date||'').slice(0,7)):'';
  if(d.kind==='expense'&&!validServiceMonth(serviceMonth))throw Error('Elegí el mes que estás pagando.');
  const cash=d.kind==='cash_withdrawal'?cashAccount():null;
  if(d.kind==='transfer_out'){
    const destination=byId(state.accounts,d.toAccountId);
    if(!destination||d.toAccountId===d.accountId)throw Error('Elegí otra cuenta de destino.');
    if(accountCurrency(destination)!==currency)throw Error('Las transferencias deben ser entre cuentas de la misma moneda.');
  }
  if(d.kind==='cash_withdrawal'&&!cash)throw Error('No encontré una cuenta de efectivo. Creá una cuenta de tipo Efectivo en Configuración.');
  if(d.kind==='cash_withdrawal'&&cash.id===d.accountId)throw Error('Elegí una cuenta de origen distinta de Efectivo.');
  if(d.kind==='card_payment'&&!byId(state.cards,d.cardId))throw Error('Elegí la tarjeta.');
  if(d.kind==='card_payment'&&!/^\d{4}-\d{2}$/.test(d.statementMonth||''))throw Error('Elegí el mes del resumen al que corresponde el pago.');
  if(d.kind==='loan_payment'&&!byId(state.loans,d.loanId))throw Error('Elegí el préstamo.');
  const sourceId=seed.linkedId||seed.id||uid(),oldLoanId=seed.loanId,payee=d.kind==='expense'?byId(state.payees,d.payeeId):null;
  let description=String(d.description||'').trim();
  if(editing&&seed.kind!==d.kind&&textKey(description)===textKey(trType(seed)))description='';
  const t={id:sourceId,date:d.date,time:d.time||'',amount,currency,serviceMonth,kind:d.kind,accountId:d.accountId,description:description||payee?.name||trType({kind:d.kind}),member:d.member,category:d.kind==='income'?categoryName(d.expenseCategoryId):'',expenseCategoryId:['expense','income'].includes(d.kind)?d.expenseCategoryId:'',payeeId:d.kind==='expense'?d.payeeId||'':'',cardId:d.kind==='card_payment'?d.cardId:'',loanId:d.kind==='loan_payment'?d.loanId:'',statementMonth:d.kind==='card_payment'?d.statementMonth:'',toAccountId:['transfer_out','cash_withdrawal'].includes(d.kind)?(d.kind==='cash_withdrawal'?cash.id:d.toAccountId):''};
  const previousTransactions=[...state.transactions],previousLoanStatus=state.loans.map(loan=>[loan,loan.paid]);
  if(editing)state.transactions=state.transactions.filter(x=>x.id!==sourceId&&x.linkedId!==sourceId);
  state.transactions.push(t);
  if(['transfer_out','cash_withdrawal'].includes(d.kind))state.transactions.push({...t,id:uid(),kind:'transfer_in',accountId:t.toAccountId,toAccountId:d.accountId,linkedId:t.id});
  syncLoanPaid(oldLoanId);syncLoanPaid(t.loanId);
  return ()=>{state.transactions=previousTransactions;for(const [loan,paid] of previousLoanStatus)loan.paid=paid};
}
function expenseFields(item={}){
  return `${select('Rubro de gasto','expenseCategoryId',categoryOptions(item.expenseCategoryId))}<label>Lugar o servicio (opcional)<select name="payeeId">${payeeOptions(item.payeeId)}</select></label>`;
}
function attachCatalogForm(form,descriptionName){
  const selectPayee=form.elements.payeeId;
  if(!selectPayee)return;
  selectPayee.onchange=()=>{
    const payee=byId(state.payees,selectPayee.value);
    if(!payee)return;
    form.elements.expenseCategoryId.value=payee.categoryId;
    const description=form.elements[descriptionName];
    if(description&&!description.value.trim())description.value=payee.name;
  };
}
function openClassifyTransaction(t){
  modal('Clasificar gasto',formHtml(`${expenseFields(t)}${serviceMonthField(t)}${field('Detalle','description','text',t.description||'','required')}`));
  attachCatalogForm($('#edit-form'),'description');
  submit(d=>{
    if(!d.expenseCategoryId)throw Error('Elegí un rubro de gastos.');
    const serviceMonth=d.serviceMonth||(t.date||'').slice(0,7);
    if(!validServiceMonth(serviceMonth))throw Error('Elegí el mes que estás pagando.');
    Object.assign(t,{expenseCategoryId:d.expenseCategoryId,payeeId:d.payeeId||'',serviceMonth,description:d.description.trim()});
  });
}
function openCategory(c){
  modal(c?'Editar rubro':'Nuevo rubro',formHtml(field('Nombre del rubro','name','text',c?.name||'','required placeholder="Ej.: Mascotas"')));
  submit(d=>{
    const name=d.name.trim();
    if(!name)throw Error('Ingresá un nombre.');
    if(state.expenseCategories.some(x=>x.name.toLocaleLowerCase('es-AR')===name.toLocaleLowerCase('es-AR')&&x.id!==c?.id))throw Error('Ese rubro ya existe.');
    if(c)c.name=name;else state.expenseCategories.push({id:uid(),name});
  });
}
function openPayee(p){
  modal(p?'Editar lugar o servicio':'Nuevo lugar o servicio',formHtml(`${field('Nombre','name','text',p?.name||'','required placeholder="Ej.: Coto, Edenor, AySA"')}${select('Rubro habitual','categoryId',categoryOptions(p?.categoryId))}`));
  submit(d=>{
    const name=d.name.trim();
    if(!name||!d.categoryId)throw Error('Completá el nombre y el rubro.');
    if(state.payees.some(x=>x.name.toLocaleLowerCase('es-AR')===name.toLocaleLowerCase('es-AR')&&x.id!==p?.id))throw Error('Ese lugar o servicio ya existe.');
    if(p)Object.assign(p,{name,categoryId:d.categoryId});else state.payees.push({id:uid(),name,categoryId:d.categoryId});
  });
}
function openAccount(a,currency=currentCurrency()){
  currency=a?accountCurrency(a):currency;
  modal(a?'Editar cuenta'+(currency==='USD'?' en dólares':''):currency==='USD'?'Nueva cuenta en dólares':'Nueva cuenta',formHtml(`${field('Nombre','name','text',a?.name||'','required')}${select('Tipo','type',[['bank','Banco'],['wallet','Billetera virtual'],['cash','Efectivo']].map(([v,n])=>`<option value="${v}" ${a?.type===v?'selected':''}>${n}</option>`).join(''))}${field('CBU o alias (opcional)','cbu','text',a?.cbu||'','placeholder="Ej.: mi.alias.banco"')}${field('Últimos números de débito','debitLast','text',a?.debitLast||'','inputmode="numeric" maxlength="8" placeholder="Ej.: 1234"')}${field(currency==='USD'?'Saldo inicial (dólares)':'Saldo inicial (pesos)','opening','number',a?.opening||0,'step="0.01" required')}${field('Color','color','color',a?.color||'#3287a5','required')}<div class="hint span-all">${currency==='USD'?'Esta cuenta se usa en Resumen dólares y Movimientos dólares.':'Los saldos en dólares se cargan en sus cuentas desde Resumen dólares.'}</div>`));
  submit(d=>{const obj={name:d.name.trim(),type:d.type,cbu:d.cbu.trim(),debitLast:d.debitLast.trim(),opening:roundMoney(d.opening),currency,usdOpening:0,color:d.color};if(!obj.name)throw Error('Ingresá un nombre.');if(a)Object.assign(a,obj);else state.accounts.push({id:uid(),...obj})});
}
function openCard(c){modal(c?'Editar tarjeta':'Nueva tarjeta',formHtml(`${field('Nombre de la tarjeta','name','text',c?.name||'','required placeholder="Ej.: Visa Santander"')}${select('Banco','accountId',accountOptions(c?.accountId))}${field('Cierre (día del mes, opcional)','closingDay','number',c?.closingDay||'','min="1" max="31"')}${field('Vencimiento habitual (día, opcional)','dueDay','number',c?.dueDay||'','min="1" max="31"')}`));submit(d=>{if(!d.accountId)throw Error('Elegí el banco.');const x={name:d.name.trim(),accountId:d.accountId,closingDay:d.closingDay||'',dueDay:d.dueDay||''};if(c)Object.assign(c,x);else state.cards.push({id:uid(),...x})})}
function openCardClosing(cardId){
  const card=byId(state.cards,cardId);
  if(!card)return;
  const month=selectedMonth,closingDate=card.closingDates?.[month]||'';
  modal('Fecha de cierre',formHtml(`<div class="hint span-all"><strong>${esc(card.name)}</strong><br>Resumen de ${formatMonth(month)}${card.closingDay?`<br>Día habitual de cierre: ${esc(card.closingDay)}`:''}</div>${field('Fecha de cierre','closingDate','date',closingDate)}`));
  submit(d=>{
    const dates={...card.closingDates};
    if(d.closingDate)dates[month]=d.closingDate;else delete dates[month];
    card.closingDates=dates;
  });
}
function openCharge(cardId,existing){
  const parts=installmentParts(existing),current=parts.current||1,total=parts.total||'';
  modal(existing?'Editar consumo':'Consumo del mes siguiente',formHtml(`${select('Tarjeta','cardId',cardOptions(existing?.cardId||cardId))}${field('Mes en que vendrá en el resumen','month','month',existing?.month||nextMonth(selectedMonth),'required')}${field('Fecha de compra (opcional)','date','date',existing?.date||'')}${expenseFields(existing||{})}${field('Comercio o detalle','description','text',existing?.description||'','required')}${field('Importe de cada cuota en pesos','amount','number',number(existing?.amount)>0?existing.amount:'','min="0" step="0.01" placeholder="Si corresponde"')}${field('Importe de cada cuota en dólares','usdAmount','number',number(existing?.usdAmount)>0?existing.usdAmount:'','min="0" step="0.01" placeholder="Opcional"')}${field('Cuota actual','installmentCurrent','number',current,'min="1" step="1"')}${field('Cantidad total de cuotas','installmentTotal','number',total,'min="1" step="1" placeholder="Ej.: 6"')}${select('Persona','member',memberOptions(existing?.member))}<div class="hint span-all">Si cargás cuotas, el importe es el valor de cada cuota. La app crea automáticamente las cuotas siguientes en los próximos resúmenes.</div>`));
  attachCatalogForm($('#edit-form'),'description');
  submit(d=>{
    if(!d.cardId)throw Error('Elegí una tarjeta.');
    if(!existing&&byId(state.cards,d.cardId)?.active===false)throw Error('Esta tarjeta está dada de baja. Reactivala para cargar consumos nuevos.');
    if(!d.expenseCategoryId)throw Error('Elegí un rubro de gastos.');
    const amount=number(d.amount),usdAmount=number(d.usdAmount);
    if(amount<=0&&usdAmount<=0)throw Error('Ingresá un importe en pesos o dólares.');
    const current=Math.trunc(number(d.installmentCurrent)||1),totalRaw=Math.trunc(number(d.installmentTotal)||0),total=totalRaw||current;
    if(current<1)throw Error('La cuota actual debe ser 1 o mayor.');
    if(total<current)throw Error('El total de cuotas no puede ser menor que la cuota actual.');
    const groupId=existing?.installmentGroupId||(total>1?uid():'');
    const base={...d,amount,usdAmount,description:d.description.trim(),installmentGroupId:groupId};
    if(existing){
      Object.assign(existing,{...base,installmentCurrent:total>1?current:'',installmentTotal:total>1?total:'',installment:total>1?`${current} de ${total}`:''});
    }else if(total>1){
      for(let i=current;i<=total;i++)state.charges.push({...base,id:uid(),month:addMonths(d.month,i-current),installmentCurrent:i,installmentTotal:total,installment:`${i} de ${total}`});
    }else state.charges.push({id:uid(),...base,installmentCurrent:'',installmentTotal:'',installment:''});
  });
}
function openCardCharges(cardId,month=nextMonth(selectedMonth)){
  const card=byId(state.cards,cardId),charges=state.charges.filter(x=>x.cardId===cardId&&x.month===month).sort((a,b)=>(a.date||'9999-99-99').localeCompare(b.date||'9999-99-99')||a.description.localeCompare(b.description,'es-AR'));
  const total=charges.reduce((n,x)=>n+number(x.amount),0),totalUsd=charges.reduce((n,x)=>n+number(x.usdAmount),0);
  modal(`Consumos futuros - ${card?.name||'Tarjeta'}`,`<div class="hint">${charges.length} consumo${charges.length===1?'':'s'} cargado${charges.length===1?'':'s'} para ${formatMonth(month)}. Total: <strong>${amountPair(total,totalUsd)}</strong></div><div style="margin-top:1rem">${rowsOrEmpty(charges.map(chargeRow).join(''),'No hay consumos futuros cargados para este mes.')}</div>`);
}
function openCarriedStatements(){
  const statements=state.statements.filter(s=>s.carriedForward===true).sort((a,b)=>b.month.localeCompare(a.month)||nameSorter.compare(cardName(a.cardId),cardName(b.cardId)));
  const rows=statements.map(s=>{
    const d=dueForCard({id:s.cardId},s.month);
    return `<div class="list-row carried-history-row"><div><strong>${esc(cardName(s.cardId))}</strong><small>Resumen de ${formatMonth(s.month)}<br>Pasó al resumen de ${formatMonth(nextMonth(s.month))}</small></div><div class="right"><small>Importe que pasó</small><strong class="carried-amount">${amountPair(d.carriedAmount,d.carriedUsdAmount,money(0))}</strong></div></div>`;
  }).join('');
  modal('Ver lo que pasó al resumen siguiente',`<p class="muted">Historial de todas las tarjetas. Los importes muestran el saldo impago que pasó a cada resumen siguiente.</p><div class="panel">${rowsOrEmpty(rows,'Todavía no marcaste ningún resumen como pasado al siguiente.')}</div>`);
}
async function toggleStatementCarryForward(statementId){
  const entry=byId(state.statements,statementId);
  if(!entry)return;
  const previous=entry.carriedForward,d=dueForCard({id:entry.cardId},entry.month);
  if(!d.carriedForward&&d.remaining<=0&&d.usdRemaining<=0)return;
  entry.carriedForward=!d.carriedForward;
  try{await save()}catch(ex){
    if(previous===undefined)delete entry.carriedForward;else entry.carriedForward=previous;
    alert('No se pudo guardar el cambio: '+ex.message);
    return;
  }
  render();
  toast(entry.carriedForward?'El saldo pasó al resumen siguiente.':'El resumen volvió a quedar pendiente.');
}
function openStatement(cardId,prefill={}){let old=state.statements.find(s=>s.cardId===cardId&&s.month===selectedMonth);modal('Resumen de tarjeta',formHtml(`${select('Tarjeta','cardId',cardOptions(cardId,true))}${field('Mes del resumen','month','month',old?.month||selectedMonth,'required')}${field('Total del resumen en pesos','amount','number',number(old?.amount)>0?old.amount:prefill.amount??'','min="0" step="0.01" placeholder="Si corresponde"')}${field('Total del resumen en dólares','usdAmount','number',number(old?.usdAmount)>0?old.usdAmount:'','min="0" step="0.01" placeholder="Opcional"')}${field('Vencimiento confirmado (opcional)','due','date',old?.due||prefill.due||'')}`));submit(d=>{if(!d.cardId)throw Error('Elegí la tarjeta.');const amount=number(d.amount),usdAmount=number(d.usdAmount);if(amount<=0&&usdAmount<=0)throw Error('Ingresá el total del resumen en pesos o dólares.');let entry=state.statements.find(s=>s.cardId===d.cardId&&s.month===d.month);if(entry)Object.assign(entry,{amount,usdAmount,due:d.due});else state.statements.push({id:uid(),cardId:d.cardId,month:d.month,amount,usdAmount,due:d.due})})}
function openBill(b={}){
  modal(b.id?'Editar vencimiento':'Servicio o gasto',formHtml(`${expenseFields(b)}${serviceMonthField(b)}${field('Nombre','name','text',b.name||'','required placeholder="Ej.: Edenor"')}${field('Importe en pesos','amount','number',b.amount??'','required min="0.01" step="0.01"')}${field('Fecha de vencimiento','due','date',b.due||'','required')}${select('Persona','member',memberOptions(b.member))}`));
  attachCatalogForm($('#edit-form'),'name');
  submit(d=>{
    if(!d.expenseCategoryId)throw Error('Elegí un rubro de gastos.');
    const serviceMonth=d.serviceMonth||(d.due||'').slice(0,7);
    if(!validServiceMonth(serviceMonth))throw Error('Elegí el mes que estás pagando.');
    const x={...d,serviceMonth,amount:requireAmount(d.amount),paid:b.paid||false};
    if(b.id)Object.assign(b,x);else state.bills.push({id:uid(),...x});
  });
}
function openLoan(l){modal(l?'Editar préstamo':'Nuevo préstamo',formHtml(`${field('Nombre','name','text',l?.name||'','required placeholder="Ej.: Préstamo Santander"')}${select('Cuenta que se usa para pagar','accountId',accountOptions(l?.accountId))}${field('Importe de la cuota','installment','number',l?.installment||'','required min="0.01" step="0.01"')}${field('Próximo vencimiento','due','date',l?.due||'')}${field('Cuota actual','current','number',l?.current||'','min="1"')}${field('Cantidad total de cuotas','total','number',l?.total||'','min="1"')}${select('Persona','member',memberOptions(l?.member))}`));submit(d=>{if(!d.accountId)throw Error('Elegí la cuenta.');let x={...d,installment:requireAmount(d.installment),paid:l?.due===d.due?l.paid:false};if(l)Object.assign(l,x);else state.loans.push({id:uid(),...x})})}
async function readPdf(file){if(!file||!(/\.pdf$/i.test(file.name)||file.type==='application/pdf'))throw Error('Elegí un archivo PDF.');if(file.size>15_000_000)throw Error('El PDF supera 15 MB.');let pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;let pages=[];for(let p=1;p<=Math.min(pdf.numPages,20);p++){let page=await pdf.getPage(p),content=await page.getTextContent(),lines=[],lastY=null,line='';for(let item of content.items){if(!('str'in item))continue;let y=Math.round(item.transform[5]);if(lastY!==null&&Math.abs(y-lastY)>3){if(line.trim())lines.push(line.trim());line=''}line+=item.str+' ';lastY=y}if(line.trim())lines.push(line.trim());pages.push(lines.join('\n'))}await pdf.destroy();return pages.join('\n')}
const parseMoney=s=>{let x=s.replace(/[^\d.,]/g,'');if(!x)return null;let i=x.lastIndexOf(','),j=x.lastIndexOf('.');if(i>=0&&j>=0)x=i>j?x.replace(/\./g,'').replace(',','.'):x.replace(/,/g,'');else if(i>=0)x=x.replace(/\./g,'').replace(',','.');else if(j>=0){let parts=x.split('.');if(parts.at(-1).length===3)x=x.replace(/\./g,'')}let n=Number(x);return Number.isFinite(n)&&n>0?n:null};
function dateFrom(s){let m=s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);if(!m)return '';let y=Number(m[3]);if(y<100)y+=2000;let dt=new Date(y,Number(m[2])-1,Number(m[1]));return dt.getFullYear()===y&&dt.getMonth()===Number(m[2])-1&&dt.getDate()===Number(m[1])?`${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`:''}
function parseDoc(text,type){const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);let names=['AySA','Edenor','Metrogas','Naturgy','Flow','Personal','Movistar','Municipalidad','ARBA','Telecentro','Edesur','Camuzzi'];let name=names.find(n=>new RegExp(n,'i').test(text))||'';let amt=[],dates=[];for(let i=0;i<lines.length;i++){let line=lines[i];if(/(?:total\s+a\s+pagar|importe\s+total|total\s+del\s+resumen|saldo\s+total)/i.test(line)){let m=line.match(/\$\s*([\d.,]+)/)||lines[i+1]?.match(/^\$\s*([\d.,]+)/);if(m){let n=parseMoney(m[1]);if(n)amt.push({amount:n,source:line.slice(0,160)})}}if(/(?:fecha\s+de\s+vencimiento|vencimiento(?:\s+actual)?|1[°ºer]*\s*vencimiento)/i.test(line)){let d=dateFrom(line)||dateFrom(lines[i+1]||'');if(d)dates.push({date:d,source:line.slice(0,160)})}}let uniqueAmt=[...new Set(amt.map(x=>x.amount))],uniqueDate=[...new Set(dates.map(x=>x.date))];return {name,amount:uniqueAmt.length===1?uniqueAmt[0]:null,due:uniqueDate.length===1?uniqueDate[0]:'',ambiguous:uniqueAmt.length>1||uniqueDate.length>1,source:[...amt,...dates].map(x=>x.source).slice(0,8),textLength:text.trim().length,type}}
function wire(){const root=$('#view');root.onclick=async e=>{let el=e.target.closest('button');if(!el)return;const d=el.dataset;if(el.id==='export-backup'){await downloadBackup();return}else if(d.sortTx){txSort=txSort.key===d.sortTx?{key:d.sortTx,dir:txSort.dir==='asc'?'desc':'asc'}:{key:d.sortTx,dir:d.sortTx==='date'?'desc':'asc'};applyTransactionFilters()}else if(d.go){view=d.go;render()}else if(d.payeeShift){selectedMonth=addMonths(selectedMonth,Number(d.payeeShift));render()}else if(d.payeeMonth){el.disabled=true;try{await setPayeeMonthPaid(d.payeeMonth,d.month,d.paid==='true')}catch(ex){alert('No se pudo guardar el estado: '+ex.message)}finally{el.disabled=false}}else if(d.payeeExpense)openPayeeExpense(d.payeeExpense,d.month);else if(d.payeeRecords)openPayeeMonthRecords(d.payeeRecords,d.month);else if(d.toggleHomeAmounts){homeAmountsVisible=!homeAmountsVisible;render()}else if(d.action==='new-transaction')openTransaction();else if(d.action==='new-card')openCard();else if(d.action==='new-account')openAccount(undefined,'ARS');else if(d.action==='new-usd-account')openAccount(undefined,'USD');else if(d.action==='new-category')openCategory();else if(d.action==='new-payee')openPayee();else if(d.action==='new-bill')openBill();else if(d.action==='new-loan')openLoan();else if(d.editAccount)openAccount(byId(state.accounts,d.editAccount));else if(d.editCategory)openCategory(byId(state.expenseCategories,d.editCategory));else if(d.editPayee)openPayee(byId(state.payees,d.editPayee));else if(d.editTx){let t=byId(state.transactions,d.editTx);if(t)openTransaction(t)}else if(d.classifyTx)openClassifyTransaction(byId(state.transactions,d.classifyTx));else if(d.editCharge)openCharge('',byId(state.charges,d.editCharge));else if(d.viewCarriedStatements)openCarriedStatements();else if(d.viewCharges)openCardCharges(d.viewCharges,d.chargeMonth||nextMonth(selectedMonth));else if(d.editBill)openBill(byId(state.bills,d.editBill));else if(d.editCard)openCard(byId(state.cards,d.editCard));else if(d.cardClosing)openCardClosing(d.cardClosing);else if(d.toggleCardActive){let c=byId(state.cards,d.toggleCardActive);if(c&&(c.active===false||confirm('¿Dar de baja esta tarjeta? Conserva todos los consumos, resúmenes y pagos anteriores.'))){c.active=c.active===false;await save();render()}}else if(d.newCharge)openCharge(d.newCharge);else if(d.statement)openStatement(d.statement);else if(d.deleteStatement){let s=byId(state.statements,d.deleteStatement);if(s&&confirm(`¿Borrar el resumen de ${cardName(s.cardId)} de ${formatMonth(s.month)}? Los pagos cargados para ese resumen se conservan como movimientos.`)){state.statements=state.statements.filter(x=>x.id!==s.id);await save();render()}}else if(d.carryStatement){el.disabled=true;try{await toggleStatementCarryForward(d.carryStatement)}finally{el.disabled=false}}else if(d.payCard)openCardPayment(d.payCard,d.currency||'ARS');else if(d.payLoan){let l=byId(state.loans,d.payLoan);openTransaction({kind:'loan_payment',loanId:l.id,accountId:l.accountId,amount:l.installment,description:`Cuota ${l.name}`,member:l.member})}else if(d.editLoan)openLoan(byId(state.loans,d.editLoan));else if(d.deleteCategory){let id=d.deleteCategory;if(state.payees.some(x=>x.categoryId===id)||state.transactions.some(x=>x.expenseCategoryId===id)||state.charges.some(x=>x.expenseCategoryId===id)||state.bills.some(x=>x.expenseCategoryId===id)){alert('Este rubro ya se usa. Cambiá el rubro de esos registros antes de borrarlo.')}else if(confirm('¿Borrar este rubro?')){state.expenseCategories=state.expenseCategories.filter(x=>x.id!==id);await save();render()}}else if(d.deletePayee){let id=d.deletePayee;if(state.transactions.some(x=>x.payeeId===id)||state.charges.some(x=>x.payeeId===id)||state.bills.some(x=>x.payeeId===id)||state.payeeMonths.some(x=>x.payeeId===id)){alert('Este lugar o servicio ya se usa. Cambiá esos registros antes de borrarlo.')}else if(confirm('¿Borrar este lugar o servicio?')){state.payees=state.payees.filter(x=>x.id!==id);await save();render()}}else if(d.deleteTx){let t=byId(state.transactions,d.deleteTx);if(confirm(`¿Borrar ${t.description} por ${currencyMoney(t.amount,txCurrency(t))}?`)){const sourceId=t.linkedId||t.id,loanId=t.loanId;state.transactions=state.transactions.filter(x=>x.id!==sourceId&&x.linkedId!==sourceId);syncLoanPaid(loanId);await save();render()}}else if(d.deleteCharge){if(confirm('¿Borrar este consumo futuro?')){state.charges=state.charges.filter(x=>x.id!==d.deleteCharge);await save();render()}}else if(d.toggleBill){let b=byId(state.bills,d.toggleBill);b.paid=!b.paid;await save();render()}else if(d.deleteBill){if(confirm('¿Borrar este vencimiento?')){state.bills=state.bills.filter(x=>x.id!==d.deleteBill);await save();render()}}else if(d.deleteLoan){if(confirm('¿Borrar este préstamo?')){state.loans=state.loans.filter(x=>x.id!==d.deleteLoan);await save();render()}}else if(d.deleteAccount){if(confirm('¿Borrar esta cuenta?')){state.accounts=state.accounts.filter(x=>x.id!==d.deleteAccount);await save();render()}}else if(d.deleteMember){if(confirm('¿Borrar esta persona de la lista? Los movimientos anteriores conservarán su nombre.')){state.members=state.members.filter(x=>x!==d.deleteMember);await save();render()}}};
const acc=$('#filter-account'),kind=$('#filter-kind'),search=$('#filter-search');if(acc&&kind&&search){let filter=()=>applyTransactionFilters();acc.onchange=kind.onchange=filter;search.oninput=filter}
const payeeStatusSelect=$('#filter-payee-status');if(payeeStatusSelect)payeeStatusSelect.onchange=e=>{payeeStatusFilter=e.target.value;render()}
const dueStatusSelect=$('#filter-due-status');if(dueStatusSelect)dueStatusSelect.onchange=e=>{dueStatusFilter=e.target.value;render()}
$('#member-form')?.addEventListener('submit',async e=>{e.preventDefault();let x=e.target.elements.member.value.trim();if(x&&!state.members.includes(x)){state.members.push(x);await save();render()}});
$('#change-password-form')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget,button=form.querySelector('button'),message=$('#change-password-message');
  const current=form.elements.current.value,next=form.elements.newPassword.value,again=form.elements.confirmPassword.value;
  message.className='error';message.textContent='';
  if(next.length<12){message.textContent='Usá al menos 12 caracteres.';return}
  if(next!==again){message.textContent='Las contraseñas nuevas no coinciden.';return}
  if(next===current){message.textContent='La contraseña nueva debe ser diferente.';return}
  button.disabled=true;
  try{
    await unlocked(JSON.parse(localStorage.getItem(KEY)),current);
    const newSalt=crypto.getRandomValues(new Uint8Array(16)),newKey=await derive(next,newSalt);
    const blob=await encrypted(state,newKey,newSalt);
    localStorage.setItem(KEY,JSON.stringify(blob));
    secret=newKey;salt=newSalt;
    form.reset();message.className='fine';message.textContent='Contraseña cambiada. Descargá un respaldo nuevo; los anteriores siguen usando la contraseña vieja.';
    toast('Contraseña cambiada y datos cifrados nuevamente.');
  }catch(ex){message.textContent=ex.name==='OperationError'?'La contraseña actual no es correcta.':'No se pudo guardar el cambio: '+ex.message}
  finally{button.disabled=false}
});
async function backupFile(){
  await save();
  if(storageMode==='cloud'){
    const pass=prompt('Contraseña para cifrar este respaldo descargado:');
    if(pass===null)throw Error('Respaldo cancelado.');
    if(pass.length<8)throw Error('Usá al menos 8 caracteres para cifrar el respaldo.');
    const backupSalt=crypto.getRandomValues(new Uint8Array(16)),backupKey=await derive(pass,backupSalt);
    return {name:`hogar-respaldo-nube-${today()}.json`,content:JSON.stringify(await encrypted(state,backupKey,backupSalt))};
  }
  return {name:`hogar-respaldo-${today()}.json`,content:localStorage.getItem(KEY)};
}
function downloadBackupFile(name,content){const blob=new Blob([content],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function downloadBackup(){try{const f=await backupFile();downloadBackupFile(f.name,f.content)}catch(ex){alert(ex.message||'No se pudo descargar el respaldo.')}}
async function importBackupFile(file){if(!file)return;let raw=JSON.parse(await file.text()),pass=prompt('Contraseña con la que se creó este respaldo:');if(pass===null)return;let result=await unlocked(raw,pass),scope=storageMode==='cloud'?'esta cuenta en la nube':'esta computadora';if(!confirm(`Esto reemplazará TODOS los datos de ${scope} por los del respaldo. ¿Continuar?`))return;state=result.data;secret=result.key;salt=result.s;await save();render();toast('Respaldo importado.')}
async function importBackupChange(e){try{await importBackupFile(e.target.files?.[0])}catch(ex){alert(ex.name==='OperationError'?'Contraseña incorrecta o archivo dañado.':ex.message)}finally{e.target.value=''}}
$('#export-backup')?.addEventListener('click',downloadBackup);
$('#import-backup')?.addEventListener('change',importBackupChange);
$('#read-pdf')?.addEventListener('click',async()=>{let file=$('#doc-file').files?.[0],type=$('#doc-type').value,out=$('#doc-result');out.innerHTML='<p class="muted">Leyendo el PDF…</p>';try{let content=await readPdf(file),parsed=parseDoc(content,type);if(!parsed.textLength||!parsed.amount||!parsed.due||parsed.ambiguous||type==='bill'&&!parsed.name){out.innerHTML=`<div class="hint"><strong>No se pudo leer con seguridad.</strong> Puede ser un PDF escaneado, tener varios totales o faltar un importe, proveedor o vencimiento inequívoco. Cargalo manualmente; no se guardó ningún dato.</div><details style="margin-top:1rem"><summary>Ver texto extraído (${content.length} caracteres)</summary><div class="review">${esc(content.slice(0,9000)||'Sin texto seleccionable.')}</div></details>`;return}docDraft=parsed;let options=type==='card'?`${select('Tarjeta','doc-card',cardOptions())}${field('Mes del resumen','doc-month','month',selectedMonth)}`:'';out.innerHTML=`<div class="hint"><strong>Datos encontrados; confirmalos antes de guardar.</strong><br>Importe: ${money(parsed.amount)} · Vence: ${formatDate(parsed.due)}${parsed.name?` · ${esc(parsed.name)}`:''}</div><div class="review" style="margin-top:.8rem">Texto que permitió identificar los datos:\n${esc(parsed.source.join('\n'))}</div><div style="margin-top:.8rem">${options}<button class="primary" id="confirm-document" style="margin-top:.8rem">Confirmar y guardar</button></div><details style="margin-top:1rem"><summary>Ver texto extraído</summary><div class="review">${esc(content.slice(0,9000))}</div></details>`;$('#confirm-document').onclick=async()=>{if(type==='card'){let id=out.querySelector('[name="doc-card"]').value,m=out.querySelector('[name="doc-month"]').value;if(!id||!m){alert('Elegí la tarjeta y el mes.');return}if(state.statements.some(s=>s.cardId===id&&s.month===m)){alert('Ya existe un resumen para esta tarjeta y mes. Editalo desde Tarjetas.');return}state.statements.push({id:uid(),cardId:id,month:m,amount:parsed.amount,due:parsed.due})}else state.bills.push({id:uid(),name:parsed.name,amount:parsed.amount,due:parsed.due,member:state.members[0]||'Yo',paid:false,payeeId:state.payees.find(p=>p.name.toLocaleLowerCase('es-AR')===parsed.name.toLocaleLowerCase('es-AR'))?.id||'',expenseCategoryId:state.payees.find(p=>p.name.toLocaleLowerCase('es-AR')===parsed.name.toLocaleLowerCase('es-AR'))?.categoryId||''});await save();render();toast('Documento confirmado y guardado.')}}catch(ex){out.innerHTML=`<div class="hint"><strong>No se pudo leer.</strong> ${esc(ex.message||'El archivo no se pudo procesar.')} No se guardó ningún dato.</div>`}})
}

// An online first visit stores the static application shell for later offline visits.
function updateConnection(ready=false){
  const status=$('#connection-status');
  if(!navigator.onLine){status.textContent='Sin conexión · podés seguir cargando datos';status.dataset.mode='offline'}
  else if(ready){status.textContent='Disponible sin conexión en este equipo';status.dataset.mode='ready'}
  else{status.textContent='Preparando uso sin conexión…';status.dataset.mode='preparing'}
}
if('serviceWorker' in navigator){
  let offlineReady=false;
  updateConnection();
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(()=>{
    offlineReady=true;updateConnection(true);
  }).catch(()=>{
    $('#connection-status').textContent='No se pudo preparar el uso sin conexión';
  });
  window.addEventListener('online',()=>updateConnection(offlineReady));
  window.addEventListener('offline',()=>updateConnection(offlineReady));
}else $('#connection-status').textContent='Este navegador requiere internet para abrir el sitio';
