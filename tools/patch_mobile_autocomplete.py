from pathlib import Path
import re

p=Path('FactionLedgerIQ.user.js')
s=p.read_text()
s=s.replace('// @version      1.0.8','// @version      1.0.9',1)
s=s.replace("const VERSION='1.0.8';","const VERSION='1.0.9';",1)

old="function itemOptions(){return itemCatalog.slice(0,2500).map(i=>`<option value=\"${esc(i.name)} [${esc(i.id)}]\"></option>`).join('');}"
new="""function itemMatches(q){const n=norm(q);if(!n)return[];return itemCatalog.map(i=>({i,n:norm(i.name)})).filter(x=>x.n.includes(n)||String(x.i.id)===String(q).trim()).sort((a,b)=>{const ap=a.n.startsWith(n)?0:1,bp=b.n.startsWith(n)?0:1;return ap-bp||a.i.name.localeCompare(b.i.name);}).slice(0,8).map(x=>x.i);}
function itemSearchField(id,placeholder){return `<div class=\"fliq-item-search-wrap\"><input id=\"${esc(id)}\" class=\"fliq-input fliq-item-search\" autocomplete=\"off\" autocorrect=\"off\" spellcheck=\"false\" placeholder=\"${esc(placeholder)}\"><div class=\"fliq-autocomplete\" data-for=\"${esc(id)}\"></div></div>`;}
function updateAutocomplete(input){if(!input||!input.classList.contains('fliq-item-search'))return;const box=input.parentElement&&input.parentElement.querySelector('.fliq-autocomplete');if(!box)return;const q=String(input.value||'').trim();if(q.length<2){box.innerHTML='';return;}const matches=itemMatches(q);box.innerHTML=matches.map(i=>`<button type=\"button\" class=\"fliq-autocomplete-item\" data-fliq=\"pick-item\" data-target=\"${esc(input.id)}\" data-value=\"${esc(i.name)} [${esc(i.id)}]\"><span>${esc(i.name)}</span><small>ID ${esc(i.id)}</small></button>`).join('');}
function closeAutocompletes(except){document.querySelectorAll(`#${PANEL_ID} .fliq-autocomplete`).forEach(b=>{if(!except||b!==except)b.innerHTML='';});}"""
if old not in s: raise SystemExit('itemOptions target not found')
s=s.replace(old,new,1)

s=s.replace('<input id="fliq-open-item" class="fliq-input fliq-grow" list="fliq-items" placeholder="Item name or ID"><datalist id="fliq-items">${itemOptions()}</datalist>', '${itemSearchField(\'fliq-open-item\',\'Item name or ID\')}',1)
s=s.replace('<input id="fliq-display-item" class="fliq-input fliq-grow" list="fliq-items" placeholder="Item">', '${itemSearchField(\'fliq-display-item\',\'Item\')}',1)
s=s.replace('<input id="fliq-whitelist-item" class="fliq-input fliq-grow" list="fliq-items-settings" placeholder="Item name or ID"><datalist id="fliq-items-settings">${itemOptions()}</datalist>', '${itemSearchField(\'fliq-whitelist-item\',\'Item name or ID\')}',1)

style_anchor='.fliq-grow{flex:1 1 140px}'
style_add='.fliq-grow{flex:1 1 140px}.fliq-item-search-wrap{position:relative;flex:1 1 140px;min-width:0}.fliq-autocomplete{position:absolute;z-index:80;left:0;right:0;top:calc(100% + 3px);max-height:220px;overflow-y:auto;border:1px solid #555;border-radius:7px;background:#222;box-shadow:0 8px 22px rgba(0,0,0,.45)}.fliq-autocomplete:empty{display:none}.fliq-autocomplete-item{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;border:0;border-bottom:1px solid #444;background:#2b2b2b;color:#eee;padding:9px 10px;text-align:left;font:inherit}.fliq-autocomplete-item:last-child{border-bottom:0}.fliq-autocomplete-item small{color:#aaa;white-space:nowrap}.fliq-autocomplete-item:active{background:#3a3a3a}'
if style_anchor not in s: raise SystemExit('style anchor not found')
s=s.replace(style_anchor,style_add,1)

pick_anchor="if(a==='close'){panelOpen=false;ensurePanel().classList.add('hidden');return;}"
pick_new="if(a==='close'){panelOpen=false;ensurePanel().classList.add('hidden');return;}if(a==='pick-item'){const input=document.getElementById(String(t.dataset.target||''));if(input){input.value=String(t.dataset.value||'');const box=input.parentElement&&input.parentElement.querySelector('.fliq-autocomplete');if(box)box.innerHTML='';input.focus();}return;}"
if pick_anchor not in s: raise SystemExit('action anchor not found')
s=s.replace(pick_anchor,pick_new,1)

events_old="function installEvents(){document.addEventListener('click',e=>{const t=e.target.closest('[data-fliq]');if(t)action(t);});document.addEventListener('change',e=>{if(e.target&&e.target.id==='fliq-raffle-all')document.querySelectorAll('.fliq-raffle-check').forEach(x=>x.checked=e.target.checked);});}"
events_new="function installEvents(){document.addEventListener('click',e=>{const t=e.target.closest('[data-fliq]');if(t){action(t);return;}if(!e.target.closest('.fliq-item-search-wrap'))closeAutocompletes();});document.addEventListener('input',e=>{if(e.target&&e.target.classList&&e.target.classList.contains('fliq-item-search'))updateAutocomplete(e.target);});document.addEventListener('focusin',e=>{if(e.target&&e.target.classList&&e.target.classList.contains('fliq-item-search'))updateAutocomplete(e.target);});document.addEventListener('change',e=>{if(e.target&&e.target.id==='fliq-raffle-all')document.querySelectorAll('.fliq-raffle-check').forEach(x=>x.checked=e.target.checked);});}"
if events_old not in s: raise SystemExit('events target not found')
s=s.replace(events_old,events_new,1)

p.write_text(s)
