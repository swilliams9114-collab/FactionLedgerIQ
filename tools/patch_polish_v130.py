from pathlib import Path
import re
p=Path('FactionLedgerIQ.user.js')
s=p.read_text()
s=s.replace('// @version      1.2.13','// @version      1.3.0',1)
s=s.replace("const VERSION='1.2.13';","const VERSION='1.3.0';",1)

# Plain-English labels across the UI.
s=s.replace("['claims','Claims']","['claims','Money Owed']",1)
s=s.replace("['audit','Audit']","['audit','Leadership']",1)
s=s.replace('Ownership Review','Who Owns This?',1)
s=s.replace('These Armory deposits contain quantity LedgerIQ cannot prove was Personal or Faction owned. No reimbursement is created until you classify it.','LedgerIQ found Armory deposits where it cannot tell whether the items were yours or the faction\'s. Choose the owner before any money is owed.',1)
s=s.replace("${review?'REVIEW':m.apiVerified?'API VERIFIED':'MANUAL'}","${review?'NEEDS REVIEW':m.apiVerified?'CONFIRMED':'MANUAL ENTRY'}",1)
s=s.replace('Unknown = Personal','These Were Mine')
s=s.replace('Unknown = Faction','These Were Faction')
s=s.replace('Recent Movement','Recent Activity',1)
s=s.replace('No movement recorded yet.','No item activity recorded yet.',1)
s=s.replace("movement${unreported===1?'':'s'} need a Discord receipt.","item update${unreported===1?'':'s'} need a leadership receipt.",1)
s=s.replace('Generate Movement Receipt','Create Leadership Receipt',1)
s=s.replace('incoming transfer','incoming item transfer')
s=s.replace('waiting for classification.','waiting for you to identify what it is for.',1)
s=s.replace('Open + submitted','Waiting to be paid',1)

# Remove the temporary one-time Display correction from normal Inventory UI.
s,n=re.subn(r'<div class=\\"fliq-section\\"><div class=\\"fliq-section-title\\"><span>Existing Display Correction</span>.*?Correct Personal → Existing Display</button></div></div>', '', s, count=1, flags=re.S)
if n!=1: raise SystemExit('Display correction UI not found')

# Make Display wording easier to understand.
s=s.replace('Automatic for whitelisted items and faction-owned stock from the Armory. Any Display stock tracked here is faction-owned. Other Display Case items are ignored unless you add them below.','Whitelisted items in your Display Case are tracked automatically as faction-owned. Items taken from the Armory also stay faction-owned. Other Display Case items are ignored unless you add them below.',1)
s=s.replace('Add non-whitelisted Display item','Add another Display item to track',1)
s=s.replace('Faction-owned when present in Display','Treated as faction-owned while tracked in Display',1)

# Reimbursement page wording.
old="function claimsHtml(){const cs=state.claims.filter(c=>c.status!=='VOID').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)),open=cs.filter(c=>c.status==='OPEN'||c.status==='SUBMITTED'),paid=cs.filter(c=>c.status==='REIMBURSED');return `"
if old not in s: raise SystemExit('claimsHtml anchor missing')
s=s.replace('<span>Awaiting Reimbursement</span>','<span>Money Owed to You</span>',1)
s=s.replace('<div class=\\"fliq-muted\\">${esc(c.id)}</div>','<div class=\\"fliq-muted\\">Reimbursement ID: ${esc(c.id)}</div>',1)
s=s.replace("${esc(c.status)}","${c.status==='SUBMITTED'?'SENT TO LEADERSHIP':'READY'}",1)
s=s.replace('MV frozen: ${money(c.mvEachFrozen)} ea','Value used: ${money(c.mvEachFrozen)} each',1)
s=s.replace(" · Paid '+money(c.paidEach)+' ea"," · You paid '+money(c.paidEach)+' each",1)
s=s.replace(' · Cost unknown',' · Purchase cost not recorded',1)
s=s.replace('<b>Owed: ${money(c.amount)}</b>','<b>Amount owed: ${money(c.amount)}</b>',1)
s=s.replace('Mark Reimbursed','Mark as Paid',1)
s=s.replace('Import Leadership Reimbursement Receipt','Import Leadership Payment Receipt',1)
s=s.replace('Paste the leadership Discord reimbursement receipt','Paste the payment receipt leadership sent you',1)
s=s.replace('Reimbursement History','Paid Reimbursements',1)
s=s.replace('No reimbursements marked received yet.','No reimbursements have been marked paid yet.',1)

# Compact, plain-English member receipt. Internal payload remains unchanged.
receipt="""function movementReceipt(p){const l=['**FACTION LEDGER IQ — LEADERSHIP RECEIPT**','',`Player: ${p.player.name||'Unknown'}${p.player.id?' ['+p.player.id+']':''}`,p.factionName?'Faction: '+p.factionName:'',`Receipt: \\`${p.batchId}\\``,''].filter(x=>x!==undefined);p.movements.forEach(m=>{const cs=p.claims.filter(c=>c.movementId===m.movementId),amt=cs.reduce((n,c)=>n+Number(c.amount||0),0);l.push(`**${m.itemName} ×${Number(m.qty||0).toLocaleString()}**`);if(cs.length){const rate=cs.length===1?Number(cs[0].amount||0)/Math.max(1,Number(cs[0].qty||1)):0;if(rate)l.push('Cost used: '+money(rate)+' each');l.push('Amount owed: **'+money(amt)+'**','Reimbursement ID'+(cs.length>1?'s':'')+': '+cs.map(c=>'`'+c.id+'`').join(', '));}else{l.push('Amount owed: **$0**');}l.push('');});l.push('**TOTAL OWED:** '+money(p.claims.reduce((n,c)=>n+Number(c.amount||0),0)),'','FLIQ-AUDIT:'+encodePayload(p));return l.join('\\n');}"""
s,n=re.subn(r"function movementReceipt\(p\)\{.*?\n\}\nfunction generateReceipt",receipt+'\nfunction generateReceipt',s,count=1,flags=re.S)
if n!=1: raise SystemExit('movementReceipt replace failed')
s=s.replace('No unreported movements','No new item activity needs a receipt',1)
s=s.replace("showReceipt('Discord Movement Receipt',text)","showReceipt('Leadership Receipt',text)")
s=s.replace('<b>${moves.length} movement${moves.length===1?\'\':\'s\'}</b>','<b>${moves.length} item update${moves.length===1?\'\':\'s\'}</b>',1)
s=s.replace('Claimed: <b>${money(total)}</b>','Owed: <b>${money(total)}</b>',1)
s=s.replace('No reimbursement claim','No money owed',1)

# Leadership page wording while retaining internal NEW/REVIEW statuses.
s=s.replace('<span>Audit Result</span>','<span>Receipt Check</span>',1)
s=s.replace("${esc(r.status)}","${r.status==='NEW'?'READY TO PAY':r.status==='ALREADY_PAID'?'ALREADY PAID':'NEEDS REVIEW'}",1)
s=s.replace('Mark NEW Claims Paid + Create Receipt','Mark Ready Items Paid + Create Receipt',1)
s=s.replace('Approve REVIEW & Pay','Approve After Checking Torn + Pay',1)
s=s.replace('Use manual approval only after leadership independently checks the movement in Torn. The reimbursement receipt will record manual leadership approval.','Use this only after you personally confirm the item deposit in Torn. The payment receipt will note that leadership checked it manually.',1)
s=s.replace('Leadership Audit Import','Leadership Receipt Check',1)
s=s.replace('Paste the member Discord movement receipt. Claim IDs are checked against paid history and Armory movement is checked against faction news when your key has access.','Paste the member\'s LedgerIQ receipt. LedgerIQ checks the Reimbursement IDs against payment history and verifies the Armory deposit when your Torn permissions allow it.',1)
s=s.replace('Paste member movement receipt','Paste member Leadership Receipt',1)
s=s.replace('Audit Receipt','Check Receipt')
s=s.replace('Paid Claim History','Paid Reimbursement History',1)
s=s.replace('No leadership reimbursements recorded yet.','No leadership payments recorded yet.',1)

# Payment receipt terminology.
s=s.replace('Claim ID:','Reimbursement ID:')
s=s.replace('Claim IDs:','Reimbursement IDs:')
s=s.replace('TOTAL REIMBURSED','TOTAL PAID')
s=s.replace("toast('Claim marked reimbursed')","toast('Reimbursement marked paid')",1)
s=s.replace("toast('Audit failed: '","toast('Receipt check failed: '",1)

# Backup wording and hide destructive tools inside a collapsed Advanced Tools section.
s=s.replace('Backups include LedgerIQ inventory, movements, claims, receipts, raffle data, audit history, and settings.','Backups include your tracked items, item activity, reimbursements, receipts, raffle data, leadership payment history, and settings.',1)
pat=r'<div class=\\"fliq-section\\"><div class=\\"fliq-section-title\\"><span>Recovery / Reset</span></div>(.*?)</div><div class=\\"fliq-actions\\"><button class=\\"fliq-btn fliq-btn-primary\\" data-fliq=\\"save-settings\\">'
m=re.search(pat,s,flags=re.S)
if not m: raise SystemExit('Recovery section not found')
advanced='<details class=\\"fliq-section\\"><summary style=\\"font-weight:800;cursor:pointer\\">Advanced Tools</summary><div class=\\"fliq-muted\\" style=\\"margin-top:7px\\">Only use these for troubleshooting or recovery.</div>'+m.group(1)+'</details><div class=\\"fliq-actions\\"><button class=\\"fliq-btn fliq-btn-primary\\" data-fliq=\\"save-settings\\">'
s=s[:m.start()]+advanced+s[m.end():]
s=s.replace('Clear & Rebuild Cache only refreshes market/catalog data and does not touch inventory, claims, receipts, payments, or history. Reset Ledger Data clears ledger records but preserves Profile, API settings, and Whitelist. A local undo snapshot is created first.','Clear & Rebuild Cache refreshes item/market information only. Reset Ledger Data clears tracked item activity and reimbursements but keeps your profile, API settings, and whitelist. LedgerIQ saves a recovery copy first.',1)

p.write_text(s)
