from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.4.1','// @version      1.4.2',1)
s=s.replace("const VERSION='1.4.1';","const VERSION='1.4.2';",1)

old="""function encodePayload(p){return btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/g,'');}\nfunction decodePayload(code){let s=String(code||'').trim().replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return JSON.parse(decodeURIComponent(escape(atob(s))));}\nfunction extractPayload(text){const m=String(text||'').match(/FLIQ-AUDIT:([A-Za-z0-9_-]+)/);if(!m)throw new Error('No FactionLedgerIQ audit code found');return decodePayload(m[1]);}\n"""
new="""function compactAuditPayload(p){if(!p||typeof p!=='object')return p;if(p.kind==='MOVEMENT'){const moves=(p.movements||[]),idx=new Map(moves.map((m,i)=>[String(m.movementId||''),i]));return{k:'M',v:p.version||VERSION,b:p.batchId||'',g:p.generatedAt||'',p:[p.player&&p.player.name||'',p.player&&p.player.id||''],f:p.factionName||'',m:moves.map(m=>[m.type||'',m.timestamp||'',m.itemId||'',m.itemName||'',Number(m.qty||0),m.to||'',m.apiVerified?1:0,m.verificationSource||'',(p.verification||{})[m.movementId]||'']),c:(p.claims||[]).map(c=>[c.id||'',idx.get(String(c.movementId||''))??0,Number(c.qty||0),Number(c.paidEach||0),c.costBasisKnown?1:0,Number(c.mvAtPurchase||0),Number(c.mvEachFrozen||0),Number(c.amount||0),c.status||'SUBMITTED',c.verification||''])};}if(p.kind==='PAYMENT'){return{k:'P',v:p.version||VERSION,b:p.batchId||'',s:p.sourceReceiptBatchId||'',g:p.generatedAt||'',d:p.paidAt||'',f:p.factionName||'',p:[p.member&&p.member.name||'',p.member&&p.member.id||''],l:[p.leadership&&p.leadership.name||'',p.leadership&&p.leadership.id||''],vm:p.verificationMethod||'',c:(p.claims||[]).map(c=>[c.id||'',c.itemId||'',c.itemName||'',Number(c.qty||0),Number(c.paidEach||0),c.costBasisKnown?1:0,Number(c.mvAtPurchase||0),Number(c.mvEachFrozen||0),Number(c.amount||0),c.verification||''])};}return p;}\nfunction expandAuditPayload(x){if(!x||typeof x!=='object'||!x.k)return x;if(x.k==='M'){const movements=(x.m||[]).map((r,i)=>({movementId:'R'+i,type:r[0]||'',timestamp:r[1]||'',itemId:String(r[2]||''),itemName:r[3]||'',qty:Number(r[4]||0),from:'PERSONAL_INVENTORY',to:r[5]||'',apiVerified:!!r[6],apiLogIds:[],verificationSource:r[7]||'',allocations:[],claimIds:[]})),verification={};movements.forEach((m,i)=>{const r=(x.m||[])[i]||[];verification[m.movementId]=r[8]||(m.type==='DISPLAY_IN'&&m.apiVerified?'VERIFIED_DISPLAY':m.apiVerified?'MEMBER_VERIFIED':'UNVERIFIED');});const claims=(x.c||[]).map(r=>{const i=Number(r[1]||0),m=movements[i]||{},c={id:r[0]||'',movementId:m.movementId||('R'+i),itemId:m.itemId||'',itemName:m.itemName||'',qty:Number(r[2]||0),paidEach:Number(r[3]||0),costBasisKnown:!!r[4],mvAtPurchase:Number(r[5]||0),mvEachFrozen:Number(r[6]||0),amount:Number(r[7]||0),status:r[8]||'SUBMITTED',destination:m.to||'FACTION_ARMORY',verification:r[9]||verification[m.movementId]||''};if(m.claimIds)m.claimIds.push(c.id);return c;});return{kind:'MOVEMENT',version:x.v||'',batchId:x.b||'',generatedAt:x.g||'',player:{name:x.p&&x.p[0]||'',id:x.p&&x.p[1]||''},factionName:x.f||'',movements,claims,verification};}if(x.k==='P'){const claims=(x.c||[]).map(r=>({id:r[0]||'',itemId:String(r[1]||''),itemName:r[2]||'',qty:Number(r[3]||0),paidEach:Number(r[4]||0),costBasisKnown:!!r[5],mvAtPurchase:Number(r[6]||0),mvEachFrozen:Number(r[7]||0),amount:Number(r[8]||0),destination:'FACTION_ARMORY',verification:r[9]||''}));return{kind:'PAYMENT',version:x.v||'',batchId:x.b||'',sourceReceiptBatchId:x.s||'',generatedAt:x.g||'',paidAt:x.d||'',factionName:x.f||'',member:{name:x.p&&x.p[0]||'',id:x.p&&x.p[1]||''},leadership:{name:x.l&&x.l[0]||'',id:x.l&&x.l[1]||''},verificationMethod:x.vm||'',claims,total:claims.reduce((n,c)=>n+Number(c.amount||0),0)};}return x;}\nfunction encodePayload(p){return btoa(unescape(encodeURIComponent(JSON.stringify(compactAuditPayload(p))))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/g,'');}\nfunction decodePayload(code){let s=String(code||'').trim().replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return expandAuditPayload(JSON.parse(decodeURIComponent(escape(atob(s)))));}\nfunction extractPayload(text){const m=String(text||'').match(/FLIQ-AUDIT:([A-Za-z0-9_-]+)/);if(!m)throw new Error('No FactionLedgerIQ audit code found');return decodePayload(m[1]);}\n"""
assert old in s, 'audit codec block not found'
s=s.replace(old,new,1)

old_label="function receiptVerifyLabel(v){return v==='VERIFIED_ARMORY'?'VERIFIED — Faction News API':v==='VERIFIED_DISPLAY'?'VERIFIED — Display Case API':v==='MEMBER_VERIFIED'?'PENDING — Member API evidence':'NEEDS REVIEW';}"
new_label=old_label+"\nfunction leadershipVerifyLabel(v){return v==='VERIFIED_ARMORY'?'Faction News Verified':v==='VERIFIED_DISPLAY'?'Display Case Verified':v==='MEMBER_VERIFIED'?'Member API Confirmed':v==='MANUAL_LEADERSHIP'?'Manual Check':'Needs Review';}"
assert old_label in s, 'receiptVerifyLabel not found'
s=s.replace(old_label,new_label,1)

anchor="async function verifyMovementPayload(p)"
insert="""function paymentPayloadFromBatch(b){if(!b)return null;if(b.payload&&b.payload.kind==='PAYMENT')return b.payload;const source=(state.receiptBatches||[]).find(x=>String(x.id||'')===String(b.sourceBatchId||'')),src=source?receiptPayloadFromBatch(source):null,wanted=new Set((b.claimIds||[]).map(String));let claims=src?(src.claims||[]).filter(c=>wanted.has(String(c.id))).map(c=>({...c,verification:c.verification||((src.verification||{})[c.movementId]||'')})):[];if(!claims.length){claims=(state.auditClaims||[]).filter(a=>wanted.has(String(a.claimId||''))).map(a=>({id:a.claimId,itemId:a.itemId,itemName:a.itemName,qty:Number(a.qty||0),paidEach:0,costBasisKnown:false,mvAtPurchase:0,mvEachFrozen:Number(a.qty||0)?Math.round(Number(a.amount||0)/Number(a.qty||1)):0,amount:Number(a.amount||0),destination:'FACTION_ARMORY',verification:a.verificationDetail||''}));}if(!claims.length)return null;const a=(state.auditClaims||[]).find(x=>wanted.has(String(x.claimId||'')))||{};return{kind:'PAYMENT',version:VERSION,batchId:b.id||'',sourceReceiptBatchId:b.sourceBatchId||'',generatedAt:b.paidAt||'',paidAt:b.paidAt||'',factionName:src&&src.factionName||state.settings.factionName||'',member:{name:src&&src.player&&src.player.name||a.playerName||b.memberName||'',id:src&&src.player&&src.player.id||a.playerId||b.memberId||''},leadership:{name:b.leadershipName||state.settings.playerName||'',id:b.leadershipId||state.settings.playerId||''},verificationMethod:b.verificationMethod||'API_VERIFIED',claims,total:claims.reduce((n,c)=>n+Number(c.amount||0),0)};}\nfunction openPaymentBatch(id){const b=(state.paymentBatches||[]).find(x=>String(x.id||'')===String(id||''));if(!b){toast('Payment receipt not found');return;}const p=paymentPayloadFromBatch(b);if(!p){toast('Payment receipt can no longer be reconstructed');return;}const text=paymentReceipt(p);b.payload=p;b.receiptText=text;save(false);showReceipt('Discord Payment Receipt',text);}\nfunction paymentReceiptHistoryHtml(title='Payment Receipt History'){const batches=(state.paymentBatches||[]).slice().sort((a,b)=>new Date(b.paidAt||0)-new Date(a.paidAt||0)).slice(0,12);if(!batches.length)return '';return `<div class=\"fliq-section\"><div class=\"fliq-section-title\"><span>${esc(title)}</span><span class=\"fliq-muted\">${batches.length}</span></div><div class=\"fliq-list\">${batches.map(b=>{const p=paymentPayloadFromBatch(b),member=p&&p.member?(p.member.name||p.member.id||'Member'):(b.memberName||'Member'),total=p?Number(p.total||0):Number(b.total||0),source=p&&p.sourceReceiptBatchId?p.sourceReceiptBatchId:(b.sourceBatchId||'');return `<div class=\"fliq-list-item\"><div class=\"fliq-item-top\"><div><b>${esc(member)}</b> · ${money(total)}<div class=\"fliq-muted\">${esc(fmt(b.paidAt))}</div><div class=\"fliq-muted\">Source: ${esc(source)} · Payment: ${esc(b.id||'')}</div></div><button class=\"fliq-btn fliq-btn-small\" data-fliq=\"view-payment-receipt\" data-id=\"${esc(b.id||'')}\">View / Copy</button></div></div>`;}).join('')}</div></div>`;}\n"""
assert anchor in s, 'verifyMovementPayload anchor not found'
s=s.replace(anchor,insert+anchor,1)

old_import="if(n)save();else render();toast(n?`${n} claim(s) marked reimbursed${dup?` · ${dup} already closed`:''}`:`Receipt already imported · ${dup} claim(s) already closed`);return;"
new_import="const existingPay=(state.paymentBatches||[]).find(b=>String(b.id||'')===String(p.batchId||'')),payText=paymentReceipt(p);if(!existingPay)state.paymentBatches.push({id:p.batchId,sourceBatchId:p.sourceReceiptBatchId||'',paidAt:p.paidAt||p.generatedAt||new Date().toISOString(),claimIds:(p.claims||[]).map(c=>c.id),total:Number(p.total||0),verificationMethod:p.verificationMethod||'',memberName:p.member&&p.member.name||'',memberId:p.member&&p.member.id||'',leadershipName:p.leadership&&p.leadership.name||'',leadershipId:p.leadership&&p.leadership.id||'',direction:'RECEIVED',payload:p,receiptText:payText});else{existingPay.payload=existingPay.payload||p;existingPay.receiptText=existingPay.receiptText||payText;}if(n||!existingPay)save();else render();toast(n?`${n} claim(s) marked reimbursed${dup?` · ${dup} already closed`:''}`:`Receipt already imported · ${dup} claim(s) already closed`);return;"
assert old_import in s, 'payment import save block not found'
s=s.replace(old_import,new_import,1)

old_pay="state.paymentBatches.push({id:pay.batchId,sourceBatchId:p.batchId,paidAt,claimIds:pay.claims.map(c=>c.id),total:pay.total,verificationMethod});currentAudit=null;save(false);showReceipt('Discord Payment Receipt',paymentReceipt(pay));render();}"
new_pay="const payText=paymentReceipt(pay);state.paymentBatches.push({id:pay.batchId,sourceBatchId:p.batchId,paidAt,claimIds:pay.claims.map(c=>c.id),total:pay.total,verificationMethod,memberName:pay.member.name||'',memberId:pay.member.id||'',leadershipName:pay.leadership.name||'',leadershipId:pay.leadership.id||'',direction:'SENT',payload:pay,receiptText:payText});currentAudit=null;save(false);showReceipt('Discord Payment Receipt',payText);render();}"
assert old_pay in s, 'payAudit storage block not found'
s=s.replace(old_pay,new_pay,1)

old_ver="r.verification==='INDEPENDENT_API'?'Leadership confirmed':r.verification==='MEMBER_VERIFIED'?'Member confirmed':r.verification==='MANUAL_LEADERSHIP'?'Manual check':r.verification"
assert old_ver in s, 'audit verification label expression not found'
s=s.replace(old_ver,"leadershipVerifyLabel(r.verification)",1)

# Append payment receipt history to Money Owed without relying on escaped HTML details.
cs=s.index('function claimsHtml()')
ce=s.index('function auditHtml()',cs)
block=s[cs:ce]
pos=block.rfind('`;')
assert pos!=-1, 'claimsHtml return end not found'
block=block[:pos]+"${paymentReceiptHistoryHtml('Payment Receipt History')}"+block[pos:]
s=s[:cs]+block+s[ce:]

# Append payment receipt history to Leadership.
as_=s.index('function auditHtml()')
ae=s.index('function settingsHtml()',as_)
block=s[as_:ae]
pos=block.rfind('`;')
assert pos!=-1, 'auditHtml return end not found'
block=block[:pos]+"${paymentReceiptHistoryHtml('Payment Receipt History')}"+block[pos:]
s=s[:as_]+block+s[ae:]

old_action="if(a==='view-receipt'){openReceiptBatch(String(t.dataset.id||''));return;}"
new_action=old_action+"if(a==='view-payment-receipt'){openPaymentBatch(String(t.dataset.id||''));return;}"
assert old_action in s, 'view receipt action not found'
s=s.replace(old_action,new_action,1)

p.write_text(s)
print('patched to v1.4.2')
