from pathlib import Path

p = Path('FactionLedgerIQ.user.js')
s = p.read_text()

s = s.replace('// @version      1.1.1', '// @version      1.2.0', 1)
s = s.replace("const VERSION='1.1.1';", "const VERSION='1.2.0';", 1)
s = s.replace("const STATE_KEY='factionledgeriq_v1_state';", "const STATE_KEY='factionledgeriq_v1_state';\nconst PRE_RESTORE_KEY='factionledgeriq_v1_pre_restore';", 1)

anchor = "function apiKey(){return String(state.settings.apiKey||'').trim();}"
helpers = r'''function hydrateState(x,keepApiKey=''){if(!x||typeof x!=='object')throw new Error('Backup state is missing');const y={...clone(DEFAULT),...x,settings:{...DEFAULT.settings,...(x.settings||{})},diagnostics:{...DEFAULT.diagnostics,...(x.diagnostics||{})},whitelist:Array.isArray(x.whitelist)?x.whitelist:[],market:x.market&&typeof x.market==='object'?x.market:{},lots:Array.isArray(x.lots)?x.lots:[],movements:Array.isArray(x.movements)?x.movements:[],claims:Array.isArray(x.claims)?x.claims:[],raffles:Array.isArray(x.raffles)?x.raffles:[],pendingTransfers:Array.isArray(x.pendingTransfers)?x.pendingTransfers:[],receiptBatches:Array.isArray(x.receiptBatches)?x.receiptBatches:[],auditClaims:Array.isArray(x.auditClaims)?x.auditClaims:[],paymentBatches:Array.isArray(x.paymentBatches)?x.paymentBatches:[],processedLogIds:Array.isArray(x.processedLogIds)?x.processedLogIds:[]};y.settings.apiKey=keepApiKey||'';return y;}
function backupEnvelope(){const copy=clone(state);if(copy.settings)copy.settings.apiKey='';return{kind:'FactionLedgerIQBackup',backupVersion:1,appVersion:VERSION,exportedAt:new Date().toISOString(),state:copy};}
function validateBackupEnvelope(b){if(!b||typeof b!=='object')throw new Error('Backup is not valid JSON');if(b.kind!=='FactionLedgerIQBackup')throw new Error('Not a FactionLedgerIQ backup');if(Number(b.backupVersion||0)!==1)throw new Error('Unsupported backup version');if(!b.state||typeof b.state!=='object')throw new Error('Backup state is missing');if(Number(b.state.schemaVersion||0)!==1)throw new Error('Unsupported LedgerIQ data schema');for(const k of ['whitelist','lots','movements','claims','raffles','pendingTransfers','receiptBatches','auditClaims','paymentBatches','processedLogIds'])if(!Array.isArray(b.state[k]))throw new Error('Backup is missing '+k);if(!b.state.settings||typeof b.state.settings!=='object')throw new Error('Backup settings are missing');return true;}
function backupText(){return JSON.stringify(backupEnvelope(),null,2);}
function exportBackup(){const text=backupText(),stamp=new Date().toISOString().replace(/[:.]/g,'-'),name='FactionLedgerIQ-backup-'+stamp+'.json';try{const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(e){console.warn('[FLIQ] backup download failed',e);}showReceipt('FactionLedgerIQ Backup — Save This',text);toast('Backup created — file download started if supported');}
async function restoreBackupFromUi(){const ta=document.getElementById('fliq-backup-import'),file=document.getElementById('fliq-backup-file')&&document.getElementById('fliq-backup-file').files&&document.getElementById('fliq-backup-file').files[0];let text=String(ta&&ta.value||'').trim();if(!text&&file)text=await file.text();if(!text)throw new Error('Choose a backup file or paste backup JSON');let b;try{b=JSON.parse(text);}catch(e){throw new Error('Backup JSON could not be read');}validateBackupEnvelope(b);const previous={kind:'FactionLedgerIQPreRestore',savedAt:new Date().toISOString(),state:clone(state)};localStorage.setItem(PRE_RESTORE_KEY,JSON.stringify(previous));const existingKey=apiKey();state=hydrateState(b.state,existingKey);state.updatedAt=new Date().toISOString();localStorage.setItem(STATE_KEY,JSON.stringify(state));currentAudit=null;restartPolling();render();toast('Backup restored');}
function undoLastRestore(){const raw=localStorage.getItem(PRE_RESTORE_KEY);if(!raw)throw new Error('No pre-restore snapshot is available');let b;try{b=JSON.parse(raw);}catch(e){throw new Error('Recovery snapshot is unreadable');}if(!b||b.kind!=='FactionLedgerIQPreRestore'||!b.state)throw new Error('Recovery snapshot is invalid');const existingKey=apiKey();state=hydrateState(b.state,existingKey);state.updatedAt=new Date().toISOString();localStorage.setItem(STATE_KEY,JSON.stringify(state));localStorage.removeItem(PRE_RESTORE_KEY);currentAudit=null;restartPolling();render();toast('Last restore undone');}

'''
if anchor not in s:
    raise SystemExit('apiKey anchor not found')
s = s.replace(anchor, helpers + anchor, 1)

settings_marker = '<div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" data-fliq="save-settings">Save Settings</button><button class="fliq-btn" data-fliq="load-items">Load / Refresh Items</button></div>'
backup_ui = '''<div class="fliq-section"><div class="fliq-section-title"><span>Backup & Recovery</span></div><div class="fliq-muted">Backups include LedgerIQ inventory, movements, claims, receipts, raffle data, audit history, and settings. Your Torn API key is intentionally excluded.</div><div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" data-fliq="export-backup">Export Backup</button><button class="fliq-btn" data-fliq="undo-restore">Undo Last Restore</button></div><input id="fliq-backup-file" class="fliq-input" type="file" accept=".json,application/json"><textarea id="fliq-backup-import" class="fliq-textarea" placeholder="Or paste FactionLedgerIQ backup JSON here"></textarea><div class="fliq-actions"><button class="fliq-btn" data-fliq="restore-backup">Restore Backup</button></div></div>'''
if settings_marker not in s:
    raise SystemExit('settings marker not found')
s = s.replace(settings_marker, backup_ui + settings_marker, 1)

action_anchor = "if(a==='sync'){t.disabled=true;await poll(true);return;}"
action_code = "if(a==='export-backup'){exportBackup();return;}if(a==='restore-backup'){try{t.disabled=true;await restoreBackupFromUi();}catch(e){toast('Restore failed: '+String(e&&e.message||e));t.disabled=false;}return;}if(a==='undo-restore'){try{undoLastRestore();}catch(e){toast(String(e&&e.message||e));}return;}"
if action_anchor not in s:
    raise SystemExit('action anchor not found')
s = s.replace(action_anchor, action_code + action_anchor, 1)

p.write_text(s)
