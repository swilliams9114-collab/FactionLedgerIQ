from pathlib import Path

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()

s=s.replace('// @version      1.1.0','// @version      1.1.1',1)
s=s.replace("const VERSION='1.1.0';","const VERSION='1.1.1';",1)

s=s.replace('<div class="fliq-card"><h3>Personal Stock</h3><div class="fliq-big">','<div class="fliq-card"><div class="fliq-card-label">Personal Stock</div><div class="fliq-big">',1)
s=s.replace('<div class="fliq-card"><h3>Faction Held</h3><div class="fliq-big">','<div class="fliq-card"><div class="fliq-card-label">Faction Held</div><div class="fliq-big">',1)
s=s.replace('<div class="fliq-card"><h3>Faction Owes You</h3><div class="fliq-big">','<div class="fliq-card"><div class="fliq-card-label">Faction Owes You</div><div class="fliq-big">',1)

s=s.replace("max-height:calc(100vh - 60px);max-height:calc(100dvh - 60px);overflow:hidden;", "bottom:6px;height:auto;max-height:none;overflow:hidden;display:flex;flex-direction:column;",1)
s=s.replace('.fliq-head{display:flex;', '.fliq-head{flex:0 0 auto;display:flex;',1)
s=s.replace('.fliq-tabs{display:grid;', '.fliq-tabs{flex:0 0 auto;display:grid;',1)
s=s.replace('.fliq-body{padding:9px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;max-height:calc(100vh - 150px);max-height:calc(100dvh - 150px)}', '.fliq-body{flex:1 1 auto;min-height:0;padding:9px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;max-height:none;padding-bottom:24px}',1)
s=s.replace('.fliq-card h3{font-size:10px;line-height:1.15;text-transform:uppercase;color:#777;margin:0 0 4px;overflow-wrap:anywhere}', '.fliq-card-label{font-size:9px;line-height:1.15;font-weight:800;text-transform:uppercase;letter-spacing:.2px;color:#777;margin:0 0 6px;overflow-wrap:normal;word-break:normal}',1)
s=s.replace("max-height:calc(100dvh - 54px);border-radius:10px}", "bottom:5px;height:auto;max-height:none;border-radius:10px}",1)
s=s.replace('.fliq-body{padding:7px;max-height:calc(100dvh - 137px)}', '.fliq-body{padding:7px 7px 24px;max-height:none}',1)
s=s.replace('.fliq-card h3{font-size:8px}', '.fliq-card-label{font-size:8px}',1)

p.write_text(s)
