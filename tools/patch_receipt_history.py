from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()
s=s.replace('// @version      1.0.5','// @version      1.0.6')
s=s.replace("const VERSION='1.0.5';","const VERSION='1.0.6';")

old="state.receiptBatches.push({id:batchId,kind:'MOVEMENT',generatedAt:p.generatedAt,movementIds:moves.map(m=>m.id),claimIds:claims.map(c=>c.id)});return p;}"
new="state.receiptBatches.push({id:batchId,kind:'MOVEMENT',generatedAt:p.generatedAt,movementIds:moves.map(m=>m.id),claimIds:claims.map(c=>c.id),status:'ACTIVE',payload:p,receiptText:''});return p;}"
if old not in s:
    raise SystemExit('movementPayload batch pattern not found')
s=s.replace(old,new,1)

old="function generateReceipt(){const moves=state.movements.filter(m=>m.status!=='VOID'&&!m.receiptBatchId&&['ARMORY_IN','ARMORY_OUT','DISPLAY_IN','DISPLAY_OUT'].includes(m.type));if(!moves.length){toast('No unreported movements');return;}const p=movementPayload(moves),text=movementReceipt(p);save(false);showReceipt('Discord Movement Receipt',text);render();}"
new="function generateReceipt(){const moves=state.movements.filter(m=>m.status!=='VOID'&&!m.receiptBatchId&&['ARMORY_IN','ARMORY_OUT','DISPLAY_IN','DISPLAY_OUT'].includes(m.type));if(!moves.length){toast('No unreported movements');return;}const p=movementPayload(moves),text=movementReceipt(p),b=state.receiptBatches.find(x=>x.id===p.batchId);if(b){b.payload=p;b.receiptText=text;}save(false);showReceipt('Discord Movement Receipt',text);render();}"
if old not in s:
    raise SystemExit('generateReceipt pattern not found')
s=s.replace(old,new,1)

needle="function paymentReceipt(p){"
helpers="""function receiptPayloadFromBatch(b){if(!b)return null;if(b.payload&&b.payload.kind==='MOVEMENT')return b.payload;const moves=(b.movementIds||[]).map(movementById).filter(m=>m&&m.status!=='VOID'),claims=(b.claimIds||[]).map(claimById).filter(c=>c&&c.status!=='VOID');if(!moves.length)return null;return{kind:'MOVEMENT',version:VERSION,batchId:b.id,generatedAt:b.generatedAt||new Date().toISOString(),player:{name:state.settings.playerName||'',id:state.settings.playerId||''},factionName:state.settings.factionName||'',movements:moves.map(m=>({movementId:m.id,type:m.type,timestamp:m.timestamp,itemId:m.itemId,itemName:m.itemName,qty:m.qty,from:m.from,to:m.to,apiVerified:m.apiVerified===true,apiLogIds:m.apiLogIds||[],allocations:(m.allocations||[]).map(a=>({owner:a.owner,qty:a.qty,sourceType:a.sourceType})),claimIds:(m.claimIds||[]).filter(id=>claims.some(c=>c.id===id))})),claims:claims.map(c=>({id:c.id,movementId:c.movementId,itemId:c.itemId,itemName:c.itemName,qty:c.qty,paidEach:c.paidEach,costBasisKnown:c.costBasisKnown,mvEachFrozen:c.mvEachFrozen,amount:c.amount,status:c.status}))};}\nfunction openReceiptBatch(id){const b=(state.receiptBatches||[]).find(x=>x.id===id&&x.status!=='ARCHIVED');if(!b){toast('Receipt batch not found');return;}const p=receiptPayloadFromBatch(b);if(!p){toast('Receipt can no longer be reconstructed');return;}const text=b.receiptText||movementReceipt(p);b.payload=p;b.receiptText=text;save(false);showReceipt('Discord Movement Receipt',text);}\nfunction receiptHistoryHtml(){const batches=(state.receiptBatches||[]).filter(b=>b&&b.kind==='MOVEMENT'&&b.status!=='ARCHIVED').slice().sort((a,b)=>new Date(b.generatedAt||0)-new Date(a.generatedAt||0)).slice(0,8);if(!batches.length)return '';return `<div class=\"fliq-section\"><div class=\"fliq-section-title\"><span>Receipt History</span><span class=\"fliq-muted\">${batches.length}</span></div><div class=\"fliq-list\">${batches.map(b=>{const cs=(b.claimIds||[]).map(claimById).filter(c=>c&&c.status!=='VOID'),total=cs.reduce((n,c)=>n+Number(c.amount||0),0),moves=(b.movementIds||[]).map(movementById).filter(m=>m&&m.status!=='VOID');return `<div class=\"fliq-list-item\"><div class=\"fliq-item-top\"><div><b>${moves.length} movement${moves.length===1?'':'s'}</b><div class=\"fliq-muted\">${esc(fmt(b.generatedAt))} · ${esc(b.id)}</div>${cs.length?`<div>Claimed: <b>${money(total)}</b></div>`:'<div class=\"fliq-muted\">No reimbursement claim</div>'}</div><button class=\"fliq-btn fliq-btn-small\" data-fliq=\"view-receipt\" data-id=\"${esc(b.id)}\">View / Copy</button></div></div>`;}).join('')}</div></div>`;}\n"""
if needle not in s:
    raise SystemExit('paymentReceipt insertion point not found')
s=s.replace(needle,helpers+needle,1)

start=s.find('function homeHtml(){')
end=s.find('function itemOptions(){',start)
if start<0 or end<0:
    raise SystemExit('homeHtml bounds not found')
home=s[start:end]
old_tail="</div></div>`;}\n"
if old_tail not in home:
    raise SystemExit('homeHtml tail not found')
home=home.replace(old_tail,"</div></div>${receiptHistoryHtml()}`;}\n",1)
s=s[:start]+home+s[end:]

needle="if(a==='generate-receipt'){generateReceipt();return;}"
replacement=needle+"if(a==='view-receipt'){openReceiptBatch(String(t.dataset.id||''));return;}"
if needle not in s:
    raise SystemExit('action insertion point not found')
s=s.replace(needle,replacement,1)

p.write_text(s)
