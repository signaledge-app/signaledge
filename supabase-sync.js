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
    await seDb.auth.signInWithOAuth({provider:'google',options:{redirectTo:'https://signaledgeapp.com/app'}});
  }catch(e){console.log('SE Login error:',e.message);}
}
async function seLogout(){
  if(!seDb)return;
  try{await seDb.auth.signOut();}catch(e){}
}

// ── VERIFICACIÓ DE SUBSCRIPCIÓ ────────────────────────────────
async function seCheckSubscription(user){
  if(!seDb||!user)return false;
  try{
    const{data,error}=await seDb
      .from('subscriptions')
      .select('status,expires_at,plan')
      .eq('email',user.email)
      .maybeSingle();
    if(error||!data){
      window._userIsPro=false;
      console.log('SE Sync: sense subscripció');
      return false;
    }
    const isPro=data.status==='active'&&(!data.expires_at||new Date(data.expires_at)>new Date());
    window._userIsPro=isPro;
    console.log('SE Sync: subscripció →',data.status,'isPro:',isPro);
    if(seUser){
      await seDb.from('user_prefs').upsert({
        user_id:seUser.id,
        is_pro:isPro,
        updated_at:new Date().toISOString()
      },{onConflict:'user_id'});
    }
    return isPro;
  }catch(e){
    console.log('SE Sync checkSubscription error:',e.message);
    window._userIsPro=false;
    return false;
  }
}

// ── QUAN ES FA LOGIN ──────────────────────────────────────────
async function seOnLogin(user){
  console.log('SE Sync: Login ✓',user.email);
  seUser=user;
  window.seUser=user;
  seUpdateLoginBtn(true,user);
  if(typeof seUpdateProfileMenu==='function')seUpdateProfileMenu(user);
  seShowIndicator(true);
  // Tancar pantalla de login si estava oberta
  const loginOverlay=document.getElementById('se-login-overlay');
  if(loginOverlay)loginOverlay.remove();
  // Registrar primer login per al trial
  const firstLoginKey='se_first_login_'+user.email;
  if(!localStorage.getItem(firstLoginKey)){
    localStorage.setItem(firstLoginKey,new Date().toISOString());
  }
  await seCheckSubscription(user);
  // Comprovar trial
  seCheckTrialOrPro(user);
  await seLoadPrefs(user.id);
  await seLoadTrades(user.id);
  await seLoadPinned(user.id);
  await seLoadPriceAlerts(user.id);
  seInterceptSave(user.id);
  seSubscribeRealtime(user.id);
  // ── EMAIL DE BENVINGUDA (primer login) ────────────────────
  const firstKey='se_welcomed_'+user.email;
  if(!localStorage.getItem(firstKey)){
    localStorage.setItem(firstKey,'1');
    try{
      await fetch('https://aivhwxixdjfyckvplimt.supabase.co/functions/v1/send-welcome-email',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+SE_SUPA_KEY},
        body:JSON.stringify({
          email:user.email,
          name:user.user_metadata?.name||user.user_metadata?.full_name||''
        })
      });
      console.log('SE Sync: Email benvinguda enviat ✓');
    }catch(e){console.log('SE Sync: Error email benvinguda',e.message);}
  }
}

// ── REALTIME ──────────────────────────────────────────────────
let seRealtimeChannel=null;
function seSubscribeRealtime(userId){
  if(!seDb)return;
  if(seRealtimeChannel){seDb.removeChannel(seRealtimeChannel);seRealtimeChannel=null;}
  // Eliminar canals existents per evitar duplicats
  seDb.getChannels().forEach(c=>{
    if(c.topic.includes('pinned-changes')||c.topic.includes('prefs-changes')||c.topic.includes('alerts-changes')){
      seDb.removeChannel(c);
    }
  });
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

  seDb.channel('prefs-changes-'+userId)
    .on('postgres_changes',{event:'*',schema:'public',table:'user_prefs',filter:`user_id=eq.${userId}`},payload=>{
      if(payload.new&&payload.new.user_id!==seUser?.id)return;
      console.log('SE Realtime: prefs actualitzades');
      seApplyPrefs(payload.new);
    }).subscribe();

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
          tf:t.tf,lev:t.lev,e:t.e||t.ep,ep:t.ep,sl:t.sl,tp1:t.tp1,tp2:t.tp2,
          sp:t.sp,r1:t.r1,r2:t.r2,result:t.result,pair:t.pair||'BTCUSDT',
          closePrice:t.close_price,pnlPct:t.pnl_pct,
          partialDone:t.partial_done,partialPct:t.partial_pct,
          partialPnlPct:t.partial_pnl_pct||null,breakevenSL:t.breakeven_sl||null,
          notes:t.notes,openedAt:t.opened_at,closedAt:t.closed_at,
          date:t.opened_at?new Date(t.opened_at).toLocaleString('es',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''
        };
        if(idx>=0){tradeHistory[idx]=mapped;}
        else{tradeHistory.unshift(mapped);}
        if(typeof saveHistory==='function')saveHistory();
        if(typeof renderHistorial==='function')renderHistorial();
        if(typeof updateHistCount==='function')updateHistCount();
        if(typeof trade!=='undefined'&&trade&&trade.histId===t.id){
          if(t.result!=='open'){
            trade=null;
            if(typeof activeTradeId!=='undefined')activeTradeId=null;
            if(typeof autoClosePending!=='undefined')autoClosePending=false;
            if(typeof partialExecuted!=='undefined')partialExecuted=false;
            if(typeof drawTradeLines==='function')drawTradeLines(null);
            const bar=typeof document!=='undefined'?document.getElementById('parc-bar'):null;
            if(bar)bar.style.display='none';
            if(typeof renderOpenTrade==='function')renderOpenTrade();
            if(typeof renderDashTrades==='function')renderDashTrades();
          } else {
            trade.partialDone=t.partial_done||false;
            trade.partialPct=t.partial_pct||null;
            trade.partialPnlPct=t.partial_pnl_pct||null;
            trade.breakevenSL=t.breakeven_sl||null;
            if(t.partial_done&&t.breakeven_sl)trade.sl=t.breakeven_sl;
            trade.sl=t.sl||trade.sl;
            if(typeof drawTradeLines==='function')drawTradeLines(trade);
            if(typeof renderOpenTrade==='function')renderOpenTrade();
            if(typeof renderDashTrades==='function')renderDashTrades();
            if(typeof partialExecuted!=='undefined')partialExecuted=t.partial_done||false;
            console.log('SE Realtime: trade actiu sincronitzat (partialDone:'+trade.partialDone+')');
          }
        }
      }
    }).subscribe(status=>{console.log('SE Realtime status:',status);});
}

// ── QUAN ES FA LOGOUT ─────────────────────────────────────────
function seOnLogout(){
  console.log('SE Sync: Logout');
  seUser=null;
  window.seUser=null;
  window._userIsPro=false;
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
  if(data.lev&&typeof lev!=='undefined'){
    lev=data.lev;
    document.querySelectorAll('.lev-btn').forEach(b=>b.classList.toggle('active',+b.dataset.lev===lev));
    if(typeof updLev==='function')updLev();
  }
  if(data.tf&&typeof tf!=='undefined'&&data.tf!==tf){
    tf=data.tf;
    document.querySelectorAll('.tf').forEach(b=>b.classList.toggle('active',b.dataset.tf===tf));
    if(typeof updTFinfo==='function')updTFinfo();
    if(typeof connectWS==='function')connectWS(tf);
  }
  if(data.capital){
    const el=document.getElementById('calc-capital');
    if(el){el.value=data.capital;}
  }
  if(data.capital_usar){
    const el=document.getElementById('calc-capital-usar');
    if(el){el.value=data.capital_usar;}
  }
  if(data.riesgo){
    const el=document.getElementById('calc-riesgo');
    if(el){el.value=data.riesgo;}
  }
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
  if(typeof data.is_pro!=='undefined'){
    window._userIsPro=data.is_pro===true;
    console.log('SE Sync: is_pro='+window._userIsPro);
  }
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
      tf:t.tf,lev:t.lev,e:t.e||t.ep,ep:t.ep,sl:t.sl,tp1:t.tp1,tp2:t.tp2,
      sp:t.sp,r1:t.r1,r2:t.r2,result:t.result,pair:t.pair||'BTCUSDT',
      closePrice:t.close_price,pnlPct:t.pnl_pct,
      partialDone:t.partial_done,partialPct:t.partial_pct,
      partialPnlPct:t.partial_pnl_pct,breakevenSL:t.breakeven_sl,
      notes:t.notes,openedAt:t.opened_at,closedAt:t.closed_at,
      date:t.opened_at?new Date(t.opened_at).toLocaleString('es',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''
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
    const cp=typeof currentPair!=='undefined'?currentPair:'BTCUSDT';
    const openTrade=cloudTrades.find(t=>t.result==='open'&&(t.pair||'BTCUSDT')===cp);
    if(openTrade&&typeof trade!=='undefined'&&!trade){
      trade={dir:openTrade.dir,e:openTrade.e||openTrade.ep,sl:openTrade.sl,tp1:openTrade.tp1,tp2:openTrade.tp2,lev:openTrade.lev,tf:openTrade.tf,ep:openTrade.ep,sp:openTrade.sp,r1:openTrade.r1,r2:openTrade.r2,source:openTrade.source,et:openTrade.et,partialDone:openTrade.partialDone||false,pair:openTrade.pair||'BTCUSDT',histId:openTrade.id};
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
      tf:t.tf,lev:t.lev,e:t.e||t.ep,ep:t.ep,sl:t.sl,tp1:t.tp1,tp2:t.tp2,
      sp:t.sp,r1:t.r1,r2:t.r2,result:t.result,pair:t.pair||'BTCUSDT',
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

  const _prefFields=['calc-capital','calc-capital-usar','calc-riesgo'];
  _prefFields.forEach(id=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.addEventListener('focus',()=>{window._seUserEditing=true;});
    el.addEventListener('blur',()=>{setTimeout(()=>{window._seUserEditing=false;},3000);});
  });

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


// ── LOGIN OBLIGATORI ──────────────────────────────────────────
function seShowLoginWall(){
  if(document.getElementById('se-login-overlay'))return;
  const o=document.createElement('div');
  o.id='se-login-overlay';
  o.style.cssText='position:fixed;inset:0;background:linear-gradient(135deg,#0d1420,#0f1f3d);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:20px';
  o.innerHTML=`
    <div style="text-align:center;max-width:340px;width:100%">
      <div style="font-size:48px;margin-bottom:12px">📊</div>
      <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:6px;letter-spacing:-1px">SignalEdge</div>
      <div style="font-size:13px;color:#8a9ab5;margin-bottom:32px;line-height:1.6">Señales de trading BTC, ETH y SOL<br>en tiempo real. Gratis 30 días.</div>
      <button onclick="seLoginGoogle()" style="width:100%;padding:14px;border-radius:12px;border:none;background:#fff;color:#333;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:12px">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-21 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.6 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.6 0 10.6-1.9 14.5-5.1l-6.7-5.5C29.8 37 27 38 24 38c-5.8 0-10.6-3.9-12.3-9.3l-7 5.4C8.1 41.8 15.5 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.9 2.8-2.8 5.1-5.3 6.7l6.7 5.5C41.5 37.3 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/></svg>
        Continuar con Google
      </button>
      <div style="font-size:11px;color:#4a5a72;line-height:1.6">🔒 Solo usamos Google para identificarte.<br>No compartimos tus datos con nadie.</div>
    </div>`;
  document.body.appendChild(o);
}

function seCheckTrialOrPro(user){
  if(!user)return;
  // Si ja és PRO, no cal res
  if(window._userIsPro===true){
    seHidePaywall();
    return;
  }
  // Comprovar dies de trial
  const firstLoginKey='se_first_login_'+user.email;
  const firstLogin=localStorage.getItem(firstLoginKey);
  if(!firstLogin){
    // Primer cop — guardar data i donar accés
    localStorage.setItem(firstLoginKey,new Date().toISOString());
    seShowTrialBanner(30);
    return;
  }
  const daysUsed=Math.floor((Date.now()-new Date(firstLogin).getTime())/(1000*60*60*24));
  const daysLeft=30-daysUsed;
  if(daysLeft>0){
    seShowTrialBanner(daysLeft);
  }else{
    // Trial acabat → mostrar paywall
    seShowPaywall();
  }
}

function seShowTrialBanner(daysLeft){
  // Eliminar paywall si existia
  seHidePaywall();
  // Banner discret a la part superior
  let banner=document.getElementById('se-trial-banner');
  if(banner)banner.remove();
  if(daysLeft>7)return; // Només mostrar quan queden 7 dies o menys
  banner=document.createElement('div');
  banner.id='se-trial-banner';
  const urgent=daysLeft<=3;
  banner.style.cssText=`position:fixed;top:0;left:0;right:0;z-index:99999;background:${urgent?'#ef5350':'#2962ff'};color:#fff;padding:8px 16px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px`;
  banner.innerHTML=`<span>${urgent?'⚠️':'⏳'} Trial: te quedan <strong>${daysLeft} día${daysLeft!==1?'s':''}</strong> gratis</span><button onclick="typeof showUpgradeModal==='function'&&showUpgradeModal()" style="background:#fff;color:${urgent?'#ef5350':'#2962ff'};border:none;padding:3px 12px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Suscribirse →</button><button onclick="this.parentElement.remove()" style="background:transparent;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:14px;padding:0 4px">✕</button>`;
  document.body.appendChild(banner);
}

function seShowPaywall(){
  let o=document.getElementById('se-paywall-overlay');
  if(o)return;
  o=document.createElement('div');
  o.id='se-paywall-overlay';
  o.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:20px';
  o.innerHTML=`
    <div style="background:var(--card,#1a1d27);border:1px solid #2a2d3e;border-radius:20px;max-width:360px;width:100%;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6)">
      <div style="background:linear-gradient(135deg,#2962ff,#00d4ff);padding:28px 24px 24px;text-align:center">
        <div style="font-size:36px;margin-bottom:8px">⚡</div>
        <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">Trial finalizado</div>
        <div style="font-size:13px;color:rgba(255,255,255,.8)">Tu prueba gratuita de 30 días ha terminado</div>
      </div>
      <div style="padding:24px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
          <div style="background:#0d1420;border:2px solid #2962ff;border-radius:12px;padding:16px;text-align:center;cursor:pointer" onclick="window.open('https://tourayebra.gumroad.com/l/signaledgeapp-pro-mensual','_blank')">
            <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Mensual</div>
            <div style="font-size:24px;font-weight:800;color:#fff">€9.99</div>
            <div style="font-size:10px;color:#8a9ab5;margin-top:2px">al mes</div>
            <div style="margin-top:10px;background:#2962ff;color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Elegir</div>
          </div>
          <div style="background:#0d1420;border:2px solid #00d4ff;border-radius:12px;padding:16px;text-align:center;cursor:pointer;position:relative" onclick="window.open('https://tourayebra.gumroad.com/l/signaledgeapp-pro-anual','_blank')">
            <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#f57c00;color:#fff;font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">AHORRA 34%</div>
            <div style="font-size:10px;color:#8a9ab5;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Anual</div>
            <div style="font-size:24px;font-weight:800;color:#fff">€79</div>
            <div style="font-size:10px;color:#8a9ab5;margin-top:2px">al año · €6.58/mes</div>
            <div style="margin-top:10px;background:#00d4ff;color:#0d1420;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Elegir</div>
          </div>
        </div>
        <div style="font-size:11px;color:#4a5a72;line-height:1.8;margin-bottom:16px;text-align:center">
          ✅ BTC · ETH · SOL &nbsp;✅ Señales ilimitadas<br>✅ Historial sync &nbsp;✅ Alertas push
        </div>
        <div style="font-size:10px;color:#4a5a72;text-align:center">
          ¿Ya tienes suscripción? <button onclick="seCheckSubscription(seUser).then(()=>seCheckTrialOrPro(seUser))" style="background:none;border:none;color:#2962ff;cursor:pointer;font-size:10px;font-family:inherit;text-decoration:underline">Verificar aquí</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(o);
}

function seHidePaywall(){
  const o=document.getElementById('se-paywall-overlay');
  if(o)o.remove();
}