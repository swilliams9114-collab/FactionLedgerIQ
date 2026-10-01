from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.2.2','// @version      1.2.3',1)
s=s.replace("const VERSION='1.2.2';","const VERSION='1.2.3';",1)
s=s.replace("const PRE_RESTORE_KEY='factionledgeriq_v1_pre_restore';","const PRE_RESTORE_KEY='factionledgeriq_v1_pre_restore';\nconst PRE_RESET_KEY='factionledgeriq_v1_pre_reset';",1)

anchor="function undoLastRestore(){const raw=localStorage.getItem(PRE_RESTORE_KEY);if(!raw)throw new Error('No pre-restore snapshot is available');let b;try{b=JSON.parse(raw);}catch(e){throw new Error('Recovery snapshot is unreadable');}if(!b||b.kind!=='FactionLedgerIQPreRestore'||!b.state)throw new Error('Recovery snapshot is invalid');const existingKey=apiKey();state=hydrateState(b.state,existingKey);state.updatedAt=new Date().toISOString();localStorage.setItem(STATE_KEY,JSON.stringify(state));localStorage.removeItem(PRE_RESTORE_KEY);currentAudit=null;restartPolling();render();toast('Last restore undone');}"
addition="""
function undoLastRestore(){const raw=localStorage.getItem(PRE_RESTORE_KEY);if(!raw)throw new Error('No pre-restore snapshot is available');let b;try{b=JSON.parse(raw);}catch(e){throw new Error('Recovery snapshot is unreadable');}if(!b||b.kind!=='FactionLedgerIQPreRestore'||!b.state)throw new Error('Recovery snapshot is invalid');const existingKey=apiKey();state=hydrateState(b.state,existingKey);state.updatedAt=new Date().toISOString();localStorage.setItem(STATE_KEY,JSON.stringify(state));localStorage.removeItem(PRE_RESTORE_KEY);currentAudit=null;restartPolling();render();toast('Last restore undone');}
async function clearRefreshableCache(){state.market={};itemCatalog=[];itemCatalogLoadedAt=0;state.diagnostics={...DEFAULT.diagnostics,apiStatus:apiKey()?'Cache cleared':'API key required'};save(false);if(apiKey()){try{await ensureCatalog(true);state.diagnostics.apiStatus='Connected';state.diagnostics.lastApiError='';state.diagnostics.lastSyncAt=new Date().toISOString();save();toast('Cache cleared and rebuilt');}catch(e){state.diagnostics.apiStatus='Error';state.diagnostics.lastApiError=String(e&&e.message||e);save();toast('Cache cleared; rebuild failed');}}else{save();toast('Cache cleared');}}
function resetLedgerDataFromUi(){const input=document.getElementById('fliq-reset-confirm'),word=String(input&&input.value||'').trim();if(word!=='RESET')throw new Error('Type RESET exactly to reset ledger data');const previous={kind:'FactionLedgerIQPreReset',savedAt:new Date().toISOString(),state:clone(state)};localStorage.setItem(PRE_RESET_KEY,JSON.stringify(previous));const keepSettings=clone(state.settings||DEFAULT.settings),keepWhitelist=clone(state.whitelist||[]),now=new Date().toISOString();state=clone(DEFAULT);state.settings={...DEFAULT.settings,...keepSettings};state.whitelist=keepWhitelist;state.createdAt=now;state.updatedAt=now;state.diagnostics={...DEFAULT.diagnostics,apiStatus:apiKey()?'Ready to sync':'API key required'};itemCatalog=[];itemCatalogLoadedAt=0;currentAudit=null;activeTab='home';localStorage.setItem(STATE_KEY,JSON.stringify(state));restartPolling();render();toast('Ledger data reset — Undo is available in Settings');}
function undoLastLedgerReset(){const raw=localStorage.getItem(PRE_RESET_KEY);if(!raw)throw new Error('No pre-reset snapshot is available');let b;try{b=JSON.parse(raw);}catch(e){throw new Error('Pre-reset snapshot is unreadable');}if(!b||b.kind!=='FactionLedgerIQPreReset'||!b.state)throw new Error('Pre-reset snapshot is invalid');const existingKey=apiKey();state=hydrateState(b.state,existingKey);state.updatedAt=new Date().toISOString();localStorage.setItem(STATE_KEY,JSON.stringify(state));localStorage.removeItem(PRE_RESET_KEY);currentAudit=null;restartPolling();render();toast('Last ledger reset undone');}
""".strip()
if anchor not in s: raise SystemExit('undo restore anchor not found')
s=s.replace(anchor,addition,1)

old="async function reconcilePurchases(logs){await ensureCatalog(false);let changed=false;for(const log of logs.slice().sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0))){const id=logId(log);if(!id||handledLog(id))continue;const d=log&&log.data"
new="async function reconcilePurchases(logs){await ensureCatalog(false);let changed=false;for(const log of logs.slice().sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0))){const id=logId(log);if(!id||handledLog(id))continue;if(!logAfterTrackingStart(log)){remember(id);continue;}const d=log&&log.data"
if old not in s: raise SystemExit('reconcilePurchases anchor not found')
s=s.replace(old,new,1)

old_settings="<div class=\"fliq-actions\"><button class=\"fliq-btn fliq-btn-primary\" data-fliq=\"save-settings\">Save Settings</button><button class=\"fliq-btn\" data-fliq=\"load-items\">Load / Refresh Items</button></div>`;}"
new_settings="<div class=\"fliq-section\"><div class=\"fliq-section-title\"><span>Recovery / Reset</span></div><div class=\"fliq-muted\">Clear & Rebuild Cache only refreshes market/catalog data and does not touch inventory, claims, receipts, payments, or history. Reset Ledger Data clears ledger records but preserves Profile, API settings, and Whitelist. A local undo snapshot is created first.</div><div class=\"fliq-actions\"><button class=\"fliq-btn\" data-fliq=\"clear-cache\">Clear & Rebuild Cache</button><button class=\"fliq-btn\" data-fliq=\"undo-ledger-reset\">Undo Last Ledger Reset</button></div><input id=\"fliq-reset-confirm\" class=\"fliq-input\" autocomplete=\"off\" placeholder=\"Type RESET to enable ledger reset\"><div class=\"fliq-actions\"><button class=\"fliq-btn\" data-fliq=\"reset-ledger\">Reset Ledger Data</button></div></div><div class=\"fliq-actions\"><button class=\"fliq-btn fliq-btn-primary\" data-fliq=\"save-settings\">Save Settings</button><button class=\"fliq-btn\" data-fliq=\"load-items\">Load / Refresh Items</button></div>`;}"
if old_settings not in s: raise SystemExit('settings end anchor not found')
s=s.replace(old_settings,new_settings,1)

old_action="if(a==='undo-restore'){try{undoLastRestore();}catch(e){toast(String(e&&e.message||e));}return;}if(a==='sync')"
new_action="if(a==='undo-restore'){try{undoLastRestore();}catch(e){toast(String(e&&e.message||e));}return;}if(a==='clear-cache'){try{t.disabled=true;await clearRefreshableCache();}catch(e){toast(String(e&&e.message||e));t.disabled=false;}return;}if(a==='reset-ledger'){try{resetLedgerDataFromUi();}catch(e){toast(String(e&&e.message||e));}return;}if(a==='undo-ledger-reset'){try{undoLastLedgerReset();}catch(e){toast(String(e&&e.message||e));}return;}if(a==='sync')"
if old_action not in s: raise SystemExit('action anchor not found')
s=s.replace(old_action,new_action,1)

p.write_text(s)
