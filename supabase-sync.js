// ── SignalEdge Supabase Sync v2 — Google OAuth ────────────────
// Fitxer independent — no modifica el codi principal
// Si falla, el dashboard segueix funcionant normalment

const SE_SUPA_URL='https://aivhwxixdjfyckvplimt.supabase.co';
const SE_SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdmh3eGl4ZGpmeWNrdnBsaW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzgzOTYsImV4cCI6MjA5NDgxNDM5Nn0.6JeBBItEGNaVP7l7F-90e-QE1INr_FTJV00aUl4WGrc';

let seDb=null;
let seUser=null; // usuari autenticat (Google) o null

// ── INICIALITZAR ──────────────────────────────────────────────
window.addEventListener('load',()=>{
  setTimeout(async()=>{
    try{
      if(typeof supabase==='undefined'){
        console.log('SE Sync: Supabase no disponible');
        return;
      }
      seDb=supabase.createClient(SE_SUPA_URL,SE_SUPA_KEY);

      // Inserir botó de login a la topbar
      seInsertLoginBtn();

      // Comprovar si hi ha sessió activa (callback de Google o sessió guardada)
      const { data: { session } } = await seDb.auth.getSession();
      if(session?.user){
        seUser=session.user;
        seOnLogin(seUser);
      }

      // Escoltar canvis d'autenticació (login/logout)
      seDb.auth.onAuthStateChange(async(event, session)=>{
        if(event==='SIGNED_IN' && session?.user){
          seUser=session.user;
          seOnLogin(seUser);
        } else if(event==='SIGNED_OUT'){
          seUser=null;
          seOnLogout();
        }
      });

    }catch(e){
      console.log('SE Sync error:', e.message);
      seShowIndicator(false);
    }
  }, 1500);
});

// ── LOGIN AMB GOOGLE ──────────────────────────────────────────
async function seLoginGoogle(){
  if(!seDb)return;
  try{
    const { error } = await seDb.auth.signInWithOAuth({
      provider: 'google',
      options:{
        redirectTo: 'https://signaledge-app.github.io/signaledge'
      }
    });
    if(error) console.log('SE Login error:', error.message);
  }catch(e){console.log('SE Login error:', e.message);}
}

// ── LOGOUT ────────────────────────────────────────────────────
async function seLogout(){
  if(!seDb)return;
  try{
    await seDb.auth.signOut();
  }catch(e){console.log('SE Logout error:', e.message);}
}

// ── QUAN ES FA LOGIN ──────────────────────────────────────────
async function seOnLogin(user){
  console.log('SE Sync: Login ✓', user.email);
  seUpdateLoginBtn(true, user);
  if(typeof seUpdateProfileMenu==='function') seUpdateProfileMenu(user);
  seShowIndicator(true);

  // Carregar dades del núvol
  await seLoadPrefs(user.id);
  await seLoadTrades(user.id);
  await seLoadPinned(user.id);

  // Interceptar guardat local per sincronitzar
  seInterceptSave(user.id);

  // Escoltar canvis en temps real a la taula trades
  seSubscribeRealtime(user.id);
}

// ── REALTIME: escoltar canvis del núvol ───────────────────────
let seRealtimeChannel=null;
function seSubscribeRealtime(userId){
  if(!seDb)return;
  // Evitar subscripcions duplicades
  if(seRealtimeChannel){
    seDb.removeChannel(seRealtimeChannel);
    seRealtimeChannel=null;
  }
  // Realtime per pinned_sigs
  seDb.channel('pinned-changes-'+userId)
    .on('postgres_changes',{
      event:'*',schema:'public',table:'pinned_sigs',
      filter:`user_id=eq.${userId}`
    }, payload=>{
      console.log('SE Realtime: pinned actualitzat');
      const raw=payload.new?.data;
      if(!raw)return;
      const current=localStorage.getItem('btc_pinned_sigs');
      if(current===raw)return;
      localStorage.setItem('btc_pinned_sigs',raw);
      if(typeof loadPinned==='function')loadPinned();
      if(typeof renderPinnedBanner==='function')renderPinnedBanner();
    })
    .subscribe();

  seRealtimeChannel=seDb.channel('trades-changes-'+userId)
    .on('postgres_changes',{
      event:'*',
      schema:'public',
      table:'trades',
      filter:`user_id=eq.${userId}`
    }, payload=>{
      console.log('SE Realtime: canvi detectat', payload.eventType);
      const t=payload.new;
      if(!t||typeof tradeHistory==='undefined')return;

      if(payload.eventType==='UPDATE'||payload.eventType==='INSERT'){
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
        if(idx>=0){
          tradeHistory[idx]=mapped;
        } else {
          tradeHistory.unshift(mapped);
        }
        if(typeof saveHistory==='function')saveHistory();
        if(typeof renderHistorial==='function')renderHistorial();
        if(typeof updateHistCount==='function')updateHistCount();

        // Si el trade obert s'ha tancat remotament, tancar-lo també aquí
        if(typeof trade!=='undefined'&&trade&&trade.histId===t.id&&t.result!=='open'){
          trade=null;
          if(typeof drawTradeLines==='function')drawTradeLines(null);
          console.log('SE Realtime: trade tancat remotament ✓');
        }
      }
    })
    .subscribe(status=>{
      console.log('SE Realtime status:', status);
    });
}

// ── QUAN ES FA LOGOUT ─────────────────────────────────────────
function seOnLogout(){
  console.log('SE Sync: Logout');
  seUpdateLoginBtn(false, null);
  if(typeof seUpdateProfileMenu==='function') seUpdateProfileMenu(null);
  seShowIndicator(false);
}

// ── BOTÓ DE LOGIN ─────────────────────────────────────────────
function seInsertLoginBtn(){
  // Evitar duplicats
  if(document.getElementById('se-login-btn')) return;

  // Trobar la topbar
  const topbar = document.querySelector('.topbar');
  if(!topbar) return;

  const btn = document.createElement('button');
  btn.id='se-login-btn';
  btn.style.cssText=`
    font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #ddd;
    background:#fff;color:#444;cursor:pointer;font-family:inherit;
    display:flex;align-items:center;gap:5px;font-weight:500;
    transition:all .15s;white-space:nowrap;
  `;
  btn.innerHTML='<svg width="14" height="14" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-21 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.6 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.6 0 10.6-1.9 14.5-5.1l-6.7-5.5C29.8 37 27 38 24 38c-5.8 0-10.6-3.9-12.3-9.3l-7 5.4C8.1 41.8 15.5 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.9 2.8-2.8 5.1-5.3 6.7l6.7 5.5C41.5 37.3 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/></svg>Login';
  btn.onclick=seLoginGoogle;
  topbar.appendChild(btn);
}

function seUpdateLoginBtn(loggedIn, user){
  const btn=document.getElementById('se-login-btn');
  if(!btn)return;
  if(loggedIn && user){
    const name = user.user_metadata?.name || user.email.split('@')[0];
    const avatar = user.user_metadata?.avatar_url;
    btn.innerHTML=`${avatar?`<img src="${avatar}" style="width:16px;height:16px;border-radius:50%">`:''}<span>${name}</span><span style="color:#999;font-size:9px">✕</span>`;
    btn.style.background='#e8f5e9';
    btn.style.borderColor='#a5d6a7';
    btn.style.color='#1b5e20';
    btn.title='Clic per tancar sessió';
    btn.onclick=seLogout;
  } else {
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 48 48"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-21 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.6 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.6 0 10.6-1.9 14.5-5.1l-6.7-5.5C29.8 37 27 38 24 38c-5.8 0-10.6-3.9-12.3-9.3l-7 5.4C8.1 41.8 15.5 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-.9 2.8-2.8 5.1-5.3 6.7l6.7 5.5C41.5 37.3 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/></svg>Login';
    btn.style.background='#fff';
    btn.style.borderColor='#ddd';
    btn.style.color='#444';
    btn.title='';
    btn.onclick=seLoginGoogle;
  }
}

// ── CARREGAR PREFERÈNCIES ─────────────────────────────────────
async function seLoadPrefs(userId){
  try{
    const{data,error}=await seDb.from('user_prefs').select('*').eq('user_id',userId).maybeSingle();
    if(!data)return;
    if(typeof lev!=='undefined'&&data.lev){
      lev=data.lev;
      document.querySelectorAll('.lev-btn').forEach(b=>b.classList.toggle('active',+b.dataset.lev===lev));
      if(typeof updLev==='function')updLev();
    }
    if(typeof tf!=='undefined'&&data.tf){
      tf=data.tf;
      document.querySelectorAll('.tf').forEach(b=>b.classList.toggle('active',b.dataset.tf===tf));
      if(typeof updTFinfo==='function')updTFinfo();
      if(typeof connectWS==='function')connectWS(tf);
    }
    if(data.capital){const el=document.getElementById('calc-capital');if(el)el.value=data.capital;}
    if(data.riesgo){const el=document.getElementById('calc-riesgo');if(el)el.value=data.riesgo;}
    if(typeof calcUpdate==='function')calcUpdate();
    console.log('SE Sync: Preferències carregades ✓');
  }catch(e){console.log('SE Sync loadPrefs error:',e.message);}
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
      const localIds=new Set(tradeHistory.map(t=>t.id));
      const newTrades=cloudTrades.filter(t=>!localIds.has(t.id));
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
    console.log('SE Sync: '+cloudTrades.length+' trades carregats ✓');
  }catch(e){console.log('SE Sync loadTrades error:',e.message);}
}

// ── GUARDAR PREFERÈNCIES ──────────────────────────────────────
async function seSavePrefs(userId){
  if(!seDb||!userId)return;
  try{
    const capital=parseFloat(document.getElementById('calc-capital')?.value)||1000;
    const riesgo=parseFloat(document.getElementById('calc-riesgo')?.value)||2;
    await seDb.from('user_prefs').upsert({
      user_id:userId,lev:typeof lev!=='undefined'?lev:2,tf:typeof tf!=='undefined'?tf:'1m',
      use_ob:typeof useOB!=='undefined'?useOB:true,use_fvg:typeof useFVG!=='undefined'?useFVG:false,
      use_rt:typeof useRT!=='undefined'?useRT:false,capital,riesgo,
      calc_mode:typeof calcMode!=='undefined'?calcMode:'pct',updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
  }catch(e){}
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
  }catch(e){}
}


// ── PINNED SIGS ───────────────────────────────────────────────
async function seSavePinned(userId, raw){
  if(!seDb||!userId)return;
  try{
    await seDb.from('pinned_sigs').upsert({
      user_id:userId,
      data:raw||'[]',
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
  }catch(e){}
}

async function seLoadPinned(userId){
  if(!seDb||!userId)return;
  try{
    const{data,error}=await seDb.from('pinned_sigs').select('*').eq('user_id',userId).maybeSingle();
    if(!data||!data.data)return;
    const current=localStorage.getItem('btc_pinned_sigs');
    if(current===data.data)return; // ja és igual
    localStorage.setItem('btc_pinned_sigs',data.data);
    // Recarregar les pinned al dashboard
    if(typeof loadPinned==='function')loadPinned();
    if(typeof renderPinnedBanner==='function')renderPinnedBanner();
    console.log('SE Sync: Pinned sigs carregades ✓');
  }catch(e){console.log('SE Sync loadPinned error:',e.message);}
}

// ── INTERCEPTAR GUARDAT LOCAL ─────────────────────────────────
function seInterceptSave(userId){
  let lastPrefs=localStorage.getItem('btc_dashboard_prefs_v1');
  let lastHistoryStr=localStorage.getItem('btc_trade_history_v1');
  let lastTradesMap=seParseTradesMap(lastHistoryStr);

  let lastPinned=localStorage.getItem('btc_pinned_sigs');

  setInterval(async()=>{
    if(!seUser)return;

    // Preferències
    const currentPrefs=localStorage.getItem('btc_dashboard_prefs_v1');
    if(currentPrefs!==lastPrefs){lastPrefs=currentPrefs;await seSavePrefs(userId);}

    // Pinned sigs
    const currentPinned=localStorage.getItem('btc_pinned_sigs');
    if(currentPinned!==lastPinned){
      lastPinned=currentPinned;
      await seSavePinned(userId,currentPinned);
    }

    // Trades — detectar quins han canviat comparant per id+result+closePrice
    const currentHistoryStr=localStorage.getItem('btc_trade_history_v1');
    if(currentHistoryStr!==lastHistoryStr){
      lastHistoryStr=currentHistoryStr;
      const currentMap=seParseTradesMap(currentHistoryStr);
      for(const [id,t] of Object.entries(currentMap)){
        const prev=lastTradesMap[id];
        // Guardar si és nou o ha canviat result/closePrice/pnlPct/partialDone
        if(!prev||prev.result!==t.result||prev.closePrice!==t.closePrice||prev.pnlPct!==t.pnlPct||prev.partialDone!==t.partialDone){
          await seSaveTrade(userId,t);
        }
      }
      lastTradesMap=currentMap;
    }
  },2000);
}

function seParseTradesMap(str){
  try{
    const arr=JSON.parse(str)||[];
    const map={};
    arr.forEach(t=>{if(t.id)map[t.id]=t;});
    return map;
  }catch(e){return{};}
}

// ── INDICADOR VISUAL ──────────────────────────────────────────
function seShowIndicator(ok){
  let el=document.getElementById('se-sync-dot');
  if(!el){
    const tfBar=document.querySelector('.tf-bar');
    if(tfBar){
      el=document.createElement('span');
      el.id='se-sync-dot';
      el.style.cssText='font-size:9px;margin-left:6px;cursor:default;';
      tfBar.appendChild(el);
    }
  }
  if(el){
    el.textContent=ok?'☁️':'';
    el.title=ok?'Sincronizado con la nube':'';
  }
}
