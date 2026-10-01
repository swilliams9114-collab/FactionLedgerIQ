from pathlib import Path
p=Path('FactionLedgerIQ.user.js')
s=p.read_text()
s=s.replace('// @version      1.3.0','// @version      1.3.1',1)
s=s.replace("const VERSION='1.3.0';","const VERSION='1.3.1';",1)

old="<span class=\"fliq-pill ${r.status==='NEW'?'green':r.status==='ALREADY_PAID'?'red':'gold'}\">${esc(r.status)}</span>"
new="<span class=\"fliq-pill ${r.status==='NEW'?'green':r.status==='ALREADY_PAID'?'red':'gold'}\">${r.status==='NEW'?'READY TO PAY':r.status==='ALREADY_PAID'?'ALREADY PAID':'NEEDS REVIEW'}</span>"
if old not in s: raise SystemExit('leadership status badge anchor missing')
s=s.replace(old,new,1)

s=s.replace("${esc(r.claim.id)} · ${esc(r.verification)}","Reimbursement ID: ${esc(r.claim.id)} · ${esc(r.verification==='INDEPENDENT_API'?'Leadership confirmed':r.verification==='MEMBER_VERIFIED'?'Member confirmed':r.verification==='MANUAL_LEADERSHIP'?'Manual check':r.verification)}",1)
s=s.replace("'No reimbursement claim'","'No money owed'",1)
s=s.replace("No reimbursement claim","No money owed")
s=s.replace("API verified","Leadership confirmed")
s=s.replace("Manual approval","Manual check")

p.write_text(s)
