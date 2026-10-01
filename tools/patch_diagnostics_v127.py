from pathlib import Path
p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.2.6','// @version      1.2.7',1)
s=s.replace("const VERSION='1.2.6';","const VERSION='1.2.7';",1)
s=s.replace("let state=loadState(),activeTab='home',dockObserver=null,dockQueued=false,apiTimer=null,apiBusy=false,itemCatalog=[],itemCatalogLoadedAt=0,currentAudit=null,panelOpen=false;","let state=loadState(),activeTab='home',dockObserver=null,dockQueued=false,apiTimer=null,apiBusy=false,itemCatalog=[],itemCatalogLoadedAt=0,currentAudit=null,panelOpen=false,healthReport=null;",1)

anchor="function movementById(id){return state.movements.find(m=>m.id===id)||null;}"
addition=anchor+r'''
function duplicateValues(rows,getter){const seen=new Set(),dups=new Set();for(const row of rows||[]){const v=String(getter(row)||'');if(!v)continue;if(seen.has(v))dups.add(v);else seen.add(v);}return Array.from(dups);}
function runHealthCheck(){const checks=[],add=(name,severity,detail)=>checks.push({name,severity,detail});
 const idGroups=[['Lots',state.lots],['Movements',state.movements],['Claims',state.claims],['Receipt batches',state.receiptBatches],['Audit records',state.auditClaims],['Payment batches',state.paymentBatches],['Raffles',state.raffles],['Transfers',state.pendingTransfers]];
 const dupGroups=idGroups.map(([name,rows])=>[name,duplicateValues(rows,x=>x&&x.id)]).filter(x=>x[1].length);add('Unique record IDs',dupGroups.length?'FAIL':'PASS',dupGroups.length?dupGroups.map(x=>x[0]+': '+x[1].slice(0,3).join(', ')).join(' · '):'No duplicate primary IDs found.');
 const dupLogs=duplicateValues((state.processedLogIds||[]).map(x=>({id:x})),x=>x.id);add('Processed Torn log IDs',dupLogs.length?'FAIL':'PASS',dupLogs.length?dupLogs.length+' duplicate processed log ID(s) found.':'Processed log IDs are unique.');
 const badLots=(state.lots||[]).filter(l=>Number(l.qtyRemaining||0)<0||Number(l.qtyOriginal||0)<0||Number(l.qtyRemaining||0)>Number(l.qtyOriginal||0));add('Lot quantities',badLots.length?'FAIL':'PASS',badLots.length?badLots.length+' lot(s) have impossible quantity balances.':'No negative or overdrawn lot balances.');
 const zeroOpen=(state.lots||[]).filter(l=>l&&l.status==='OPEN'&&Number(l.qtyRemaining||0)===0);add('Lot status consistency',zeroOpen.length?'WARN':'PASS',zeroOpen.length?zeroOpen.length+' OPEN lot(s) have zero remaining quantity.':'Open/consumed lot statuses look consistent.');
 const missingMovementClaims=(state.claims||[]).filter(c=>c&&c.status!=='VOID'&&!movementById(c.movementId));add('Claim → movement links',missingMovementClaims.length?'FAIL':'PASS',missingMovementClaims.length?missingMovementClaims.length+' active claim(s) point to a missing movement.':'All active claims point to an existing movement.');
 const missingClaimRefs=[];for(const m of state.movements||[]){if(!m||m.status==='VOID')continue;for(const id of m.claimIds||[])if(!claimById(id))missingClaimRefs.push(id);}add('Movement → claim links',missingClaimRefs.length?'FAIL':'PASS',missingClaimRefs.length?missingClaimRefs.length+' movement claim reference(s) are missing.':'All movement claim references resolve.');
 const badMovements=[];for(const m of state.movements||[]){if(!m||m.status==='VOID')continue;const type=String(m.type||''),q=Number(m.qty||0),alloc=movementAllocations(m).reduce((n,a)=>n+Number(a.qty||0),0),unknown=Math.max(0,Number(m.unknownQty||0));if(['ARMORY_IN','ARMORY_OUT','DISPLAY_IN','DISPLAY_OUT'].includes(type)&&Math.abs((alloc+unknown)-q)>0.000001)badMovements.push(m.id);}add('Movement allocation totals',badMovements.length?'FAIL':'PASS',badMovements.length?badMovements.length+' movement(s) do not balance to their recorded quantity.':'Movement ownership allocations balance to movement quantities.');
 const badClaims=(state.claims||[]).filter(c=>c&&c.status!=='VOID'&&(Number(c.qty||0)<=0||Number(c.amount||0)<0||Number(c.mvEachFrozen||0)<0));add('Claim values',badClaims.length?'FAIL':'PASS',badClaims.length?badClaims.length+' active claim(s) have invalid quantity/value data.':'Active claim quantities and values are valid.');
 const reimbursedMissingDate=(state.claims||[]).filter(c=>c&&c.status==='REIMBURSED'&&!c.reimbursedAt);add('Reimbursement status',reimbursedMissingDate.length?'WARN':'PASS',reimbursedMissingDate.length?reimbursedMissingDate.length+' reimbursed claim(s) are missing a reimbursement timestamp.':'Reimbursed claims have reimbursement timestamps.');
 const paidAudit=(state.auditClaims||[]).filter(a=>a&&a.status==='PAID'),dupPaid=duplicateValues(paidAudit,a=>a.claimId);add('Leadership paid Claim IDs',dupPaid.length?'FAIL':'PASS',dupPaid.length?dupPaid.length+' Claim ID(s) appear paid more than once.':'No duplicate paid Claim IDs found.');
 const allPaidIds=new Set(paidAudit.map(a=>String(a.claimId||''))),paymentMissing=[];for(const b of state.paymentBatches||[])for(const id of b.claimIds||[])if(!allPaidIds.has(String(id)))paymentMissing.push(id);add('Payment batch references',paymentMissing.length?'WARN':'PASS',paymentMissing.length?paymentMissing.length+' payment reference(s) have no matching paid audit record.':'Payment batches match paid audit history.');
 const missingReceiptRefs=[];for(const b of state.receiptBatches||[]){for(const id of b.movementIds||[])if(!movementById(id))missingReceiptRefs.push('movement '+id);for(const id of b.claimIds||[])if(!claimById(id))missingReceiptRefs.push('claim '+id);}add('Receipt history references',missingReceiptRefs.length?'FAIL':'PASS',missingReceiptRefs.length?missingReceiptRefs.length+' receipt reference(s) point to missing records.':'Receipt history references resolve.');
 const reviews=(state.movements||[]).filter(m=>m&&m.status==='REVIEW'&&Number(m.unknownQty||0)>0);add('Ownership reviews',reviews.length?'WARN':'PASS',reviews.length?reviews.length+' movement(s) still need ownership classification.':'No unresolved ownership reviews.');
 if(state.diagnostics&&state.diagnostics.apiStatus==='Error')add('API status','WARN','Last API sync is in an error state: '+String(state.diagnostics.lastApiError||'Unknown API error'));else add('API status','PASS','No current API error is recorded.');
 const failCount=checks.filter(x=>x.severity==='FAIL').length,warnCount=checks.filter(x=>x.severity==='WARN').length;healthReport={runAt:new Date().toISOString(),status:failCount?'FAIL':warnCount?'WARNING':'PASS',failCount,warnCount,checks};render();toast(failCount?'Diagnostics found '+failCount+' failure(s)':warnCount?'Diagnostics passed with '+warnCount+' warning(s)':'Diagnostics passed');}
function diagnosticsHtml(){const r=healthReport;if(!r)return `<div class="fliq-section"><div class="fliq-section-title"><span>Diagnostics / Health Check</span><span class="fliq-pill">NOT RUN</span></div><div class="fliq-muted">Read-only checks for duplicate IDs, impossible inventory balances, broken claim/receipt links, payment history conflicts, and unresolved ownership reviews.</div><div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" data-fliq="run-diagnostics">Run Diagnostics</button></div></div>`;const pill=r.status==='PASS'?'green':r.status==='FAIL'?'red':'gold';return `<div class="fliq-section"><div class="fliq-section-title"><span>Diagnostics / Health Check</span><span class="fliq-pill ${pill}">${esc(r.status)}</span></div><div class="fliq-muted">Last run: ${esc(fmt(r.runAt))} · ${r.failCount} failure(s) · ${r.warnCount} warning(s)</div><div class="fliq-list" style="margin-top:8px">${r.checks.map(c=>`<div class="fliq-list-item"><div class="fliq-item-top"><b>${esc(c.name)}</b><span class="fliq-pill ${c.severity==='PASS'?'green':c.severity==='FAIL'?'red':'gold'}">${esc(c.severity)}</span></div><div class="fliq-muted" style="margin-top:4px">${esc(c.detail)}</div></div>`).join('')}</div><div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" data-fliq="run-diagnostics">Run Again</button></div></div>`;}'''
if anchor not in s: raise SystemExit('movementById anchor missing')
s=s.replace(anchor,addition,1)

needle='</div><div class="fliq-section"><div class="fliq-section-title"><span>Backup & Recovery</span></div>'
repl='</div>${diagnosticsHtml()}<div class="fliq-section"><div class="fliq-section-title"><span>Backup & Recovery</span></div>'
if needle not in s: raise SystemExit('settings backup anchor missing')
s=s.replace(needle,repl,1)

needle="if(a==='clear-cache'){try{t.disabled=true;await clearRefreshableCache();}catch(e){toast(String(e&&e.message||e));t.disabled=false;}return;}"
repl="if(a==='run-diagnostics'){runHealthCheck();return;}"+needle
if needle not in s: raise SystemExit('action anchor missing')
s=s.replace(needle,repl,1)

p.write_text(s)
# trigger
