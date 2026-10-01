from pathlib import Path
p=Path('FactionLedgerIQ.user.js')
s=p.read_text()
s=s.replace('// @version      1.2.9','// @version      1.2.10',1)
s=s.replace("const VERSION='1.2.9';","const VERSION='1.2.10';",1)
old='''<div class="fliq-actions"><a class="fliq-btn fliq-btn-primary" href="https://www.torn.com/preferences.php#tab=api?step=addNewKey&amp;title=FactionLedgerIQ&amp;user=log,display&amp;torn=items&amp;faction=news">Create LedgerIQ API Key</a></div><div class="fliq-muted" style="margin-top:6px">Creates a Torn custom key with only: user → log, display · torn → items · faction → news. Copy the generated key and paste it above. Faction news may still require the appropriate faction permission on your Torn account.</div>'''
new='''<div class="fliq-actions"><button type="button" class="fliq-btn fliq-btn-primary" data-fliq="create-api-key">Create LedgerIQ API Key</button></div><div class="fliq-muted" style="margin-top:6px">Opens Torn's official custom-key creator in a new tab/window with only: user → basic, log, display · torn → items · faction → news. Copy the generated key and paste it above. Faction news may still require the appropriate faction permission on your Torn account.</div>'''
if old not in s: raise SystemExit('key button block not found')
s=s.replace(old,new,1)
needle="if(a==='tab'){activeTab=t.dataset.tab||'home';render();return;}"
insert="if(a==='tab'){activeTab=t.dataset.tab||'home';render();return;}if(a==='create-api-key'){const u='https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FactionLedgerIQ&user=basic,log,display&torn=items&faction=news';const w=window.open(u,'_blank','noopener,noreferrer');if(!w){window.location.href=u;}toast('Opening Torn custom key creator');return;}"
if needle not in s: raise SystemExit('action tab anchor not found')
s=s.replace(needle,insert,1)
p.write_text(s)
# trigger
