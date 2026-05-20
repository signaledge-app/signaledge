// ── SignalEdge Supabase Sync ──────────────────────────────────
// Fitxer independent — no modifica el codi principal
// Si falla, el dashboard segueix funcionant normalment

const SE_SUPA_URL='https://aivhwxixdjfyckvplimt.supabase.co';
const SE_SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdmh3eGl4ZGpmeWNrdnBsaW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzgzOTYsImV4cCI6MjA5NDgxNDM5Nn0.6JeBBItEGNaVP7l7F-90e-QE1INr_FTJV00aUl4WGrc';

let seDb=null;

// ID únic per dispositiu (anònim)
function getSeUserId(){
  let uid=localStorage.getItem('se_user_id');
  if(!uid){
    uid='user_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    localStorage.setItem('se_user_id',uid);
  }
  return uid;
}

// Inicialitzar quan la pàgina estigui llesta
window.addEventListener('load',()=>{
  setTimeout(async()=>{
    try{
      // Esperar que la llibreria Supabase estigui disponible
      if(typeof supabase==='undefined'){
        console.log('SE Sync: Supabase no disponible');
        return;
      }
      seDb=supabase.createClient(SE_SUPA_URL,SE_SUPA_KEY);
      const userId=getSeUserId();
      console.log('SE Sync: Connectat ✓ userId='+userId);

      // 1. Carregar preferències del núvol
      await seLoadPrefs(userId);

      // 2. Carregar trades del núvol
      await seLoadTrades(userId);

      // 3. Mostrar indicador
      seShowIndicator(true);

      // 4. Interceptar guardat local per sincronitzar
      seInterceptSave(userId);

    }catch(e){
      console.log('SE Sync error:', e.message);
      seShowIndicator(false);
    }
  }, 2000); // esperar 2s que el dashboard estigui inicialitzat
});

// ── CARREGAR PREFERÈNCIES ─────────────────────────────────────
async function seLoadPrefs(userId){
  try{
    const{data,error}=await seDb.from('user_prefs').select('*').eq('user_id',userId).single();
    if(error||!data)return;

    // Aplicar preferències
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
    if(data.capital){
      const el=document.getElementById('calc-capital');
      if(el)el.value=data.capital;
    }
    if(data.riesgo){
      const el=document.getElementById('calc-riesgo');
      if(el)el.value=data.riesgo;
    }
    if(typeof calcUpdate==='function')calcUpdate();
    console.log('SE Sync: Preferències carregades ✓');
  }catch(e){console.log('SE Sync loadPrefs error:',e.message);}
}

// ── CARREGAR TRADES ───────────────────────────────────────────
async function seLoadTrades(userId){
  try{
    const{data,error}=await seDb.from('trades').select('*').eq('user_id',userId).order('opened_at',{ascending:false}).limit(100);
    if(error||!data||!data.length)return;

    // Convertir format cloud → format local
    const cloudTrades=data.map(t=>({
      id:t.id,dir:t.dir,source:t.source,et:t.et,
      tf:t.tf,lev:t.lev,ep:t.ep,sl:t.sl,tp1:t.tp1,tp2:t.tp2,
      sp:t.sp,r1:t.r1,r2:t.r2,result:t.result,
      closePrice:t.close_price,pnlPct:t.pnl_pct,
      partialDone:t.partial_done,partialPct:t.partial_pct,
      notes:t.notes,openedAt:t.opened_at,closedAt:t.closed_at
    }));

    // Fusionar amb trades locals (prioritzar el núvol)
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

    // Restaurar trade obert
    const openTrade=cloudTrades.find(t=>t.result==='open');
    if(openTrade&&typeof trade!=='undefined'&&!trade){
      trade={
        dir:openTrade.dir,e:openTrade.ep,sl:openTrade.sl,
        tp1:openTrade.tp1,tp2:openTrade.tp2,lev:openTrade.lev,
        tf:openTrade.tf,ep:openTrade.ep,sp:openTrade.sp,
        r1:openTrade.r1,r2:openTrade.r2,source:openTrade.source,
        et:openTrade.et,partialDone:openTrade.partialDone||false,
        histId:openTrade.id
      };
      setTimeout(()=>{
        if(typeof drawTradeLines==='function'&&trade)drawTradeLines(trade);
        if(typeof renderHistorial==='function')renderHistorial();
      },1000);
    }
    console.log('SE Sync: '+cloudTrades.length+' trades carregats ✓');
  }catch(e){console.log('SE Sync loadTrades error:',e.message);}
}

// ── GUARDAR PREFERÈNCIES ──────────────────────────────────────
async function seSavePrefs(userId){
  if(!seDb)return;
  try{
    const capital=parseFloat(document.getElementById('calc-capital')?.value)||1000;
    const riesgo=parseFloat(document.getElementById('calc-riesgo')?.value)||2;
    await seDb.from('user_prefs').upsert({
      user_id:userId,
      lev:typeof lev!=='undefined'?lev:2,
      tf:typeof tf!=='undefined'?tf:'1m',
      use_ob:typeof useOB!=='undefined'?useOB:true,
      use_fvg:typeof useFVG!=='undefined'?useFVG:false,
      use_rt:typeof useRT!=='undefined'?useRT:false,
      capital,riesgo,
      calc_mode:typeof calcMode!=='undefined'?calcMode:'pct',
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
  }catch(e){}
}

// ── GUARDAR TRADE ─────────────────────────────────────────────
async function seSaveTrade(userId,t){
  if(!seDb||!t)return;
  try{
    await seDb.from('trades').upsert({
      id:t.id,user_id:userId,dir:t.dir,source:t.source,et:t.et,
      tf:t.tf,lev:t.lev,ep:t.ep,sl:t.sl,tp1:t.tp1,tp2:t.tp2,
      sp:t.sp,r1:t.r1,r2:t.r2,result:t.result,
      close_price:t.closePrice||null,pnl_pct:t.pnlPct||null,
      partial_done:t.partialDone||false,partial_pct:t.partialPct||null,
      notes:t.notes||null,
      opened_at:t.openedAt||new Date().toISOString(),
      closed_at:t.closedAt||null
    });
  }catch(e){}
}

// ── INTERCEPTAR GUARDAT LOCAL ─────────────────────────────────
function seInterceptSave(userId){
  // Observar canvis al localStorage cada 3 segons
  let lastPrefs=localStorage.getItem('btc_dashboard_prefs_v1');
  let lastHistory=localStorage.getItem('btc_trade_history_v1');

  setInterval(async()=>{
    // Detectar canvis a preferències
    const currentPrefs=localStorage.getItem('btc_dashboard_prefs_v1');
    if(currentPrefs!==lastPrefs){
      lastPrefs=currentPrefs;
      await seSavePrefs(userId);
    }
    // Detectar canvis a trades
    const currentHistory=localStorage.getItem('btc_trade_history_v1');
    if(currentHistory!==lastHistory){
      lastHistory=currentHistory;
      try{
        const trades=JSON.parse(currentHistory)||[];
        // Sincronitzar l'últim trade modificat
        if(trades.length>0){
          await seSaveTrade(userId,trades[0]);
        }
      }catch(e){}
    }
  },3000);
}

// ── INDICADOR VISUAL ──────────────────────────────────────────
function seShowIndicator(ok){
  // Afegir indicador a la barra de TFs si no existeix
  let el=document.getElementById('se-sync-dot');
  if(!el){
    const tfBar=document.querySelector('.tf-bar');
    if(tfBar){
      el=document.createElement('span');
      el.id='se-sync-dot';
      el.style.cssText='font-size:9px;margin-left:6px;cursor:default;';
      el.title=ok?'Sincronizado con la nube':'Sin sincronización';
      tfBar.appendChild(el);
    }
  }
  if(el){
    el.textContent=ok?'☁️':'📵';
    el.title=ok?'Sincronizado con la nube':'Sin sincronización';
  }
}
