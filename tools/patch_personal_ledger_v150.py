from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

def replace_between(src,start,end,new=''):
    a=src.index(start)
    b=src.index(end,a)
    return src[:a]+new+src[b:]

s=s.replace('// @version      1.5.0','// @version      1.5.1',1)
s=s.replace("const VERSION='1.5.0';","const VERSION='1.5.1';",1)

# Machine-to-machine receipt encoding is no longer needed in the personal build.
s=replace_between(s,'function b36(v){','function movementPayload(moves){','')

# Creating a Discord log should not change an unpaid reimbursement into a legacy SUBMITTED state.
s=s.replace("cs.forEach(c=>{if(c.status==='OPEN'){c.status='SUBMITTED';c.submittedAt=new Date().toISOString();}claims.push(c);});","cs.forEach(c=>claims.push(c));",1)

# Remove the old leadership/payment receipt engine. Discord Log History remains immediately before Inventory.
s=replace_between(s,'function paymentReceipt(p){','function inventoryRows(){','')

# Remove the old Leadership UI renderer.
s=replace_between(s,'function auditHtml(){','function settingsHtml(){','')

# Clean personal-use settings wording.
s=s.replace('Faction inventory ownership, reimbursement tracking, raffle intake, receipts, and leadership auditing.','Personal faction inventory ownership, reimbursement tracking, raffle intake, and Discord bookkeeping logs.',1)
s=s.replace('LedgerIQ uses Torn API endpoints for user logs, your Display Case contents when Display tracking is enabled, Torn item/market data, .','LedgerIQ uses Torn API endpoints for your user logs, your Display Case contents when Display tracking is enabled, and Torn item/market data.',1)
s=s.replace('Backups include your tracked items, item activity, reimbursements, receipts, raffle data, Discord log history, and settings.','Backups include your tracked items, item activity, reimbursements, Discord log history, raffle data, and settings.',1)
s=s.replace('Required custom selections are user → log, display; torn → items. LedgerIQ does not require a Full Access key.','Required custom selections are user → basic, log, display; torn → items. LedgerIQ does not require a Full Access key.',1)

# Generic modal copy language.
s=s.replace('>Copy Receipt</button>','>Copy</button>',1)
s=s.replace("toast('Receipt copied');","toast('Copied');",1)

# Remove dead action paths from the deleted admin engine.
needles=[
"if(a==='view-payment-receipt'){openPaymentBatch(String(t.dataset.id||''));return;}",
"if(a==='import-payment'){try{await importReceipt(String(document.getElementById('fliq-payment-import').value||''));}catch(e){toast('Import failed: '+String(e&&e.message||e));}return;}",
"if(a==='audit-import'){try{t.disabled=true;t.textContent='Checking…';await importReceipt(String(document.getElementById('fliq-audit-import').value||''));}catch(e){toast('Receipt check failed: '+String(e&&e.message||e));t.disabled=false;t.textContent='Check Receipt';}return;}",
"if(a==='audit-pay'){payAudit('verified');return;}",
"if(a==='audit-manual-pay'){payAudit('manual');return;}",
"if(a==='audit-clear'){currentAudit=null;render();return;}"
]
for x in needles:s=s.replace(x,'',1)

p.write_text(s)
print('patched personal ledger v1.5.1 cleanup')
