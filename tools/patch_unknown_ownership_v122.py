from pathlib import Path
import re

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.2.1','// @version      1.2.2',1)
s=s.replace("const VERSION='1.2.1';","const VERSION='1.2.2';",1)

anchor="function movementById(id){return state.movements.find(m=>m.id===id)||null;}"
insert="""function movementById(id){return state.movements.find(m=>m.id===id)||null;}
function movementAllocations(m){return (m&&Array.isArray(m.allocations)?m.allocations:[]).filter(a=>a&&a.status!=='VOID'&&a.sourceType!=='INFERRED_PERSONAL');}"""
if anchor not in s: raise SystemExit('movementById anchor not found')
s=s.replace(anchor,insert,1)

make_anchor="function makeClaim(m,a,mvEach){if(a.owner!==P||!a.qty)return null;const paid=a.costBasisKnown?Number(a.costEach||0):0,owedEach=a.costBasisKnown?Math.max(paid,mvEach):mvEach,c={id:uid('CLM'),movementId:m.id,itemId:m.itemId,itemName:m.itemName,qty:Number(a.qty),paidEach:paid,costBasisKnown:a.costBasisKnown===true,mvEachFrozen:mvEach,amount:Math.round(owedEach*Number(a.qty)),status:'OPEN',createdAt:new Date().toISOString(),submittedAt:'',reimbursedAt:'',voidedAt:'',voidReason:''};state.claims.push(c);return c;}"
extra="""function makeClaim(m,a,mvEach){if(a.owner!==P||!a.qty)return null;const paid=a.costBasisKnown?Number(a.costEach||0):0,owedEach=a.costBasisKnown?Math.max(paid,mvEach):mvEach,c={id:uid('CLM'),movementId:m.id,itemId:m.itemId,itemName:m.itemName,qty:Number(a.qty),paidEach:paid,costBasisKnown:a.costBasisKnown===true,mvEachFrozen:mvEach,amount:Math.round(owedEach*Number(a.qty)),status:'OPEN',createdAt:new Date().toISOString(),submittedAt:'',reimbursedAt:'',voidedAt:'',voidReason:''};state.claims.push(c);return c;}
function migrateInferredPersonal(){let changed=false;const now=new Date().toISOString();for(const l of state.lots||[]){if(!l||l.sourceType!=='INFERRED_PERSONAL'||l.status==='VOID')continue;l.status='VOID';l.qtyRemaining=0;l.voidedAt=now;l.voidReason='Automatic correction: ownership had been inferred instead of confirmed';changed=true;}for(const m of state.movements||[]){if(!m||m.status==='VOID'||!Array.isArray(m.allocations))continue;let claimIndex=0,unknown=0;for(const a of m.allocations){if(!a||a.owner!==P)continue;const cid=(m.claimIds||[])[claimIndex++];if(a.sourceType!=='INFERRED_PERSONAL'||a.status==='VOID')continue;unknown+=Number(a.qty||0);a.status='VOID';a.voidedAt=now;a.voidReason='Automatic correction: inferred ownership removed';const c=claimById(cid);if(c&&c.status!=='VOID'&&c.status!=='REIMBURSED'){c.status='VOID';c.voidedAt=now;c.voidReason='Automatic correction: reimbursement cannot be based on inferred ownership';changed=true;}}if(unknown>0){m.unknownQty=Number(m.unknownQty||0)+unknown;m.status='REVIEW';m.notes=((m.notes?m.notes+' ':'')+'Ownership review required for '+unknown+' item(s); prior inferred-personal allocation was removed.').trim();changed=true;}}return changed;}
function classifyUnknownMovement(id,owner){const m=movementById(id),q=m?Math.max(0,Number(m.unknownQty||0)):0;if(!m||m.status!=='REVIEW'||!q)throw new Error('No unresolved ownership remains on this movement');if(owner!==P&&owner!==F)throw new Error('Choose Personal or Faction ownership');const a={id:uid('ALLOC'),movementId:m.id,lotId:'',rootId:'',itemId:m.itemId,owner,location:INV,qty:q,sourceType:'MANUAL_CLASSIFICATION',costBasisKnown:false,costEach:0,mvAtSource:Number(m.mvEachFrozen||0),status:'ACTIVE'};m.allocations=m.allocations||[];m.allocations.push(a);if(owner===P){const c=makeClaim(m,a,Number(m.mvEachFrozen||0));if(c){m.claimIds=m.claimIds||[];m.claimIds.push(c.id);}}m.unknownQty=0;m.status='ACTIVE';m.classifiedAt=new Date().toISOString();m.classifiedOwnership=owner;m.notes=((m.notes?m.notes+' ':'')+'Unknown quantity manually classified as '+(owner===P?'Personal':'Faction')+'.').trim();save();toast(q+' item(s) classified as '+(owner===P?'Personal':'Faction'));}"""
if make_anchor not in s: raise SystemExit('makeClaim anchor not found')
s=s.replace(make_anchor,extra,1)

start=s.find('function armoryIn(o){')
end=s.find('\nfunction localMove',start)
if start<0 or end<0: raise SystemExit('armoryIn block not found')
new_armory="""function armoryIn(o){const id=String(o.itemId),q=Math.max(1,Number(o.qty||1)),price=Math.max(0,Number(o.mvEach!=null?o.mvEach:mv(id))),fBefore=balance(id,F,INV),pBefore=balance(id,P,INV);let fq=o.factionQty==null?Math.min(q,fBefore):Math.max(0,Number(o.factionQty||0));if(fq>fBefore||fq>q)throw new Error('Not enough verified faction-owned stock');let remaining=q-fq,pq=o.personalQty==null?Math.min(remaining,pBefore):Math.max(0,Number(o.personalQty||0));if(pq>pBefore||pq>remaining)throw new Error('Not enough verified personal stock');const unknown=q-fq-pq,m={id:uid('MOV'),type:'ARMORY_IN',itemId:id,itemName:o.itemName||itemName(id),qty:q,from:INV,to:'FACTION_ARMORY',timestamp:o.timestamp||new Date().toISOString(),apiVerified:o.apiVerified===true,apiLogIds:o.apiLogIds||[],mvEachFrozen:price,preBalanceFaction:fBefore,preBalancePersonal:pBefore,allocations:[],claimIds:[],receiptBatchId:'',status:unknown>0?'REVIEW':'ACTIVE',unknownQty:unknown,notes:unknown>0?('Ownership unknown for '+unknown+' item(s). No reimbursement claim created until classified.'):''};const fr=consume(id,F,INV,fq,m.id),pr=consume(id,P,INV,pq,m.id);if(fr.unresolved||pr.unresolved)throw new Error('Could not allocate verified stock');m.allocations=fr.allocations.concat(pr.allocations);state.movements.push(m);m.allocations.forEach(a=>{const c=makeClaim(m,a,price);if(c)m.claimIds.push(c.id);});return m;}"""
s=s[:start]+new_armory+s[end:]

old_special="""const held=balance(itemId,F,INV),w=whitelist(itemId,itemName(itemId));if(!held&&!w){state.movements.push({id:uid('MOV'),type:'ARMORY_IN',itemId,itemName:itemName(itemId),qty,from:INV,to:'FACTION_ARMORY',timestamp:new Date(Number(log.timestamp||0)*1000).toISOString(),apiVerified:true,apiLogIds:[id],mvEachFrozen:mv(itemId),preBalanceFaction:0,preBalancePersonal:balance(itemId,P,INV),allocations:[],claimIds:[],receiptBatchId:'',status:'REVIEW',notes:'Non-whitelisted deposit with no tracked faction ownership. No reimbursement claim created.'});used=changed=true;continue;}try{armoryIn({itemId,itemName:itemName(itemId),qty,mvEach:mv(itemId),timestamp:new Date(Number(log.timestamp||0)*1000).toISOString(),apiVerified:true,apiLogIds:[id]});used=changed=true;}catch(e){console.warn('[FLIQ] deposit allocation review',e);}"""
new_special="""try{armoryIn({itemId,itemName:itemName(itemId),qty,mvEach:mv(itemId),timestamp:new Date(Number(log.timestamp||0)*1000).toISOString(),apiVerified:true,apiLogIds:[id]});used=changed=true;}catch(e){console.warn('[FLIQ] deposit allocation review',e);}"""
if old_special not in s: raise SystemExit('reconcile special block not found')
s=s.replace(old_special,new_special,1)

s=s.replace("allocations:(m.allocations||[]).map(a=>({owner:a.owner,qty:a.qty,sourceType:a.sourceType}))", "allocations:movementAllocations(m).map(a=>({owner:a.owner,qty:a.qty,sourceType:a.sourceType}))")
s=s.replace("allocations:(m.allocations||[]).map(a=>({owner:a.owner,qty:a.qty,sourceType:a.sourceType}))", "allocations:movementAllocations(m).map(a=>({owner:a.owner,qty:a.qty,sourceType:a.sourceType}))")

old_card=re.search(r"function movementCard\(m\)\{.*?\n\nfunction homeHtml",s,re.S)
if not old_card: raise SystemExit('movementCard block not found')
new_card="""function movementCard(m){const allocs=movementAllocations(m),cs=(m.claimIds||[]).map(claimById).filter(c=>c&&c.status!=='VOID'),owed=cs.reduce((n,c)=>n+Number(c.amount||0),0),fq=allocs.filter(a=>a.owner===F).reduce((n,a)=>n+Number(a.qty||0),0),pq=allocs.filter(a=>a.owner===P).reduce((n,a)=>n+Number(a.qty||0),0),uq=Math.max(0,Number(m.unknownQty||0)),review=m.status==='REVIEW'&&uq>0;return `<div class=\"fliq-list-item\"><div class=\"fliq-item-top\"><div><div class=\"fliq-item-name\">${esc(m.itemName)}</div><div class=\"fliq-muted\">${esc(fmt(m.timestamp))}</div></div><span class=\"fliq-pill ${review?'gold':m.apiVerified?'green':'gold'}\">${review?'REVIEW':m.apiVerified?'API VERIFIED':'MANUAL'}</span></div><div>${Number(m.qty||0).toLocaleString()} · ${esc(friendly(m.from))} → ${esc(friendly(m.to))}</div><div class=\"fliq-muted\">${fq?'Faction '+fq.toLocaleString()+' ':''}${pq?'Personal '+pq.toLocaleString():''}${uq?'Unknown '+uq.toLocaleString():''}${owed?' · Owed '+money(owed):''}</div>${review?`<div class=\"fliq-actions\"><button class=\"fliq-btn fliq-btn-small\" data-fliq=\"classify-unknown-personal\" data-id=\"${esc(m.id)}\">Unknown = Personal</button><button class=\"fliq-btn fliq-btn-small\" data-fliq=\"classify-unknown-faction\" data-id=\"${esc(m.id)}\">Unknown = Faction</button></div>`:''}</div>`;}
function ownershipReviewHtml(){const rows=state.movements.filter(m=>m&&m.status==='REVIEW'&&Number(m.unknownQty||0)>0).slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));if(!rows.length)return '';return `<div class=\"fliq-section\"><div class=\"fliq-section-title\"><span>Ownership Review</span><span class=\"fliq-pill gold\">${rows.length}</span></div><div class=\"fliq-muted\" style=\"margin-bottom:8px\">These Armory deposits contain quantity LedgerIQ cannot prove was Personal or Faction owned. No reimbursement is created until you classify it.</div><div class=\"fliq-list\">${rows.map(movementCard).join('')}</div></div>`;}

function homeHtml"""
s=s[:old_card.start()]+new_card+s[old_card.end():]

s=s.replace("${receiptHistoryHtml()}`;}", "${ownershipReviewHtml()}${receiptHistoryHtml()}`;}",1)

s=s.replace("state.movements.filter(m=>m.status!=='VOID'&&!m.receiptBatchId&&['ARMORY_IN','ARMORY_OUT','DISPLAY_IN','DISPLAY_OUT'].includes(m.type))", "state.movements.filter(m=>m.status==='ACTIVE'&&!m.receiptBatchId&&['ARMORY_IN','ARMORY_OUT','DISPLAY_IN','DISPLAY_OUT'].includes(m.type))")
s=s.replace("state.movements.filter(m=>m.status!=='VOID'&&!m.receiptBatchId&&['ARMORY_IN','ARMORY_OUT','DISPLAY_IN','DISPLAY_OUT'].includes(m.type))", "state.movements.filter(m=>m.status==='ACTIVE'&&!m.receiptBatchId&&['ARMORY_IN','ARMORY_OUT','DISPLAY_IN','DISPLAY_OUT'].includes(m.type))")

act_anchor="if(a==='undo-restore'){try{undoLastRestore();}catch(e){toast(String(e&&e.message||e));}return;}"
act_insert="""if(a==='undo-restore'){try{undoLastRestore();}catch(e){toast(String(e&&e.message||e));}return;}if(a==='classify-unknown-personal'||a==='classify-unknown-faction'){try{classifyUnknownMovement(String(t.dataset.id||''),a==='classify-unknown-personal'?P:F);}catch(e){toast(String(e&&e.message||e));}return;}"""
if act_anchor not in s: raise SystemExit('action anchor not found')
s=s.replace(act_anchor,act_insert,1)

boot_old="function boot(){const cleanedPurchases=purgePreWhitelistPurchases(),cleanedHistory=purgePreTrackingEvents();if(cleanedPurchases||cleanedHistory)save(false);"
boot_new="function boot(){const cleanedPurchases=purgePreWhitelistPurchases(),cleanedHistory=purgePreTrackingEvents(),cleanedInferred=migrateInferredPersonal();if(cleanedPurchases||cleanedHistory||cleanedInferred)save(false);"
if boot_old not in s: raise SystemExit('boot anchor not found')
s=s.replace(boot_old,boot_new,1)

p.write_text(s)
