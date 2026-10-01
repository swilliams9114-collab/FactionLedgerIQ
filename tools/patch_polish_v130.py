from pathlib import Path
p=Path('FactionLedgerIQ.user.js')
s=p.read_text()
s=s.replace('// @version      1.3.1','// @version      1.3.2',1)
s=s.replace("const VERSION='1.3.1';","const VERSION='1.3.2';",1)

bad="<span class=\"fliq-pill ${pill}\">${r.status==='NEW'?'READY TO PAY':r.status==='ALREADY_PAID'?'ALREADY PAID':'NEEDS REVIEW'}</span>"
good="<span class=\"fliq-pill ${pill}\">${esc(r.status)}</span>"
if bad not in s: raise SystemExit('diagnostics status anchor missing')
s=s.replace(bad,good,1)

p.write_text(s)
