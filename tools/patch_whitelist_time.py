from pathlib import Path

p = Path('FactionLedgerIQ.user.js')
s = p.read_text()

s = s.replace('// @version      1.0.1', '// @version      1.0.2')
s = s.replace("const VERSION='1.0.1';", "const VERSION='1.0.2';")

needle = "function whitelist(id,name){id=String(id||'');const n=norm(name);return state.whitelist.find(w=>(id&&String(w.itemId)===id)||(n&&norm(w.itemName)===n))||null;}"
insert = needle + "\nfunction purgePreWhitelistPurchases(){let changed=false;(state.lots||[]).forEach(l=>{if(!l||l.status==='VOID'||l.sourceType!=='PURCHASE')return;const w=whitelist(l.itemId,l.itemName);if(!w||!w.addedAt)return;const created=new Date(l.createdAt||0).getTime(),added=new Date(w.addedAt).getTime();if(Number.isFinite(created)&&Number.isFinite(added)&&created<added&&Number(l.qtyRemaining||0)===Number(l.qtyOriginal||0)){l.status='VOID';l.qtyRemaining=0;l.voidedAt=new Date().toISOString();l.voidReason='Purchase occurred before item was whitelisted';changed=true;}});return changed;}"
if needle not in s:
    raise SystemExit('whitelist function pattern not found')
s = s.replace(needle, insert, 1)

old = "const itemId=String(r&&(r.id||r.item_id)||''),qty=Math.max(1,Number(r&&(r.qty||r.quantity)||1)),it=itemById(itemId),name=it?it.name:'Item #'+itemId,w=whitelist(itemId,name);if(!itemId||!w)return;const costEach=each||(total&&totalQty?total/totalQty:0);"
new = "const itemId=String(r&&(r.id||r.item_id)||''),qty=Math.max(1,Number(r&&(r.qty||r.quantity)||1)),it=itemById(itemId),name=it?it.name:'Item #'+itemId,w=whitelist(itemId,name);if(!itemId||!w)return;const logMs=Number(log.timestamp||0)*1000,addedMs=new Date(w.addedAt||0).getTime();if(addedMs&&logMs<addedMs)return;const costEach=each||(total&&totalQty?total/totalQty:0);"
if old not in s:
    raise SystemExit('purchase reconciliation pattern not found')
s = s.replace(old, new, 1)

old_boot = "function boot(){installStyles();ensurePanel();ensureDock();startDockObserver();installEvents();restartPolling();if(apiKey())ensureCatalog(false).then(()=>{save(false);render();}).catch(()=>{});render();}"
new_boot = "function boot(){const cleaned=purgePreWhitelistPurchases();if(cleaned)save(false);installStyles();ensurePanel();ensureDock();startDockObserver();installEvents();restartPolling();if(apiKey())ensureCatalog(false).then(()=>{save(false);render();}).catch(()=>{});render();}"
if old_boot not in s:
    raise SystemExit('boot function pattern not found')
s = s.replace(old_boot, new_boot, 1)

p.write_text(s)
# trigger workflow
