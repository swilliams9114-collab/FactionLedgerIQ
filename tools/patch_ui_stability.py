from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.0.7','// @version      1.0.8',1)
s=s.replace("const VERSION='1.0.7';","const VERSION='1.0.8';",1)

old="let state=loadState(),activeTab='home',dockObserver=null,dockQueued=false,apiTimer=null,apiBusy=false,itemCatalog=[],itemCatalogLoadedAt=0,currentAudit=null;"
new="let state=loadState(),activeTab='home',dockObserver=null,dockQueued=false,apiTimer=null,apiBusy=false,itemCatalog=[],itemCatalogLoadedAt=0,currentAudit=null,panelOpen=false;"
assert old in s
s=s.replace(old,new,1)

old="state.diagnostics.apiStatus='Connected';state.diagnostics.lastApiError='';state.diagnostics.lastSyncAt=new Date().toISOString();save(false);render();if(showToast)toast('Ledger synced');"
new="state.diagnostics.apiStatus='Connected';state.diagnostics.lastApiError='';state.diagnostics.lastSyncAt=new Date().toISOString();save(false);if(showToast||!panelOpen)render();if(showToast)toast('Ledger synced');"
assert old in s
s=s.replace(old,new,1)

old="state.diagnostics.apiStatus='Error';state.diagnostics.lastApiError=String(e&&e.message||e);save(false);render();if(showToast)toast('Sync failed: '+state.diagnostics.lastApiError);"
new="state.diagnostics.apiStatus='Error';state.diagnostics.lastApiError=String(e&&e.message||e);save(false);if(showToast||!panelOpen)render();if(showToast)toast('Sync failed: '+state.diagnostics.lastApiError);"
assert old in s
s=s.replace(old,new,1)

old="function startDockObserver(){if(dockObserver)return;dockObserver=new MutationObserver(()=>{if(dockQueued)return;dockQueued=true;requestAnimationFrame(()=>{dockQueued=false;ensureDock();});});dockObserver.observe(document.body||document.documentElement,{childList:true,subtree:true});}"
new="function startDockObserver(){if(dockObserver)return;dockObserver=new MutationObserver(()=>{if(dockQueued)return;dockQueued=true;requestAnimationFrame(()=>{dockQueued=false;ensureDock();if(panelOpen&&!document.getElementById(PANEL_ID)){ensurePanel();render();}});});dockObserver.observe(document.body||document.documentElement,{childList:true,subtree:true});}"
assert old in s
s=s.replace(old,new,1)

old="function ensurePanel(){installStyles();let p=document.getElementById(PANEL_ID);if(p)return p;p=document.createElement('div');p.id=PANEL_ID;p.className='hidden';document.body.appendChild(p);return p;}"
new="function ensurePanel(){installStyles();let p=document.getElementById(PANEL_ID);if(p)return p;p=document.createElement('div');p.id=PANEL_ID;p.className=panelOpen?'':'hidden';document.body.appendChild(p);return p;}"
assert old in s
s=s.replace(old,new,1)

old="function togglePanel(){const p=ensurePanel();p.classList.toggle('hidden');if(!p.classList.contains('hidden'))render();}"
new="function togglePanel(){const p=ensurePanel();panelOpen=p.classList.contains('hidden');p.classList.toggle('hidden',!panelOpen);if(panelOpen)render();}"
assert old in s
s=s.replace(old,new,1)

old="function render(){const p=ensurePanel(),hidden=p.classList.contains('hidden'),tabs="
new="function render(){const p=ensurePanel(),hidden=!panelOpen,tabs="
assert old in s
s=s.replace(old,new,1)

old=";if(hidden)p.classList.add('hidden');}"
new=";p.classList.toggle('hidden',hidden);}"
# replace only the render tail; exact token appears once in render
assert old in s
s=s.replace(old,new,1)

old="if(a==='close'){ensurePanel().classList.add('hidden');return;}"
new="if(a==='close'){panelOpen=false;ensurePanel().classList.add('hidden');return;}"
assert old in s
s=s.replace(old,new,1)

p.write_text(s)
