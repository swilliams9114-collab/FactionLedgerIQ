from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.5.1','// @version      1.5.2',1)
s=s.replace("const VERSION='1.5.1';","const VERSION='1.5.2';",1)

def replace_func(name,next_name,new_text):
    global s
    a=s.index('function '+name)
    b=s.index('function '+next_name,a)
    s=s[:a]+new_text.rstrip()+"\n"+s[b:]

replace_func('receiptCalcText(g){','movementReceipt(p){',r'''function receiptCalcLines(g){const out=[],name=g.itemName,rate=money(g.rate);if(g.knownQty){let note='purchase price';if(g.maxPaid&&g.maxPaid<g.rate)note='purchased below MV';else if(g.minPaid&&g.minPaid<g.rate&&g.maxPaid===g.rate)note='purchased at/below MV';out.push(`${Number(g.knownQty).toLocaleString()}x ${name} ${note==='purchase price'?'@ '+rate+' (purchase price)':note+' → '+rate+' each'}`);}if(g.unknownQty)out.push(`${Number(g.unknownQty).toLocaleString()}x ${name} @ ${rate} MV`);return out;}
''')

replace_func('movementReceipt(p){','generateReceipt(){',r'''function movementReceipt(p){const groups=receiptDepositGroups(p),total=(p.claims||[]).reduce((n,c)=>n+Number(c.amount||0),0),firstTs=(p.movements||[]).map(m=>m.timestamp).filter(Boolean).sort()[0]||p.generatedAt||'',l=[discordUtcStamp(firstTs)];for(const g of groups){const dest=g.destination==='FACTION_ARMORY'?(p.factionName?`${p.factionName}'s armory`:'Faction Armory'):g.destination==='DISPLAY_CASE'?'Display Case':friendly(g.destination);l.push(`You deposited **${receiptItemList(g.items)}** into **${dest}**`);}const calc=receiptCalcGroups(p).flatMap(receiptCalcLines);if(calc.length)l.push('','Reimbursement:',...calc);const zero=zeroDepositGroups(p);if(zero.length)l.push(`Faction-owned: ${zero.map(g=>`${Number(g.qty||0).toLocaleString()}x ${g.itemName}`).join(', ')} ($0)`);l.push('',`**Amount Owed: ${money(total)}**`);return l.join('\n');}
''')

p.write_text(s)
print('patched Discord reimbursement lines v1.5.2')
