from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.4.5','// @version      1.5.0',1)
s=s.replace("const VERSION='1.4.5';","const VERSION='1.5.0';",1)
s=s.replace('// @description  Simple TornPDA-first faction inventory, raffle ownership, claims, receipts, and leadership audit.','// @description  Personal TornPDA faction inventory, raffle, reimbursement, and Discord log tracker.',1)

def replace_func(name,next_name,new_text):
    global s
    a=s.index('function '+name)
    b=s.index('function '+next_name,a)
    s=s[:a]+new_text.rstrip()+"\n"+s[b:]

# Personal-only Discord log output. No machine payload, admin IDs, or leadership receipt metadata.
replace_func('movementReceipt(p){','generateReceipt(){',r'''function receiptCalcGroups(p){const map=new Map();for(const c of p.claims||[]){const q=Math.max(0,Number(c.qty||0));if(!q)continue;const rate=Math.round(Number(c.amount||0)/q),key=[c.itemId||c.itemName,rate].join('|');if(!map.has(key))map.set(key,{itemName:c.itemName||itemName(c.itemId),qty:0,rate,knownQty:0,unknownQty:0,minPaid:0,maxPaid:0});const g=map.get(key);g.qty+=q;if(c.costBasisKnown){g.knownQty+=q;const paid=Number(c.paidEach||0);if(paid){g.minPaid=!g.minPaid?paid:Math.min(g.minPaid,paid);g.maxPaid=Math.max(g.maxPaid,paid);}}else g.unknownQty+=q;}return Array.from(map.values());}
function receiptCalcText(g){const base=`${Number(g.qty||0).toLocaleString()}x ${g.itemName} @ ${money(g.rate)}`;if(g.knownQty&&g.unknownQty)return `${base} (${g.knownQty.toLocaleString()} purchased, ${g.unknownQty.toLocaleString()} @ MV)`;if(g.knownQty){if(g.minPaid&&g.maxPaid&&g.rate>=g.maxPaid){const paid=g.minPaid===g.maxPaid?money(g.minPaid):`${money(g.minPaid)}–${money(g.maxPaid)}`;return `${base} (paid ${paid})`;}return `${base} (purchase price)`;}return `${base} MV`;}
function movementReceipt(p){const groups=receiptDepositGroups(p),total=(p.claims||[]).reduce((n,c)=>n+Number(c.amount||0),0),firstTs=(p.movements||[]).map(m=>m.timestamp).filter(Boolean).sort()[0]||p.generatedAt||'',l=[discordUtcStamp(firstTs)];for(const g of groups){const dest=g.destination==='FACTION_ARMORY'?(p.factionName?`${p.factionName}'s armory`:'Faction Armory'):g.destination==='DISPLAY_CASE'?'Display Case':friendly(g.destination);l.push(`You deposited **${receiptItemList(g.items)}** into **${dest}**`);}const calc=receiptCalcGroups(p);if(calc.length)l.push('',`Reimbursement: ${calc.map(receiptCalcText).join('; ')}`);const zero=zeroDepositGroups(p);if(zero.length)l.push(`Faction-owned: ${zero.map(g=>`${Number(g.qty||0).toLocaleString()}x ${g.itemName}`).join(', ')} ($0)`);l.push('',`**Amount Owed: ${money(total)}**`);return l.join('\n');}
''')

replace_func('generateReceipt(){','receiptPayloadFromBatch(b){',r'''function generateReceipt(){const moves=state.movements.filter(m=>m.status==='ACTIVE'&&!m.receiptBatchId&&['ARMORY_IN','DISPLAY_IN'].includes(m.type));if(!moves.length){toast('No new deposits need a Discord log');return;}const p=movementPayload(moves),text=movementReceipt(p),b=state.receiptBatches.find(x=>x.id===p.batchId);if(b){b.payload=p;b.receiptText=text;}save(false);showReceipt('Discord Deposit Log',text);render();}
''')

replace_func('openReceiptBatch(id){','receiptHistoryHtml(){',r'''function openReceiptBatch(id){const b=(state.receiptBatches||[]).find(x=>x.id===id&&x.status!=='ARCHIVED');if(!b){toast('Discord log not found');return;}const p=receiptPayloadFromBatch(b);if(!p){toast('Discord log can no longer be reconstructed');return;}const text=movementReceipt(p);b.payload=p;b.receiptText=text;save(false);showReceipt('Discord Deposit Log',text);}
''')

replace_func('receiptHistoryHtml(){','paymentReceipt(p){',r'''function receiptHistoryHtml(){const batches=(state.receiptBatches||[]).filter(b=>b&&b.kind==='MOVEMENT'&&b.status!=='ARCHIVED').slice().sort((a,b)=>new Date(b.generatedAt||0)-new Date(a.generatedAt||0)).slice(0,50);if(!batches.length)return '<div class="fliq-section"><div class="fliq-section-title"><span>Discord Log History</span></div><div class="fliq-muted">No Discord logs created yet.</div></div>';return `<div class="fliq-section"><div class="fliq-section-title"><span>Discord Log History</span><span class="fliq-muted">${batches.length}</span></div><div class="fliq-list">${batches.map(b=>{const cs=(b.claimIds||[]).map(claimById).filter(c=>c&&c.status!=='VOID'),total=cs.reduce((n,c)=>n+Number(c.amount||0),0),moves=(b.movementIds||[]).map(movementById).filter(m=>m&&m.status!=='VOID'),names=[];for(const m of moves){if(!names.includes(m.itemName))names.push(m.itemName);}return `<div class="fliq-list-item"><div class="fliq-item-top"><div><b>${esc(names.slice(0,3).join(', ')||'Deposit')}</b><div class="fliq-muted">${esc(fmt(b.generatedAt))}</div><div>Amount owed: <b>${money(total)}</b></div></div><button class="fliq-btn fliq-btn-small" data-fliq="view-receipt" data-id="${esc(b.id)}">View / Copy</button></div></div>`;}).join('')}</div></div>`;}
''')

# Home + new Activity tab.
replace_func('homeHtml(){','itemMatches(q){',r'''function homeHtml(){const pending=state.pendingTransfers.filter(t=>t.status==='PENDING').length,unlogged=state.movements.filter(m=>m.status==='ACTIVE'&&!m.receiptBatchId&&['ARMORY_IN','DISPLAY_IN'].includes(m.type)).length,recent=state.movements.filter(m=>m.status!=='VOID').slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,4);return `<div class="fliq-grid"><div class="fliq-card"><div class="fliq-card-label">Personal Stock</div><div class="fliq-big">${money(personalValue(P))}</div><div class="fliq-muted">Current MV</div></div><div class="fliq-card"><div class="fliq-card-label">Faction Held</div><div class="fliq-big">${money(personalValue(F))}</div><div class="fliq-muted">Held by you</div></div><div class="fliq-card"><div class="fliq-card-label">Faction Owes You</div><div class="fliq-big">${money(openClaimTotal())}</div><div class="fliq-muted">Waiting to be paid</div></div></div><div class="fliq-section"><div class="fliq-section-title"><span>Sync</span><span class="${state.diagnostics.apiStatus==='Connected'?'fliq-good':'fliq-muted'}">${esc(state.diagnostics.apiStatus)}</span></div><div class="fliq-muted">${state.diagnostics.lastSyncAt?'Last sync: '+esc(fmt(state.diagnostics.lastSyncAt)):'No sync yet'}${state.diagnostics.lastApiError?'<br><span class="fliq-bad">'+esc(state.diagnostics.lastApiError)+'</span>':''}</div><div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" data-fliq="sync">Sync Now</button><button class="fliq-btn" data-fliq="refresh-mv">Refresh MV</button></div></div><div class="fliq-section"><div class="fliq-section-title"><span>Needs Attention</span></div><div class="fliq-list"><div class="fliq-list-item"><b>${unlogged}</b> deposit update${unlogged===1?'':'s'} ready for a Discord log.${unlogged?'<div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" data-fliq="generate-receipt">Create Discord Log</button></div>':''}</div><div class="fliq-list-item"><b>${pending}</b> incoming item transfer${pending===1?'':'s'} waiting to be classified.${pending?'<div class="fliq-actions"><button class="fliq-btn" data-fliq="tab" data-tab="raffles">Open Raffles</button></div>':''}</div></div></div><div class="fliq-section"><div class="fliq-section-title"><span>Recent Activity</span><button class="fliq-btn fliq-btn-small" data-fliq="tab" data-tab="activity">View All</button></div><div class="fliq-list">${recent.length?recent.map(movementCard).join(''):'<div class="fliq-muted">No item activity recorded yet.</div>'}</div></div>${ownershipReviewHtml()}`;}
function activityHtml(){const rows=state.movements.filter(m=>m.status!=='VOID').slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,60);return `<div class="fliq-section"><div class="fliq-section-title"><span>Item Activity</span><span class="fliq-muted">${rows.length}</span></div><div class="fliq-muted" style="margin-bottom:8px">Purchases, Armory activity, Display Case activity, and other tracked ownership changes stay here for your records.</div><div class="fliq-list">${rows.length?rows.map(movementCard).join(''):'<div class="fliq-muted">No item activity recorded yet.</div>'}</div></div>${receiptHistoryHtml()}`;}
''')

# Money Owed: personal bookkeeping only.
replace_func('claimsHtml(){','auditHtml(){',r'''function claimsHtml(){const cs=state.claims.filter(c=>c.status!=='VOID').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)),open=cs.filter(c=>c.status==='OPEN'||c.status==='SUBMITTED'),paid=cs.filter(c=>c.status==='REIMBURSED');return `<div class="fliq-section"><div class="fliq-section-title"><span>Money Owed to You</span><span class="fliq-big">${money(openClaimTotal())}</span></div><div class="fliq-muted" style="margin-bottom:8px">LedgerIQ keeps the reimbursement calculation here. Mark an item paid after the faction reimburses you.</div><div class="fliq-list">${open.length?open.map(c=>`<div class="fliq-list-item"><div class="fliq-item-top"><div><div class="fliq-item-name">${esc(c.itemName)} ×${Number(c.qty||0).toLocaleString()}</div><div class="fliq-muted">${c.costBasisKnown?'Paid '+money(c.paidEach)+' each · ':''}Rate used ${money(c.mvEachFrozen)} each</div></div><span class="fliq-pill red">OWED</span></div><div><b>${money(c.amount)}</b></div><div class="fliq-actions"><button class="fliq-btn fliq-btn-small" data-fliq="mark-reimbursed" data-id="${esc(c.id)}">Mark Paid</button></div></div>`).join(''):'<div class="fliq-muted">Nothing is currently owed.</div>'}</div></div><div class="fliq-section"><div class="fliq-section-title"><span>Paid Reimbursements</span><span class="fliq-muted">${paid.length}</span></div><div class="fliq-list">${paid.slice(0,50).map(c=>`<div class="fliq-list-item"><b>${esc(c.itemName)}</b> ×${Number(c.qty||0).toLocaleString()} · ${money(c.amount)}<div class="fliq-muted">Paid ${esc(fmt(c.reimbursedAt))}</div></div>`).join('')||'<div class="fliq-muted">No reimbursements marked paid yet.</div>'}</div></div>`;}
''')

# Navigation: remove Leadership, add Activity.
replace_func('render(){','showReceipt(title,text){',r'''function render(){const p=ensurePanel(),hidden=!panelOpen,tabs=[['home','Home'],['inventory','Inventory'],['raffles','Raffles'],['claims','Money Owed'],['activity','Activity'],['settings','Settings']],body=activeTab==='inventory'?inventoryHtml():activeTab==='raffles'?rafflesHtml():activeTab==='claims'?claimsHtml():activeTab==='activity'?activityHtml():activeTab==='settings'?settingsHtml():homeHtml();p.innerHTML=`<div class="fliq-head"><div class="fliq-brand">FactionLedgerIQ <span class="fliq-version">v${esc(VERSION)}</span></div><button class="fliq-close" data-fliq="close">×</button></div><div class="fliq-tabs">${tabs.map(t=>`<button class="fliq-tab ${activeTab===t[0]?'active':''}" data-fliq="tab" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div><div class="fliq-body">${body}</div>`;p.classList.toggle('hidden',hidden);}
''')

# Generic copy language for logs/backups.
s=s.replace('>Copy Receipt</button>','>Copy</button>',1)
s=s.replace("toast('Receipt copied');","toast('Copied');",1)

# Personal build no longer needs faction-news permission or leadership-facing wording.
s=s.replace("user=basic,log,display&torn=items&faction=news","user=basic,log,display&torn=items",1)
s=s.replace("user → basic, log, display · torn → items · faction → news","user → basic, log, display · torn → items",1)
s=s.replace("Faction news may still require the appropriate faction permission on your Torn account.","No faction-news permission is needed for the personal bookkeeping workflow.",1)
s=s.replace("Faction inventory ownership, reimbursement tracking, raffle intake, receipts, and leadership auditing.","Personal faction inventory ownership, reimbursement tracking, raffle intake, and Discord bookkeeping logs.",1)
s=s.replace("LedgerIQ uses Torn API endpoints for user logs, your Display Case contents when Display tracking is enabled, Torn item/market data, and faction news when your faction permissions allow it.","LedgerIQ uses Torn API endpoints for your user logs, your Display Case contents when Display tracking is enabled, and Torn item/market data.",1)
s=s.replace("Required custom selections are user → log, display; torn → items; faction → news. LedgerIQ does not require a Full Access key.","Required custom selections are user → basic, log, display; torn → items. LedgerIQ does not require a Full Access key.",1)
s=s.replace("Backups include your tracked items, item activity, reimbursements, receipts, raffle data, leadership payment history, and settings.","Backups include your tracked items, item activity, reimbursements, Discord logs, raffle data, and settings.",1)

# Old leadership/payment functions remain dormant only so historical backups do not break.
# Remove reachable action handlers from the personal UI.
for old in [
    "if(a==='view-payment-receipt'){openPaymentBatch(String(t.dataset.id||''));return;}",
    "if(a==='import-payment'){try{await importReceipt(String(document.getElementById('fliq-payment-import').value||''));}catch(e){toast('Import failed: '+String(e&&e.message||e));}return;}",
    "if(a==='audit-import'){try{t.disabled=true;t.textContent='Checking…';await importReceipt(String(document.getElementById('fliq-audit-import').value||''));}catch(e){toast('Receipt check failed: '+String(e&&e.message||e));t.disabled=false;t.textContent='Check Receipt';}return;}",
    "if(a==='audit-pay'){payAudit('verified');return;}",
    "if(a==='audit-manual-pay'){payAudit('manual');return;}",
    "if(a==='audit-clear'){currentAudit=null;render();return;}"
]:
    s=s.replace(old,'',1)

p.write_text(s)
print('patched personal ledger v1.5.0')
