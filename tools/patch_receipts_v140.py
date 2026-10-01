from pathlib import Path
p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.4.0','// @version      1.4.1',1)
s=s.replace("const VERSION='1.4.0';","const VERSION='1.4.1';",1)

old="p.verification=await verifyMovementPayload(p);const text=movementReceipt(p)"
new="p.verification=await verifyMovementPayload(p);for(const c of p.claims||[])c.verification=p.verification[c.movementId]||'UNVERIFIED';const text=movementReceipt(p)"
if old not in s: raise SystemExit('generate verification anchor missing')
s=s.replace(old,new,1)

old="`Deposited To: ${friendly(g.destination)}`,`Reimbursement ID${g.ids.length===1?'':'s'}: ${g.ids.map(id=>'`'+id+'`').join(', ')}`"
new="`Deposited To: ${friendly(g.destination)}`,`Verification: **${receiptVerifyLabel(g.verification)}**`,`Reimbursement ID${g.ids.length===1?'':'s'}: ${g.ids.map(id=>'`'+id+'`').join(', ')}`"
if old not in s: raise SystemExit('member reimbursement verification anchor missing')
s=s.replace(old,new,1)

old="p.factionName?`**Faction:** ${p.factionName}`:'',`**Source Receipt Batch:**"
new="p.factionName?`**Faction:** ${p.factionName}`:'',`**Processed By:** ${p.leadership&&p.leadership.name||'Leadership'}${p.leadership&&p.leadership.id?' ['+p.leadership.id+']':''}`,`**Source Receipt Batch:**"
if old not in s: raise SystemExit('payment processor anchor missing')
s=s.replace(old,new,1)

old="`Amount Paid: **${money(g.amount)}**`,`Reimbursement ID${g.ids.length===1?'':'s'}: ${g.ids.map(id=>'`'+id+'`').join(', ')}`"
new="`Amount Paid: **${money(g.amount)}**`,`Verification: **${receiptVerifyLabel(g.verification)}**`,`Reimbursement ID${g.ids.length===1?'':'s'}: ${g.ids.map(id=>'`'+id+'`').join(', ')}`"
if old not in s: raise SystemExit('payment verification anchor missing')
s=s.replace(old,new,1)

p.write_text(s)
