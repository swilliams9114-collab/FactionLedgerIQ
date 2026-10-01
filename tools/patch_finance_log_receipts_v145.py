from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.4.4','// @version      1.4.5',1)
s=s.replace("const VERSION='1.4.4';","const VERSION='1.4.5';",1)

# Add compact UTC timestamp + deposit summary helpers before movementReceipt.
start=s.index('function movementReceipt(p)')
end=s.index('async function generateReceipt()', start)
new_block=r'''function discordUtcStamp(v){const d=new Date(v||0);if(!Number.isFinite(d.getTime()))return'';const z=n=>String(n).padStart(2,'0');return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())} - ${z(d.getUTCDate())}/${z(d.getUTCMonth()+1)}/${String(d.getUTCFullYear()).slice(-2)}`;}
function receiptDepositGroups(p){const map=new Map();for(const m of p.movements||[]){if(!['ARMORY_IN','DISPLAY_IN'].includes(m.type))continue;const key=m.to||'';if(!map.has(key))map.set(key,{destination:key,items:new Map(),timestamps:[]});const g=map.get(key),ik=String(m.itemId||m.itemName||'');if(!g.items.has(ik))g.items.set(ik,{itemName:m.itemName||itemName(m.itemId),qty:0});g.items.get(ik).qty+=Number(m.qty||0);if(m.timestamp)g.timestamps.push(m.timestamp);}return Array.from(map.values()).map(g=>({...g,items:Array.from(g.items.values())}));}
function receiptItemList(items){return (items||[]).map(x=>`${Number(x.qty||0).toLocaleString()}x ${x.itemName}`).join(', ');}
function simpleVerification(p){const s=receiptVerificationSummary(p);if(String(s).includes('Faction News'))return 'Faction News';if(String(s).includes('Display Case'))return 'Display Case';if(s==='VERIFIED')return 'Verified';return s;}
function movementReceipt(p){const groups=receiptDepositGroups(p),total=(p.claims||[]).reduce((n,c)=>n+Number(c.amount||0),0),firstTs=(p.movements||[]).map(m=>m.timestamp).filter(Boolean).sort()[0]||p.generatedAt||'',shortBatch=cutPrefix(p.batchId,'BATCH-'),l=['**FactionLedgerIQ**',`${p.player.name||'Member'}${p.player.id?' ['+p.player.id+']':''}`,discordUtcStamp(firstTs)];for(const g of groups){const dest=g.destination==='FACTION_ARMORY'?(p.factionName?`${p.factionName}'s armory`:'Faction Armory'):g.destination==='DISPLAY_CASE'?'Display Case':friendly(g.destination);l.push(`Deposited **${receiptItemList(g.items)}** into **${dest}**`);}l.push('',`**Amount Owed: ${money(total)}**`,`Verified: ${simpleVerification(p)}`,`Receipt: \`${shortBatch}\``,`||FLIQ:${encodePayload(p)}||`);return l.join('\n');}
'''
s=s[:start]+new_block+s[end:]

# Replace payment receipt with a finance-log style summary.
start=s.index('function paymentReceipt(p)')
end=s.index('function paymentPayloadFromBatch', start)
new_pay=r'''function paymentReceipt(p){const shortPay=cutPrefix(p.batchId,'PAY-'),shortSource=cutPrefix(p.sourceReceiptBatchId,'BATCH-'),stamp=discordUtcStamp(p.paidAt||p.generatedAt),l=['**FactionLedgerIQ Payment**',`${p.member.name||'Member'}${p.member.id?' ['+p.member.id+']':''}`,stamp,`Paid: **${money(p.total)}**`,`For Receipt: \`${shortSource||'Unknown'}\``,p.leadership&&p.leadership.name?`Processed By: ${p.leadership.name}${p.leadership.id?' ['+p.leadership.id+']':''}`:'',`Status: ${p.verificationMethod==='API_VERIFIED'?'VERIFIED':'MANUAL APPROVAL'}`,`Payment: \`${shortPay}\``,`||FLIQ:${encodePayload(p)}||`].filter(Boolean);return l.join('\n');}
'''
s=s[:start]+new_pay+s[end:]

p.write_text(s)
print('patched to v1.4.5 finance log receipts')
