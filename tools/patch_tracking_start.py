from pathlib import Path

p = Path('FactionLedgerIQ.user.js')
s = p.read_text()

s = s.replace('// @version      1.0.2', '// @version      1.0.3')
s = s.replace("const VERSION='1.0.2';", "const VERSION='1.0.3';")

needle = "function purgePreWhitelistPurchases(){let changed=false;(state.lots||[]).forEach(l=>{if(!l||l.status==='VOID'||l.sourceType!=='PURCHASE')return;const w=whitelist(l.itemId,l.itemName);if(!w||!w.addedAt)return;const created=new Date(l.createdAt||0).getTime(),added=new Date(w.addedAt).getTime();if(Number.isFinite(created)&&Number.isFinite(added)&&created<added&&Number(l.qtyRemaining||0)===Number(l.qtyOriginal||0)){l.status='VOID';l.qtyRemaining=0;l.voidedAt=new Date().toISOString();l.voidReason='Purchase occurred before item was whitelisted';changed=true;}});return changed;}"
insert = needle + "\nfunction trackingStartMs(){const ms=new Date(state.createdAt||0).getTime();return Number.isFinite(ms)&&ms>0?ms:0;}\nfunction logAfterTrackingStart(log){const start=trackingStartMs(),ts=Number(log&&log.timestamp||0)*1000;return !start||!ts||ts>=start;}\nfunction purgePreTrackingEvents(){const start=trackingStartMs();if(!start)return false;let changed=false;(state.movements||[]).forEach(m=>{if(!m||m.status==='VOID'||!['ARMORY_IN','ARMORY_OUT'].includes(m.type)||m.receiptBatchId||(m.claimIds||[]).length)return;const ts=new Date(m.timestamp||0).getTime();if(Number.isFinite(ts)&&ts<start){m.status='VOID';m.voidedAt=new Date().toISOString();m.voidReason='Movement occurred before LedgerIQ tracking started';changed=true;}});(state.lots||[]).forEach(l=>{if(!l||l.status==='VOID'||l.sourceType!=='ARMORY_WITHDRAWAL')return;const ts=new Date(l.createdAt||0).getTime();if(Number.isFinite(ts)&&ts<start&&Number(l.qtyRemaining||0)===Number(l.qtyOriginal||0)){l.status='VOID';l.qtyRemaining=0;l.voidedAt=new Date().toISOString();l.voidReason='Armory withdrawal occurred before LedgerIQ tracking started';changed=true;}});(state.pendingTransfers||[]).forEach(t=>{if(!t||t.status!=='PENDING')return;const ts=new Date(t.timestamp||0).getTime();if(Number.isFinite(ts)&&ts<start){t.status='VOID';t.voidedAt=new Date().toISOString();changed=true;}});return changed;}"
if needle not in s:
    raise SystemExit('purgePreWhitelistPurchases pattern not found')
s = s.replace(needle, insert, 1)

old_incoming = "async function reconcileIncoming(logs){await ensureCatalog(false);let changed=false;for(const log of logs){const id=logId(log);if(!id||seen(id))continue;const parts=incomingParts(log);"
new_incoming = "async function reconcileIncoming(logs){await ensureCatalog(false);let changed=false;for(const log of logs){const id=logId(log);if(!id||seen(id))continue;if(!logAfterTrackingStart(log)){remember(id);continue;}const parts=incomingParts(log);"
if old_incoming not in s:
    raise SystemExit('reconcileIncoming pattern not found')
s = s.replace(old_incoming, new_incoming, 1)

old_armory = "async function reconcileArmory(logs){await ensureCatalog(false);let changed=false;const actor=String(state.settings.playerId||''),parts=logs.map(factionPart).filter(Boolean),groups=new Map();"
new_armory = "async function reconcileArmory(logs){await ensureCatalog(false);let changed=false;const actor=String(state.settings.playerId||''),parts=logs.filter(logAfterTrackingStart).map(factionPart).filter(Boolean),groups=new Map();"
if old_armory not in s:
    raise SystemExit('reconcileArmory header pattern not found')
s = s.replace(old_armory, new_armory, 1)

old_loop = " for(const log of logs.slice().sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0))){const id=logId(log);if(!id||seen(id))continue;const d=log&&log.data&&typeof log.data==='object'?log.data:{}"
new_loop = " for(const log of logs.slice().sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0))){const id=logId(log);if(!id||seen(id))continue;if(!logAfterTrackingStart(log)){remember(id);continue;}const d=log&&log.data&&typeof log.data==='object'?log.data:{}"
if old_loop not in s:
    raise SystemExit('armory deposit loop pattern not found')
s = s.replace(old_loop, new_loop, 1)

old_boot = "function boot(){const cleaned=purgePreWhitelistPurchases();if(cleaned)save(false);installStyles();ensurePanel();ensureDock();startDockObserver();installEvents();restartPolling();if(apiKey())ensureCatalog(false).then(()=>{save(false);render();}).catch(()=>{});render();}"
new_boot = "function boot(){const cleanedPurchases=purgePreWhitelistPurchases(),cleanedHistory=purgePreTrackingEvents();if(cleanedPurchases||cleanedHistory)save(false);installStyles();ensurePanel();ensureDock();startDockObserver();installEvents();restartPolling();if(apiKey())ensureCatalog(false).then(()=>{save(false);render();}).catch(()=>{});render();}"
if old_boot not in s:
    raise SystemExit('boot pattern not found')
s = s.replace(old_boot, new_boot, 1)

p.write_text(s)
