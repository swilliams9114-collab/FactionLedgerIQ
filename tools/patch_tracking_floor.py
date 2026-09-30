from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()
s=s.replace('// @version      1.0.3','// @version      1.0.4')
s=s.replace("const VERSION='1.0.3';","const VERSION='1.0.4';")

needle="const P='PERSONAL', F='FACTION', INV='PERSONAL_INVENTORY', DISP='DISPLAY_CASE';"
insert=needle+"\nconst V1_TRACKING_FLOOR_MS=Date.parse('2026-09-30T18:37:00Z');"
if needle not in s:
    raise SystemExit('constants pattern not found')
s=s.replace(needle,insert,1)

old="function trackingStartMs(){const ms=new Date(state.createdAt||0).getTime();return Number.isFinite(ms)&&ms>0?ms:0;}"
new="function trackingStartMs(){const created=new Date(state.createdAt||0).getTime(),safeCreated=Number.isFinite(created)&&created>0?created:0;return Math.max(V1_TRACKING_FLOOR_MS||0,safeCreated);}"
if old not in s:
    raise SystemExit('trackingStartMs pattern not found')
s=s.replace(old,new,1)

start=s.find('function purgePreTrackingEvents(){')
end=s.find('function parseItem(v){',start)
if start<0 or end<0:
    raise SystemExit('purge function boundaries not found')
new_purge="""function purgePreTrackingEvents(){const start=trackingStartMs();if(!start)return false;let changed=false;const doomed=new Set();(state.movements||[]).forEach(m=>{if(!m||m.status==='VOID'||!['ARMORY_IN','ARMORY_OUT'].includes(m.type)||m.receiptBatchId)return;const ts=new Date(m.timestamp||0).getTime();if(!(Number.isFinite(ts)&&ts<start))return;const claims=(m.claimIds||[]).map(claimById).filter(Boolean),protectedClaim=claims.some(c=>c.status==='SUBMITTED'||c.status==='REIMBURSED');if(protectedClaim)return;m.status='VOID';m.voidedAt=new Date().toISOString();m.voidReason='Movement occurred before LedgerIQ V1 tracking began';doomed.add(m.id);claims.forEach(c=>{if(c.status==='OPEN'){c.status='VOID';c.voidedAt=new Date().toISOString();c.voidReason='Parent movement occurred before LedgerIQ V1 tracking began';}});changed=true;});(state.lots||[]).forEach(l=>{if(!l||l.status==='VOID')return;const ts=new Date(l.createdAt||0).getTime(),pre=Number.isFinite(ts)&&ts<start,linked=doomed.has(l.sourceRef);if(l.sourceType==='ARMORY_WITHDRAWAL'&&(pre||linked)){l.status='VOID';l.qtyRemaining=0;l.voidedAt=new Date().toISOString();l.voidReason='Armory withdrawal occurred before LedgerIQ V1 tracking began';changed=true;}});(state.pendingTransfers||[]).forEach(t=>{if(!t||t.status!=='PENDING')return;const ts=new Date(t.timestamp||0).getTime();if(Number.isFinite(ts)&&ts<start){t.status='VOID';t.voidedAt=new Date().toISOString();changed=true;}});return changed;}\n"""
s=s[:start]+new_purge+s[end:]

p.write_text(s)
