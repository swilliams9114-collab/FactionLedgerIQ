from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.5.1','// @version      1.5.2',1)
s=s.replace("const VERSION='1.5.1';","const VERSION='1.5.2';",1)

start=s.index('function receiptCalcGroups(p){')
end=s.index('function generateReceipt(){', start)
new=r'''function receiptCalcGroups(p){const map=new Map();for(const c of p.claims||[]){const q=Math.max(0,Number(c.qty||0));if(!q)continue;const rate=q?Math.round(Number(c.amount||0)/q):0,paid=Number(c.paidEach||0),mvUsed=Number(c.mvEachFrozen||0),known=c.costBasisKnown===true,category=!known?'MV':paid>mvUsed?'ABOVE':'BELOW',key=[c.itemId||c.itemName,rate,category].join('|');if(!map.has(key))map.set(key,{itemId:c.itemId,itemName:c.itemName||itemName(c.itemId),qty:0,rate,category});map.get(key).qty+=q;}return Array.from(map.values());}
function receiptCalcText(g){const qty=Number(g.qty||0).toLocaleString(),rate=money(g.rate);if(g.category==='BELOW')return `${qty}x ${g.itemName} purchased below MV → ${rate} each`;if(g.category==='ABOVE')return `${qty}x ${g.itemName} purchased above MV → ${rate} each`;return `${qty}x ${g.itemName} @ ${rate} MV`;}
function movementReceipt(p){const groups=receiptDepositGroups(p),total=(p.claims||[]).reduce((n,c)=>n+Number(c.amount||0),0),firstTs=(p.movements||[]).map(m=>m.timestamp).filter(Boolean).sort()[0]||p.generatedAt||'',l=[discordUtcStamp(firstTs)];for(const g of groups){const dest=g.destination==='FACTION_ARMORY'?(p.factionName?`${p.factionName}'s armory`:'Faction Armory'):g.destination==='DISPLAY_CASE'?'Display Case':friendly(g.destination);l.push(`You deposited **${receiptItemList(g.items)}** into **${dest}**`);}const calc=receiptCalcGroups(p);if(calc.length){l.push('','Reimbursement:');for(const g of calc)l.push(receiptCalcText(g));}const zero=zeroDepositGroups(p);if(zero.length)l.push(`Faction-owned: ${zero.map(g=>`${Number(g.qty||0).toLocaleString()}x ${g.itemName}`).join(', ')} ($0)`);l.push('',`**Amount Owed: ${money(total)}**`);return l.join('\n');}
'''
s=s[:start]+new+s[end:]

p.write_text(s)
print('patched v1.5.2 reimbursement Discord format')
