from pathlib import Path
p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.2.8','// @version      1.2.9',1)
s=s.replace("const VERSION='1.2.8';","const VERSION='1.2.9';",1)

old='''<div class="fliq-section"><div class="fliq-section-title"><span>Torn API</span></div><input id="fliq-set-api" class="fliq-input" type="password" value="${esc(state.settings.apiKey)}" placeholder="Torn API key"><div class="fliq-list-item" style="margin-top:8px"><b>API & Data Handling</b>'''
new='''<div class="fliq-section"><div class="fliq-section-title"><span>Torn API</span></div><input id="fliq-set-api" class="fliq-input" type="password" value="${esc(state.settings.apiKey)}" placeholder="Torn API key"><div class="fliq-actions"><a class="fliq-btn fliq-btn-primary" href="https://www.torn.com/preferences.php#tab=api?step=addNewKey&amp;title=FactionLedgerIQ&amp;user=log,display&amp;torn=items&amp;faction=news">Create LedgerIQ API Key</a></div><div class="fliq-muted" style="margin-top:6px">Creates a Torn custom key with only: user → log, display · torn → items · faction → news. Copy the generated key and paste it above. Faction news may still require the appropriate faction permission on your Torn account.</div><div class="fliq-list-item" style="margin-top:8px"><b>API & Data Handling</b>'''
if old not in s:
    raise SystemExit('Torn API settings anchor not found')
s=s.replace(old,new,1)

old='''<div class="fliq-muted" style="margin-top:4px"><b>Access:</b> Use the lowest-access Torn API key that provides the selections LedgerIQ needs. LedgerIQ does not require a Full Access key.</div>'''
new='''<div class="fliq-muted" style="margin-top:4px"><b>Access:</b> Required custom selections are user → log, display; torn → items; faction → news. LedgerIQ does not require a Full Access key.</div>'''
if old not in s:
    raise SystemExit('API access disclosure line not found')
s=s.replace(old,new,1)

p.write_text(s)
