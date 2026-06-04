// ── SignalEdge Supabase Sync v4 — Google OAuth ────────────────
const SE_SUPA_URL='https://aivhwxixdjfyckvplimt.supabase.co';
const SE_SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdmh3eGl4ZGpmeWNrdnBsaW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzgzOTYsImV4cCI6MjA5NDgxNDM5Nn0.6JeBBItEGNaVP7l7F-90e-QE1INr_FTJV00aUl4WGrc';

let seDb=null;
let seUser=null;

window.addEventListener('load',()=>{
  setTimeout(async()=>{
    try{
      if(typeof supabase==='undefined'){console.log('SE Sync: Supabase no disponible');return;}
      seDb=supabase.createClient(SE_SUPA_URL,SE_SUPA_KEY);
      seInsertLoginBtn();
      const{data:{session}}=await seDb.auth.getSession();
      if(session?.user){seUser=session.user;seOnLogin(seUser);}
      seDb.auth.onAuthStateChange(async(event,session)=>{
        if(event==='SIGNED_IN'&&session?.user){seUser=session.user;seOnLogin(seUser);}
        else if(event==='SIGNED_OUT'){seUser=null;seOnLogout();}
      });
    }catch(e){console.log('SE Sync error:',e.message);seShowIndicator(false);}
  },1500);
});

// ── LOGIN / LOGOUT ────────────────────────────────────────────
async function seLoginGoogle(){
  if(!seDb)return;
  try{
    await seDb.auth.signInWithOAuth({provider:'google',options:{redirectTo:'https://signaledgeapp.com'}});
  }catch(e){console.log('SE Login error:',e.message);}
}
async function seLogout(){
  if(!seDb)return;
  try{await seDb.auth.signOut();}catch(e){}
}

// ── QUAN ES FA LOGIN ──────────────────────────────────────────
async function seOnLogin(user){
  console.log('SE Sync: Login ✓',user.email);
  seUser=user;
  window.seUser=user; // exposar globalment
  seUpdateLoginBtn(true,user);
  if(typeof seUpdateProfileMenu==='function')seUpdateProfileMenu(user);
  seShowIndicator(true);
  await seLoadPrefs(user.id);
  await seLoadTrades(user.id);
  await seLoadPinned(user.id);
  await seLoadPriceAlerts(user.id);
  seInterceptSave(user.id);
  seSubscribeRealtime(user.id);
}

// ── REALTIME ──────────────────────────────────────────────────
let seRealtimeChannel=null;
function seSubscribeRealtime(userId){
  if(!seDb)return;
  if(seRealtimeChannel){seDb.removeChannel(seRealtimeChannel);seRealtimeChannel=null;}
  const existingPinned=seDb.getChannels().find(c=>c.topic.includes('pinned-changes'));
  if(existingPinned)seDb.removeChannel(existingPinned);
  seDb.channel('pinned-changes-'+userId)
    .on('postgres_changes',{event:'*',schema:'public',table:'pinned_sigs',filter:`user_id=eq.${userId}`},payload=>{
      const raw=payload.new?.sig_data||payload.new?.data;
      if(!raw)return;
      const current=localStorage.getItem('btc_pinned_sigs');
      if(current===raw)return;
      localStorage.setItem('btc_pinned_sigs',raw);
      if(typeof loadPinned==='function')loadPinned();
      if(typeof renderPinnedBanner==='function')renderPinnedBanner();
      setTimeout(()=>{if(typeof lastSigs!=='undefined'&&lastSigs&&typeof renderSigs==='function')renderSigs(lastSigs);},100);
    }).subscribe();

  // Subscripció a canvis de preferències en temps real
  seDb.channel('prefs-changes-'+userId)
    .on('postgres_changes',{event:'*',schema:'public',table:'user_prefs',filter:`user_id=eq.${userId}`},payload=>{
      if(payload.new&&payload.new.user_id!==seUser?.id)return;
      console.log('SE Realtime: prefs actualitzades');
      seApplyPrefs(payload.new);
    }).subscribe();

  // Subscripció Realtime alertes de preu
  seDb.channel('alerts-changes-'+userId)
    .on('postgres_changes',{event:'*',schema:'public',table:'price_alerts',filter:`user_id=eq.${userId}`},async()=>{
      await seLoadPriceAlerts(userId);
    }).subscribe();

  seRealtimeChannel=seDb.channel('trades-changes-'+userId)
    .on('postgres_changes',{event:'*',schema:'public',table:'trades',filter:`user_id=eq.${userId}`},payload=>{
      console.log('SE Realtime:',payload.eventType);
      if(typeof tradeHistory==='undefined')return;
      if(payload.eventType==='DELETE'){
        const deletedId=payload.old?.id;
        if(!deletedId)return;
        const exists=tradeHistory.some(x=>x.id===deletedId);
        if(!exists)return;
        tradeHistory=tradeHistory.filter(x=>x.id!==deletedId);
        if(typeof saveHistory==='function')saveHistory();
        if(typeof renderHistorial==='function')renderHistorial();
        if(typeof updateHistCount==='function')updateHistCount();
        return;
      }
      if(payload.eventType==='UPDATE'||payload.eventType==='INSERT'){
        const t=payload.new;
        if(!t)return;
        const localExists=tradeHistory.some(x=>x.id===t.id);
        if(!localExists&&payload.eventType==='UPDATE'){return;}
        const idx=tradeHistory.findIndex(x=>x.id===t.id);
        const mapped={
          id:t.id,dir:t.dir,source:t.source,et:t.et,
          tf:t.tf,lev:t.lev,ep:t.ep,sl:t.sl,tp1:t.tp1,tp2:t.tp2,
          sp:t.sp,r1:t.r1,r2:t.r2,result:t.result,
          closePrice:t.close_price,pnlPct:t.pnl_pct,
          partialDone:t.partial_done,partialPct:t.partial_pct,
          partialPnlPct:t.partial_pnl_pct||null,breakevenSL:t.breakeven_sl||null,
          notes:t.notes,openedAt:t.opened_at,closedAt:t.closed_at
        };
        if(idx>=0){tradeHistory[idx]=mapped;}
        else{tradeHistory.unshift(mapped);}
        if(typeof saveHistory==='function')saveHistory();
        if(typeof renderHistorial==='function')renderHistorial();
        if(typeof updateHistCount==='function')updateHistCount();
        if(typeof trade!=='undefined'&&trade&&trade.histId===t.id&&t.result!=='open'){
          trade=null;
          if(typeof drawTradeLines==='function')drawTradeLines(null);
        }
      }
    }).subscribe(status=>{console.log('SE Realtime status:',status);});
}

// ── QUAN ES FA LOGOUT ─────────────────────────────────────────
function seOnLogout(){
  console.log('SE Sync: Logout');
  seUser=null;
  window.seUser=null;
  seUpdateLoginBtn(false,null);
  if(typeof seUpdateProfileMenu==='function')seUpdateProfileMenu(null);
  seShowIndicator(false);
}

// ── BOTÓ LOGIN ────────────────────────────────────────────────
function seInsertLoginBtn(){
  if(document.getElementById('se-login-btn'))return;
  const topbar=document.querySelector('.topbar');
  if(!topbar)return;
  const btn=document.createElement('button');
  btn.id='se-login-btn';
  btn.style.cssText='font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #ddd;background:#fff;color:#444;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;font-weight:500;transition:all .15s;white-space:nowrap;';
  btn.innerHTML='<svg width="14" height="14" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-21 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.6 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.6 0 10.6-1.9 14.5-5.1l-6.7-5.5C29.8 37 27 38 24 38c-5.8 0-10.6-3.9-12.3-9.3l-7 5.4C8.1 41.8 15.5 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.9 2.8-2.8 5.1-5.3 6.7l6.7 5.5C41.5 37.3 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/></svg>Login';
  btn.onclick=seLoginGoogle;
  topbar.appendChild(btn);
}

function seUpdateLoginBtn(loggedIn,user){
  const btn=document.getElementById('se-login-btn');
  if(!btn)return;
  if(loggedIn&&user){
    const name=user.user_metadata?.name||user.email.split('@')[0];
    const avatar=user.user_metadata?.avatar_url;
    btn.innerHTML=`${avatar?`<img src="${avatar}" style="width:16px;height:16px;border-radius:50%">`:''}<span>${name}</span><span style="color:#999;font-size:9px">✕</span>`;
    btn.style.cssText='font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #a5d6a7;background:#e8f5e9;color:#1b5e20;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;font-weight:500;transition:all .15s;white-space:nowrap;';
    btn.title='Clic para cerrar sesión';
    btn.onclick=seLogout;
  }else{
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-21 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.6 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.6 0 10.6-1.9 14.5-5.1l-6.7-5.5C29.8 37 27 38 24 38c-5.8 0-10.6-3.9-12.3-9.3l-7 5.4C8.1 41.8 15.5 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.9 2.8-2.8 5.1-5.3 6.7l6.7 5.5C41.5 37.3 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/></svg>Login';
    btn.style.cssText='font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #ddd;background:#fff;color:#444;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;font-weight:500;transition:all .15s;white-space:nowrap;';
    btn.onclick=seLoginGoogle;
  }
}

// ── APLICAR PREFERÈNCIES AL DOM ───────────────────────────────
function seApplyPrefs(data){
  if(!data)return;
  // Apalancament
  if(data.lev&&typeof lev!=='undefined'){
    lev=data.lev;
    document.querySelectorAll('.lev-btn').forEach(b=>b.classList.toggle('active',+b.dataset.lev===lev));
    if(typeof updLev==='function')updLev();
  }
  // Timeframe
  if(data.tf&&typeof tf!=='undefined'&&data.tf!==tf){
    tf=data.tf;
    document.querySelectorAll('.tf').forEach(b=>b.classList.toggle('active',b.dataset.tf===tf));
    if(typeof updTFinfo==='function')updTFinfo();
    if(typeof connectWS==='function')connectWS(tf);
  }
  // Capital disponible
  if(data.capital){
    const el=document.getElementById('calc-capital');
    if(el){el.value=data.capital;}
  }
  // Capital a usar
  if(data.capital_usar){
    const el=document.getElementById('calc-capital-usar');
    if(el){el.value=data.capital_usar;}
  }
  // Risc per trade
  if(data.riesgo){
    const el=document.getElementById('calc-riesgo');
    if(el){el.value=data.riesgo;}
  }
  // Filtres OB/FVG/Retest
  if(typeof data.use_ob!=='undefined'&&typeof useOB!=='undefined'){
    useOB=!!data.use_ob;
    const cb=document.getElementById('cob');
    if(cb){cb.checked=useOB;document.getElementById('lob').className='ecb'+(useOB?' ob-on':'');}
  }
  if(typeof data.use_fvg!=='undefined'&&typeof useFVG!=='undefined'){
    useFVG=!!data.use_fvg;
    const cb=document.getElementById('cfvg');
    if(cb){cb.checked=useFVG;document.getElementById('lfvg').className='ecb'+(useFVG?' fvg-on':'');}
  }
  if(typeof data.use_rt!=='undefined'&&typeof useRT!=='undefined'){
    useRT=!!data.use_rt;
    const cb=document.getElementById('crt');
    if(cb){cb.checked=useRT;document.getElementById('lrt').className='ecb'+(useRT?' rt-on':'');}
  }
  // Recalcular
  if(typeof calcUpdate==='function')calcUpdate();
  if(typeof update==='function')setTimeout(update,100);
  console.log('SE Sync: Preferencias aplicadas ✓');
}

// ── CARREGAR PREFERÈNCIES ─────────────────────────────────────
async function seLoadPrefs(userId){
  try{
    const{data}=await seDb.from('user_prefs').select('*').eq('user_id',userId).maybeSingle();
    if(!data)return;
    seApplyPrefs(data);
    console.log('SE Sync: Preferencias cargadas ✓');
  }catch(e){console.log('SE Sync loadPrefs error:',e.message);}
}

// ── GUARDAR PREFERÈNCIES ──────────────────────────────────────
async function seSavePrefs(userId){
  if(!seDb||!userId)return;
  try{
    const capital=parseFloat(document.getElementById('calc-capital')?.value)||1000;
    const riesgo=parseFloat(document.getElementById('calc-riesgo')?.value)||2;
    const capitalUsar=parseFloat(document.getElementById('calc-capital-usar')?.value)||null;
    await seDb.from('user_prefs').upsert({
      user_id:userId,
      lev:typeof lev!=='undefined'?lev:2,
      tf:typeof tf!=='undefined'?tf:'1m',
      use_ob:typeof useOB!=='undefined'?useOB:true,
      use_fvg:typeof useFVG!=='undefined'?useFVG:false,
      use_rt:typeof useRT!=='undefined'?useRT:false,
      capital,
      capital_usar:capitalUsar,
      riesgo,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
  }catch(e){console.log('SE seSavePrefs error:',e.message);}
}

// ── CARREGAR TRADES ───────────────────────────────────────────
async function seLoadTrades(userId){
  try{
    const{data,error}=await seDb.from('trades').select('*').eq('user_id',userId).order('opened_at',{ascending:false}).limit(100);
    if(error||!data||!data.length)return;
    const cloudTrades=data.map(t=>({
      id:t.id,dir:t.dir,source:t.source,et:t.et,
      tf:t.tf,lev:t.lev,ep:t.ep,sl:t.sl,tp1:t.tp1,tp2:t.tp2,
      sp:t.sp,r1:t.r1,r2:t.r2,result:t.result,
      closePrice:t.close_price,pnlPct:t.pnl_pct,
      partialDone:t.partial_done,partialPct:t.partial_pct,
      notes:t.notes,openedAt:t.opened_at,closedAt:t.closed_at
    }));
    if(typeof tradeHistory!=='undefined'){
      let deletedIds=new Set();
      try{deletedIds=new Set(JSON.parse(localStorage.getItem('btc_deleted_trades')||'[]'));}catch(e){}
      for(const id of Object.keys(deletedIds)){await seDeleteTrade(userId,id);}
      const localIds=new Set(tradeHistory.map(t=>t.id));
      const newTrades=cloudTrades.filter(t=>!localIds.has(t.id)&&!deletedIds.has(t.id));
      if(newTrades.length>0){
        tradeHistory=[...tradeHistory,...newTrades].sort((a,b)=>new Date(b.openedAt||0)-new Date(a.openedAt||0));
        if(typeof saveHistory==='function')saveHistory();
        if(typeof renderHistorial==='function')renderHistorial();
        if(typeof updateHistCount==='function')updateHistCount();
      }
    }
    const openTrade=cloudTrades.find(t=>t.result==='open');
    if(openTrade&&typeof trade!=='undefined'&&!trade){
      trade={dir:openTrade.dir,e:openTrade.ep,sl:openTrade.sl,tp1:openTrade.tp1,tp2:openTrade.tp2,lev:openTrade.lev,tf:openTrade.tf,ep:openTrade.ep,sp:openTrade.sp,r1:openTrade.r1,r2:openTrade.r2,source:openTrade.source,et:openTrade.et,partialDone:openTrade.partialDone||false,histId:openTrade.id};
      setTimeout(()=>{if(typeof drawTradeLines==='function'&&trade)drawTradeLines(trade);if(typeof renderHistorial==='function')renderHistorial();},1000);
    }
    console.log('SE Sync: '+cloudTrades.length+' trades cargados ✓');
  }catch(e){console.log('SE Sync loadTrades error:',e.message);}
}

// ── GUARDAR TRADE ─────────────────────────────────────────────
async function seSaveTrade(userId,t){
  if(!seDb||!userId||!t)return;
  try{
    await seDb.from('trades').upsert({
      id:t.id,user_id:userId,dir:t.dir,source:t.source,et:t.et,
      tf:t.tf,lev:t.lev,ep:t.ep,sl:t.sl,tp1:t.tp1,tp2:t.tp2,
      sp:t.sp,r1:t.r1,r2:t.r2,result:t.result,
      close_price:t.closePrice||null,pnl_pct:t.pnlPct||null,
      partial_done:t.partialDone||false,partial_pct:t.partialPct||null,
      partial_pnl_pct:t.partialPnlPct||null,breakeven_sl:t.breakevenSL||null,
      notes:t.notes||null,opened_at:t.openedAt||new Date().toISOString(),closed_at:t.closedAt||null
    });
  }catch(e){console.log('SE seSaveTrade error:',e.message);}
}

// ── ELIMINAR TRADE ────────────────────────────────────────────
async function seDeleteTrade(userId,tradeId){
  if(!seDb||!userId||!tradeId)return;
  try{
    await seDb.from('trades').delete().eq('id',tradeId).eq('user_id',userId);
    console.log('SE Sync: trade eliminado ✓',tradeId);
  }catch(e){console.log('SE Sync delete error:',e.message);}
}

// ── PINNED SIGS ───────────────────────────────────────────────
async function seSavePinned(userId,raw){
  if(!seDb||!userId)return;
  try{
    const{data:existing}=await seDb.from('pinned_sigs').select('id').eq('user_id',userId).maybeSingle();
    if(existing){
      await seDb.from('pinned_sigs').update({sig_data:raw||'[]',data:raw||'[]',updated_at:new Date().toISOString()}).eq('user_id',userId);
    }else{
      await seDb.from('pinned_sigs').insert({user_id:userId,sig_data:raw||'[]',data:raw||'[]',updated_at:new Date().toISOString()});
    }
  }catch(e){console.log('seSavePinned error:',e.message);}
}

async function seLoadPinned(userId){
  if(!seDb||!userId)return;
  try{
    const{data}=await seDb.from('pinned_sigs').select('*').eq('user_id',userId).maybeSingle();
    if(!data)return;
    const raw=data.sig_data||data.data;
    if(!raw)return;
    const current=localStorage.getItem('btc_pinned_sigs');
    if(current===raw)return;
    localStorage.setItem('btc_pinned_sigs',raw);
    if(typeof loadPinned==='function')loadPinned();
    if(typeof renderPinnedBanner==='function')renderPinnedBanner();
    setTimeout(()=>{if(typeof lastSigs!=='undefined'&&lastSigs&&typeof renderSigs==='function')renderSigs(lastSigs);},100);
    console.log('SE Sync: Pinned sigs cargadas ✓');
  }catch(e){console.log('SE Sync loadPinned error:',e.message);}
}

// ── INTERCEPTAR GUARDAT LOCAL ─────────────────────────────────
function seInterceptSave(userId){
  let lastPrefs=localStorage.getItem('btc_dashboard_prefs_v1');
  let lastHistoryStr=localStorage.getItem('btc_trade_history_v1');
  let lastTradesMap=seParseTradesMap(lastHistoryStr);
  let lastPinned=localStorage.getItem('btc_pinned_sigs');

  let lastPriceAlerts=localStorage.getItem('btc_price_alerts');

  setInterval(async()=>{
    if(!seUser)return;
    const currentPrefs=localStorage.getItem('btc_dashboard_prefs_v1');
    if(currentPrefs!==lastPrefs){lastPrefs=currentPrefs;await seSavePrefs(userId);}
    const currentPinned=localStorage.getItem('btc_pinned_sigs');
    if(currentPinned!==lastPinned){lastPinned=currentPinned;await seSavePinned(userId,currentPinned);}
    const currentAlerts=localStorage.getItem('btc_price_alerts');
    if(currentAlerts!==lastPriceAlerts){lastPriceAlerts=currentAlerts;await seSavePriceAlerts(userId);}
    const currentHistoryStr=localStorage.getItem('btc_trade_history_v1');
    if(currentHistoryStr!==lastHistoryStr){
      const currentMap=seParseTradesMap(currentHistoryStr);
      for(const id of Object.keys(lastTradesMap)){
        if(!currentMap[id]){
          await seDeleteTrade(userId,id);
          try{
            const del=JSON.parse(localStorage.getItem('btc_deleted_trades')||'[]');
            if(!del.includes(id)){del.push(id);localStorage.setItem('btc_deleted_trades',JSON.stringify(del));}
          }catch(e){}
        }
      }
      for(const [id,t] of Object.entries(currentMap)){
        const prev=lastTradesMap[id];
        if(!prev||prev.result!==t.result||prev.closePrice!==t.closePrice||prev.pnlPct!==t.pnlPct||prev.partialDone!==t.partialDone){
          await seSaveTrade(userId,t);
        }
      }
      lastHistoryStr=currentHistoryStr;
      lastTradesMap=currentMap;
    }
  },2000);
}

function seParseTradesMap(str){
  try{const arr=JSON.parse(str)||[];const map={};arr.forEach(t=>{if(t.id)map[t.id]=t;});return map;}
  catch(e){return{};}
}

// ── INDICADOR VISUAL ──────────────────────────────────────────
function seShowIndicator(ok){
  let el=document.getElementById('se-sync-dot');
  if(!el){
    const tfBar=document.querySelector('.tf-bar');
    if(tfBar){el=document.createElement('span');el.id='se-sync-dot';el.style.cssText='font-size:9px;margin-left:6px;cursor:default;';tfBar.appendChild(el);}
  }
  if(el){el.textContent=ok?'☁️':'';el.title=ok?'Sincronizado con la nube':'';}
}

// ── ALERTES DE PREU ───────────────────────────────────────────
async function seSavePriceAlerts(userId){
  if(!seDb||!userId)return;
  try{
    const alerts=JSON.parse(localStorage.getItem('btc_price_alerts')||'[]');
    await seDb.from('price_alerts').delete().eq('user_id',userId);
    if(!alerts.length){console.log('SE Sync: alertes esborrades ✓');return;}
    const rows=alerts.map(a=>({id:String(a.id),user_id:userId,price:parseFloat(a.price),note:a.note||null,created_at:a.createdAt||new Date().toISOString()}));
    const{error}=await seDb.from('price_alerts').insert(rows);
    if(error)console.log('seSavePriceAlerts error:',error.message);
    else console.log('SE Sync: '+alerts.length+' alertes guardades ✓');
  }catch(e){console.log('seSavePriceAlerts error:',e.message);}
}

async function seLoadPriceAlerts(userId){
  if(!seDb||!userId)return;
  try{
    const{data,error}=await seDb.from('price_alerts').select('*').eq('user_id',userId);
    if(error){console.log('seLoadPriceAlerts error:',error.message);return;}
    const alerts=data?.length?data.map(a=>({id:parseInt(a.id)||a.id,price:parseFloat(a.price),note:a.note||'',triggered:false,createdAt:a.created_at})):[];
    localStorage.setItem('btc_price_alerts',JSON.stringify(alerts));
    if(typeof priceAlerts!=='undefined'){
      priceAlerts=alerts;
      if(typeof updatePriceAlertsCount==='function')updatePriceAlertsCount();
      if(typeof drawPriceAlertLines==='function')drawPriceAlertLines();
      if(typeof renderPriceAlerts==='function')renderPriceAlerts();
    }
    console.log('SE Sync: '+alerts.length+' alertes carregades ✓');
  }catch(e){console.log('seLoadPriceAlerts error:',e.message);}
}
