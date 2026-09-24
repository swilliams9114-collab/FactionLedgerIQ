// ==UserScript==
// @name         FactionLedgerIQ
// @namespace    FactionLedgerIQ
// @version      0.3.0
// @description  TornPDA-first faction purchase, asset, reimbursement, and receipt ledger.
// @match        *://www.torn.com/*
// @match        *://torn.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.3.0';
    const STATE_KEY = 'factionledgeriq_state_v1';
    const DOCK_ID = 'factionledgeriq-dock-btn';
    const PANEL_ID = 'factionledgeriq-panel';
    const STYLE_ID = 'factionledgeriq-style';

    const EVENT_TYPES = [
        ['PURCHASE', 'Personal Purchase'],
        ['ARMORY_IN', 'Deposit to Faction Armory'],
        ['ARMORY_OUT', 'Withdraw from Faction Armory'],
        ['DISPLAY_IN', 'Add to Display Case'],
        ['DISPLAY_OUT', 'Remove from Display Case'],
        ['SALE', 'Faction Item Sale'],
        ['FACTION_BALANCE_IN', 'Deposit Sale Proceeds to Faction Balance'],
        ['REFUND', 'Faction Reimbursement / Refund'],
        ['FACTION_COLLECTION', 'Faction Collects Sale Proceeds']
    ];

    const DEFAULT_STATE = {
        schemaVersion: 1,
        settings: { playerName: '', playerId: '', factionName: '', autoDetectPurchases: true, apiKey: '', apiPolling: true, apiPollSeconds: 5 },
        detection: { processedFingerprints: [], processedLogIds: [], lastDetectedAt: '', lastSource: '', lastApiPollAt: '', lastApiError: '', apiStatus: 'Not configured' },
        whitelist: [],
        transactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    let state = loadState();
    let activeTab = 'dashboard';
    let dockObserver = null;
    let dockQueued = false;
    let purchaseObserver = null;
    let purchaseScanQueued = false;
    let apiPollTimer = null;
    let apiPollBusy = false;
    const recentClickCaptures = [];

    function clone(v) { return JSON.parse(JSON.stringify(v)); }

    function loadState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            if (!raw) return clone(DEFAULT_STATE);
            const parsed = JSON.parse(raw);
            return {
                ...clone(DEFAULT_STATE),
                ...parsed,
                settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
                detection: { ...DEFAULT_STATE.detection, ...(parsed.detection || {}) },
                whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist : [],
                transactions: Array.isArray(parsed.transactions) ? parsed.transactions : []
            };
        } catch (e) {
            console.warn('[FactionLedgerIQ] State load failed', e);
            return clone(DEFAULT_STATE);
        }
    }

    function saveState() {
        state.updatedAt = new Date().toISOString();
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
        render();
    }

    function uid(prefix) {
        return (prefix || 'FLIQ') + '-' +
            Date.now().toString(36).toUpperCase() + '-' +
            Math.random().toString(36).slice(2, 8).toUpperCase();
    }

    function esc(v) {
        return String(v == null ? '' : v)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function money(v) {
        return '$' + Math.round(Number(v || 0)).toLocaleString();
    }

    function liveTransactions() {
        return state.transactions.filter(function (tx) { return tx.status !== 'VOID'; });
    }

    function childrenOf(parentId, type) {
        return liveTransactions().filter(function (tx) {
            return tx.parentId === parentId && (!type || tx.type === type);
        });
    }

    function billable(actualTotal, mvTotal) {
        return Math.max(Number(actualTotal || 0), Number(mvTotal || 0));
    }

    function normalizeItemName(v) {
        return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function whitelistMatch(itemName, itemId) {
        const wantedName = normalizeItemName(itemName);
        const wantedId = String(itemId || '').trim();
        return state.whitelist.find(function (w) {
            const idMatch = wantedId && String(w.itemId || '').trim() === wantedId;
            const nameMatch = wantedName && normalizeItemName(w.itemName) === wantedName;
            return idMatch || nameMatch;
        }) || null;
    }

    function rememberFingerprint(fp) {
        if (!fp) return;
        state.detection.processedFingerprints = Array.isArray(state.detection.processedFingerprints)
            ? state.detection.processedFingerprints : [];
        if (!state.detection.processedFingerprints.includes(fp)) {
            state.detection.processedFingerprints.push(fp);
            if (state.detection.processedFingerprints.length > 300) {
                state.detection.processedFingerprints =
                    state.detection.processedFingerprints.slice(-300);
            }
        }
    }

    function alreadyProcessed(fp) {
        return Array.isArray(state.detection.processedFingerprints) &&
            state.detection.processedFingerprints.includes(fp);
    }

    function detectSource() {
        const href = location.href.toLowerCase();
        if (href.includes('item.php') || href.includes('itemmarket') || href.includes('market')) return 'Item Market';
        if (href.includes('bazaar')) return 'Bazaar';
        if (href.includes('shops.php') || href.includes('bigalgunshop')) return 'City Shop';
        if (href.includes('trade.php')) return 'Trade';
        return 'Torn';
    }

    function parseMoney(text) {
        const matches = String(text || '').match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/g);
        if (!matches || !matches.length) return 0;
        const last = matches[matches.length - 1];
        return Number(last.replace(/[^0-9]/g, '')) || 0;
    }

    function parsePurchaseConfirmation(text) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean || !/\b(?:you\s+(?:bought|purchased)|purchase(?:d)?|bought)\b/i.test(clean)) return null;

        const patterns = [
            /you\s+(?:bought|purchased)\s+(\d[\d,]*)\s*[x×]?\s*(.+?)\s+(?:for|at a cost of|costing)\s+\$\s*([\d,]+)/i,
            /you\s+(?:bought|purchased)\s+(.+?)\s*[x×]\s*(\d[\d,]*)\s+(?:for|at a cost of|costing)\s+\$\s*([\d,]+)/i,
            /you\s+(?:bought|purchased)\s+(?:a|an|the)?\s*(.+?)\s+(?:for|at a cost of|costing)\s+\$\s*([\d,]+)/i
        ];

        for (const re of patterns) {
            const m = clean.match(re);
            if (!m) continue;
            let qty = 1, itemName = '', total = 0;
            if (re === patterns[0]) {
                qty = Number(m[1].replace(/,/g, '')) || 1;
                itemName = m[2];
                total = Number(m[3].replace(/,/g, '')) || 0;
            } else if (re === patterns[1]) {
                itemName = m[1];
                qty = Number(m[2].replace(/,/g, '')) || 1;
                total = Number(m[3].replace(/,/g, '')) || 0;
            } else {
                itemName = m[1];
                total = Number(m[2].replace(/,/g, '')) || parseMoney(clean);
            }
            itemName = itemName.replace(/[.!]+$/, '').trim();
            if (itemName && total > 0) return { itemName, qty, actualTotal: total, rawText: clean };
        }
        return null;
    }

    function capturePotentialPurchaseClick(e) {
        const target = e.target.closest('button,a,[role="button"],input[type="button"],input[type="submit"]');
        if (!target) return;
        const label = String(target.innerText || target.value || target.getAttribute('aria-label') || '').trim();
        if (!/\b(?:buy|purchase)\b/i.test(label)) return;

        const container = target.closest('li,tr,[class*="item"],[class*="listing"],[class*="row"],form') || target.parentElement;
        const text = container ? String(container.innerText || '') : '';
        const price = parseMoney(text);
        const candidates = container ? Array.from(container.querySelectorAll('[data-item],[data-item-id],[class*="name"],h4,h5,b,strong')) : [];
        const nameNode = candidates.find(function (n) {
            const t = String(n.innerText || n.getAttribute('data-item') || '').trim();
            return t && !/^\$/.test(t) && !/\b(?:buy|purchase)\b/i.test(t);
        });
        const itemName = nameNode ? String(nameNode.innerText || nameNode.getAttribute('data-item') || '').trim() : '';
        const itemId = container
            ? String(container.getAttribute('data-item-id') || target.getAttribute('data-item-id') || '').trim()
            : '';

        recentClickCaptures.push({
            at: Date.now(),
            source: detectSource(),
            itemName,
            itemId,
            price,
            text: text.slice(0, 1200)
        });
        while (recentClickCaptures.length > 12) recentClickCaptures.shift();
    }

    function bestRecentCapture(parsed) {
        const now = Date.now();
        return recentClickCaptures.slice().reverse().find(function (c) {
            if (now - c.at > 15000) return false;
            if (!c.itemName || !parsed.itemName) return true;
            return normalizeItemName(c.itemName).includes(normalizeItemName(parsed.itemName)) ||
                normalizeItemName(parsed.itemName).includes(normalizeItemName(c.itemName));
        }) || null;
    }

    function recordDetectedPurchase(parsed, node) {
        const capture = bestRecentCapture(parsed);
        const source = capture && capture.source ? capture.source : detectSource();
        const itemName = parsed.itemName || (capture && capture.itemName) || '';
        const itemId = capture && capture.itemId ? capture.itemId : '';
        const whitelist = whitelistMatch(itemName, itemId);
        if (!whitelist) return false;

        const actualTotal = Number(parsed.actualTotal || (capture && capture.price) || 0);
        const fp = [
            'DOMPURCHASE',
            source,
            normalizeItemName(itemName),
            Number(parsed.qty || 1),
            actualTotal,
            Math.floor(Date.now() / 10000)
        ].join('|');

        if (alreadyProcessed(fp)) return false;

        state.transactions.push({
            id: uid('TX'),
            chainId: uid('CHAIN'),
            parentId: null,
            type: 'PURCHASE',
            timestamp: new Date().toISOString(),
            itemName: whitelist.itemName || itemName,
            itemId: whitelist.itemId || itemId,
            qty: Math.max(1, Number(parsed.qty || 1)),
            actualTotal,
            mvTotal: 0,
            billableTotal: actualTotal,
            amount: actualTotal,
            source,
            destination: 'Personal Inventory',
            personName: state.settings.playerName,
            personId: state.settings.playerId,
            notes: 'Auto-detected purchase. MV at purchase is pending capture/reconciliation.',
            ownership: 'PERSONAL',
            status: 'PENDING',
            detectionMethod: 'DOM_CONFIRMATION',
            rawConfirmation: String(parsed.rawText || '').slice(0, 1000),
            createdAt: new Date().toISOString()
        });

        rememberFingerprint(fp);
        state.detection.lastDetectedAt = new Date().toISOString();
        state.detection.lastSource = source;
        saveState();
        toast('Whitelisted purchase detected: ' + (whitelist.itemName || itemName));
        if (node && node.setAttribute) node.setAttribute('data-fliq-detected', '1');
        return true;
    }

    function scanForPurchaseConfirmations(root) {
        if (!state.settings.autoDetectPurchases) return;
        const scope = root && root.querySelectorAll ? root : document;
        const nodes = [scope].concat(Array.from(scope.querySelectorAll
            ? scope.querySelectorAll('[role="alert"],[class*="success"],[class*="confirm"],[class*="message"],[class*="notification"],[class*="toast"]')
            : []));
        nodes.forEach(function (node) {
            if (!node || !node.innerText || (node.getAttribute && node.getAttribute('data-fliq-detected') === '1')) return;
            const text = String(node.innerText || '');
            if (text.length > 1500) return;
            const parsed = parsePurchaseConfirmation(text);
            if (parsed) recordDetectedPurchase(parsed, node);
        });
    }

    function startPurchaseDetection() {
        document.addEventListener('click', capturePotentialPurchaseClick, true);
        scanForPurchaseConfirmations(document);
        if (purchaseObserver) return;
        purchaseObserver = new MutationObserver(function (mutations) {
            if (purchaseScanQueued) return;
            const hasAdded = mutations.some(function (m) { return m.addedNodes && m.addedNodes.length; });
            if (!hasAdded) return;
            purchaseScanQueued = true;
            requestAnimationFrame(function () {
                purchaseScanQueued = false;
                scanForPurchaseConfirmations(document);
            });
        });
        purchaseObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    function apiKeyValue() {
        return String(state.settings.apiKey || '').trim();
    }

    function apiUrl(path, params) {
        const q = new URLSearchParams(params || {});
        q.set('key', apiKeyValue());
        q.set('comment', 'FactionLedgerIQ');
        return 'https://api.torn.com/v2/' + path.replace(/^\/+/, '') + '?' + q.toString();
    }

    async function apiFetch(path, params) {
        if (!apiKeyValue()) throw new Error('API key not configured');
        const response = await fetch(apiUrl(path, params), { credentials: 'omit', cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || (data && data.error)) {
            const err = data && data.error;
            throw new Error(err ? (err.error || err.message || JSON.stringify(err)) : ('HTTP ' + response.status));
        }
        return data;
    }

    function logArray(data) {
        if (!data) return [];
        if (Array.isArray(data.log)) return data.log;
        if (Array.isArray(data.logs)) return data.logs;
        if (Array.isArray(data)) return data;
        return [];
    }

    function logId(log) {
        return String(log && (log.id || log.log_id || log.logId || log.ID) || '');
    }

    function logText(log) {
        return [
            log && log.title,
            log && log.text,
            log && log.log,
            log && log.category,
            log && log.type,
            log && log.data && JSON.stringify(log.data)
        ].filter(Boolean).join(' ');
    }

    function markLogProcessed(id) {
        if (!id) return;
        state.detection.processedLogIds = Array.isArray(state.detection.processedLogIds)
            ? state.detection.processedLogIds : [];
        if (!state.detection.processedLogIds.includes(id)) {
            state.detection.processedLogIds.push(id);
            if (state.detection.processedLogIds.length > 1000) {
                state.detection.processedLogIds = state.detection.processedLogIds.slice(-1000);
            }
        }
    }

    function isLogProcessed(id) {
        return !!id && Array.isArray(state.detection.processedLogIds) &&
            state.detection.processedLogIds.includes(id);
    }

    function reconcileApiPurchase(log) {
        const id = logId(log);
        if (!id || isLogProcessed(id)) return false;

        const text = logText(log);
        if (!/\b(?:bought|purchase|purchased|item market|bazaar|city shop|shop)\b/i.test(text)) return false;

        const data = log.data || {};
        const itemName = String(
            data.item_name || data.itemName || data.name ||
            (data.item && (data.item.name || data.item.item_name)) || ''
        ).trim();
        const itemId = String(
            data.item_id || data.itemId ||
            (data.item && (data.item.id || data.item.item_id)) || ''
        ).trim();

        const capture = recentClickCaptures.slice().reverse().find(function (c) {
            return Date.now() - c.at < 120000 &&
                (!itemName || !c.itemName ||
                    normalizeItemName(c.itemName).includes(normalizeItemName(itemName)) ||
                    normalizeItemName(itemName).includes(normalizeItemName(c.itemName)));
        }) || null;

        const wl = whitelistMatch(itemName || (capture && capture.itemName), itemId || (capture && capture.itemId));
        if (!wl) {
            markLogProcessed(id);
            return false;
        }

        const qty = Math.max(1, Number(
            data.quantity || data.qty || data.amount ||
            (data.item && (data.item.quantity || data.item.qty)) || 1
        ));
        let actualTotal = Number(
            data.total_cost || data.total || data.cost || data.price || data.money || 0
        ) || 0;
        if (!actualTotal && capture) actualTotal = Number(capture.price || 0);

        const existing = liveTransactions().find(function (tx) {
            return tx.type === 'PURCHASE' &&
                normalizeItemName(tx.itemName) === normalizeItemName(wl.itemName) &&
                Math.abs(new Date(tx.timestamp).getTime() - Date.now()) < 180000 &&
                tx.detectionMethod === 'DOM_CONFIRMATION';
        });

        if (existing) {
            existing.apiLogId = id;
            existing.detectionMethod = 'API_CONFIRMED';
            existing.notes = 'API-confirmed purchase; DOM context reconciled.';
            if (!existing.actualTotal && actualTotal) {
                existing.actualTotal = actualTotal;
                existing.amount = actualTotal;
                existing.billableTotal = Math.max(actualTotal, Number(existing.mvTotal || 0));
            }
        } else {
            state.transactions.push({
                id: uid('TX'),
                chainId: uid('CHAIN'),
                parentId: null,
                type: 'PURCHASE',
                timestamp: log.timestamp ? new Date(Number(log.timestamp) * 1000).toISOString() : new Date().toISOString(),
                itemName: wl.itemName || itemName,
                itemId: wl.itemId || itemId,
                qty,
                actualTotal,
                mvTotal: 0,
                billableTotal: actualTotal,
                amount: actualTotal,
                source: (capture && capture.source) || 'Torn API Log',
                destination: 'Personal Inventory',
                personName: state.settings.playerName,
                personId: state.settings.playerId,
                notes: 'API-confirmed purchase. Purchase-time MV pending reconciliation.',
                ownership: 'PERSONAL',
                status: 'PENDING',
                detectionMethod: 'API_CONFIRMED',
                apiLogId: id,
                createdAt: new Date().toISOString()
            });
        }

        markLogProcessed(id);
        state.detection.lastDetectedAt = new Date().toISOString();
        state.detection.lastSource = 'Torn API';
        return true;
    }

    async function pollApiLogs(showToast) {
        if (apiPollBusy || !state.settings.apiPolling || !apiKeyValue()) return;
        apiPollBusy = true;
        try {
            const now = Math.floor(Date.now() / 1000);
            const from = now - 900;
            const data = await apiFetch('user/log', { from: String(from), to: String(now), limit: '100' });
            const logs = logArray(data);
            let changed = false;
            logs.forEach(function (log) {
                if (reconcileApiPurchase(log)) changed = true;
            });
            state.detection.lastApiPollAt = new Date().toISOString();
            state.detection.lastApiError = '';
            state.detection.apiStatus = 'Connected';
            if (changed) {
                saveState();
                toast('API-confirmed purchase detected');
            } else {
                localStorage.setItem(STATE_KEY, JSON.stringify(state));
                if (showToast) toast('API connected · ' + logs.length + ' recent log(s)');
            }
        } catch (err) {
            state.detection.lastApiPollAt = new Date().toISOString();
            state.detection.lastApiError = String(err && err.message || err);
            state.detection.apiStatus = 'Error';
            localStorage.setItem(STATE_KEY, JSON.stringify(state));
            if (showToast) toast('API test failed');
        } finally {
            apiPollBusy = false;
            render();
        }
    }

    function restartApiPolling() {
        if (apiPollTimer) clearInterval(apiPollTimer);
        apiPollTimer = null;
        if (!state.settings.apiPolling || !apiKeyValue()) return;
        const seconds = Math.max(5, Number(state.settings.apiPollSeconds || 5));
        apiPollTimer = setInterval(function () { pollApiLogs(false); }, seconds * 1000);
        setTimeout(function () { pollApiLogs(false); }, 1000);
    }

    function actor(tx) {
        const name = tx.personName || state.settings.playerName || 'Unknown';
        const id = tx.personId || state.settings.playerId || '';
        return id ? name + ' [' + id + ']' : name;
    }

    function balances() {
        let factionOwesMe = 0;
        let iOweFaction = 0;
        let readyToCollect = 0;
        let assetsHeld = 0;
        let pending = 0;

        liveTransactions().forEach(function (tx) {
            if (tx.type === 'PURCHASE') {
                const deposited = tx.status === 'DEPOSITED' ||
                    childrenOf(tx.id, 'ARMORY_IN').length ||
                    childrenOf(tx.id, 'DISPLAY_IN').length;
                const refunded = childrenOf(tx.id, 'REFUND').reduce(function (sum, r) {
                    return sum + Number(r.amount || r.actualTotal || 0);
                }, 0);

                if (deposited) {
                    factionOwesMe += Math.max(0, Number(tx.billableTotal || 0) - refunded);
                } else {
                    pending += 1;
                }
            }

            if (tx.type === 'SALE') {
                const deposited = childrenOf(tx.id, 'FACTION_BALANCE_IN').reduce(function (sum, r) {
                    return sum + Number(r.amount || 0);
                }, 0);
                const collected = childrenOf(tx.id, 'FACTION_COLLECTION').reduce(function (sum, r) {
                    return sum + Number(r.amount || 0);
                }, 0);
                const saleAmount = Number(tx.amount || tx.actualTotal || 0);

                iOweFaction += Math.max(0, saleAmount - deposited - collected);
                readyToCollect += Math.max(0, deposited - collected);
            }

            if (tx.type === 'ARMORY_OUT' &&
                tx.ownership === 'FACTION' &&
                (tx.status === 'HELD' || tx.status === 'DISPLAY')) {
                assetsHeld += Number(tx.currentValue || tx.mvTotal || 0);
            }
        });

        return { factionOwesMe, iOweFaction, readyToCollect, assetsHeld, pending };
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const css = [
            '#' + DOCK_ID + '{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:24px;height:24px;padding:0;border-radius:4px;background:#26384d;color:#fff;border:1px solid rgba(255,255,255,.28);font-weight:800;font-size:14px;line-height:1}',
            '#' + PANEL_ID + '{position:fixed;z-index:2147483000;inset:6vh 2vw auto 2vw;max-width:760px;margin:0 auto;background:#111820;color:#e8edf2;border:1px solid #3b4652;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.55);font-family:Arial,sans-serif;overflow:hidden}',
            '#' + PANEL_ID + '.fliq-hidden{display:none}',
            '#' + PANEL_ID + ' *{box-sizing:border-box}',
            '.fliq-head{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;background:#18222d;border-bottom:1px solid #34404c}',
            '.fliq-title{font-weight:800}.fliq-title small{opacity:.55;font-weight:400;margin-left:6px}',
            '.fliq-close,.fliq-btn{border:1px solid #4a5968;background:#22303e;color:#fff;border-radius:7px;padding:8px 10px}',
            '.fliq-close{font-size:18px;padding:2px 9px}',
            '.fliq-tabs{display:flex;overflow-x:auto;background:#141d26;border-bottom:1px solid #34404c}',
            '.fliq-tab{flex:0 0 auto;border:0;background:transparent;color:#aeb8c2;padding:10px 11px;font-weight:700}',
            '.fliq-tab.fliq-active{color:#fff;border-bottom:2px solid #6ea8fe}',
            '.fliq-body{padding:12px;max-height:78vh;overflow:auto}',
            '.fliq-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}',
            '.fliq-card,.fliq-item{background:#18222d;border:1px solid #34404c;border-radius:9px;padding:10px}',
            '.fliq-card b{display:block;font-size:19px;margin-top:5px}',
            '.fliq-muted{opacity:.66;font-size:12px}.fliq-good{color:#7ddc9b}.fliq-warn{color:#ffcf70}.fliq-bad{color:#ff8d8d}',
            '.fliq-section{margin:12px 0}.fliq-section h3{margin:0 0 8px;font-size:14px}',
            '.fliq-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:7px 0}',
            '.fliq-field{display:flex;flex-direction:column;gap:4px}.fliq-field label{font-size:11px;opacity:.72}',
            '.fliq-field input,.fliq-field select,.fliq-field textarea{width:100%;border:1px solid #42505f;background:#0f151c;color:#fff;border-radius:6px;padding:8px}',
            '.fliq-field textarea{min-height:64px;resize:vertical}',
            '.fliq-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}',
            '.fliq-btn{cursor:pointer}.fliq-btn-primary{background:#315b86}.fliq-btn-danger{background:#69363b}',
            '.fliq-list{display:flex;flex-direction:column;gap:7px}.fliq-item-top{display:flex;justify-content:space-between;gap:8px}',
            '.fliq-pill{display:inline-block;padding:2px 6px;border-radius:999px;background:#293746;font-size:10px}',
            '.fliq-empty{text-align:center;padding:24px 10px;opacity:.55}',
            '@media(max-width:560px){.fliq-row{grid-template-columns:1fr}.fliq-grid{grid-template-columns:1fr 1fr}.fliq-tab{padding:9px 8px;font-size:12px}}'
        ].join('');

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function findDockAnchor() {
        return document.getElementById('notes_panel_button') ||
            document.getElementById('people_panel_button');
    }

    function ensureDockButton() {
        if (document.getElementById(DOCK_ID)) return;

        const anchor = findDockAnchor();
        if (!anchor || !anchor.parentNode) return;

        const btn = document.createElement('button');
        btn.id = DOCK_ID;
        btn.type = 'button';
        btn.className = anchor.className;
        btn.textContent = 'L';
        btn.title = 'FactionLedgerIQ v' + VERSION;
        btn.setAttribute('aria-label', 'Open FactionLedgerIQ');

        const box = anchor.getBoundingClientRect();
        if (box.width >= 18 && box.width <= 64) btn.style.width = Math.round(box.width) + 'px';
        if (box.height >= 18 && box.height <= 64) btn.style.height = Math.round(box.height) + 'px';

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        });

        anchor.parentNode.appendChild(btn);
    }

    function startDockObserver() {
        if (dockObserver) return;

        dockObserver = new MutationObserver(function () {
            if (dockQueued) return;
            dockQueued = true;

            requestAnimationFrame(function () {
                dockQueued = false;
                ensureDockButton();
            });
        });

        dockObserver.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function ensurePanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('section');
        panel.id = PANEL_ID;
        panel.className = 'fliq-hidden';
        panel.innerHTML =
            '<div class="fliq-head">' +
                '<div class="fliq-title">FactionLedgerIQ <small>v' + VERSION + '</small></div>' +
                '<button class="fliq-close" data-fliq="close">×</button>' +
            '</div>' +
            '<div class="fliq-tabs">' +
                ['dashboard','pending','inventory','receipts','history','settings'].map(function (t) {
                    return '<button class="fliq-tab" data-tab="' + t + '">' +
                        t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
                }).join('') +
            '</div>' +
            '<div class="fliq-body"></div>';

        document.body.appendChild(panel);
        panel.addEventListener('click', handleClick);
        panel.addEventListener('submit', handleSubmit);
        render();
    }

    function togglePanel(force) {
        ensurePanel();
        const panel = document.getElementById(PANEL_ID);
        const open = force === true ||
            (force !== false && panel.classList.contains('fliq-hidden'));
        panel.classList.toggle('fliq-hidden', !open);
        if (open) render();
    }

    function render() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;

        panel.querySelectorAll('.fliq-tab').forEach(function (btn) {
            btn.classList.toggle('fliq-active', btn.dataset.tab === activeTab);
        });

        const body = panel.querySelector('.fliq-body');
        if (activeTab === 'dashboard') body.innerHTML = renderDashboard();
        if (activeTab === 'pending') body.innerHTML = renderPending();
        if (activeTab === 'inventory') body.innerHTML = renderInventory();
        if (activeTab === 'receipts') body.innerHTML = renderReceipts();
        if (activeTab === 'history') body.innerHTML = renderHistory();
        if (activeTab === 'settings') body.innerHTML = renderSettings();
    }

    function renderDashboard() {
        const b = balances();

        return '<div class="fliq-grid">' +
            card('Faction owes me', money(b.factionOwesMe), 'fliq-good') +
            card('I owe faction', money(b.iOweFaction), 'fliq-bad') +
            card('Ready for faction to collect', money(b.readyToCollect), 'fliq-warn') +
            card('Faction assets held', money(b.assetsHeld), '') +
        '</div>' +
        '<div class="fliq-section"><h3>Quick Record</h3>' + eventForm() + '</div>' +
        '<div class="fliq-section"><h3>Ledger Status</h3>' +
            '<div class="fliq-card">' +
                '<div>' + liveTransactions().length + ' active transaction(s)</div>' +
                '<div>' + state.whitelist.length + ' whitelisted item(s)</div>' +
                '<div>' + b.pending + ' pending purchase(s)</div>' +
                '<div class="fliq-muted" style="margin-top:6px">v0.3.0 uses Torn API user logs for purchase confirmation and DOM activity for purchase context. Purchase-time MV reconciliation is still in progress.</div>' +
                '<div class="fliq-muted" style="margin-top:4px">Detector: ' + (state.settings.autoDetectPurchases ? 'ON' : 'OFF') +
                    (state.detection.lastDetectedAt ? ' · Last: ' + esc(new Date(state.detection.lastDetectedAt).toLocaleString()) + ' · ' + esc(state.detection.lastSource || '') : ' · No purchases detected yet') + '</div>' +
            '</div>' +
        '</div>';
    }

    function card(label, value, cls) {
        return '<div class="fliq-card"><span class="fliq-muted">' + esc(label) +
            '</span><b class="' + cls + '">' + esc(value) + '</b></div>';
    }

    function eventForm() {
        return '<form id="fliq-event-form" class="fliq-card">' +
            row(
                field('Event', '<select name="type">' + EVENT_TYPES.map(function (x) {
                    return '<option value="' + x[0] + '">' + esc(x[1]) + '</option>';
                }).join('') + '</select>'),
                field('Item name', '<input name="itemName" required placeholder="e.g. Xanax">')
            ) +
            row(
                field('Torn item ID (optional)', '<input name="itemId" inputmode="numeric">'),
                field('Quantity', '<input name="qty" type="number" min="1" value="1" required>')
            ) +
            row(
                field('Actual total / amount', '<input name="actualTotal" type="number" min="0" step="1" placeholder="0">'),
                field('Market value total', '<input name="mvTotal" type="number" min="0" step="1" placeholder="0">')
            ) +
            row(
                field('Source', '<input name="source" placeholder="Item Market, Bazaar, Armory...">'),
                field('Destination', '<input name="destination" placeholder="Armory, Display Case...">')
            ) +
            row(
                field('Person name', '<input name="personName" value="' + esc(state.settings.playerName) + '">'),
                field('Torn ID', '<input name="personId" value="' + esc(state.settings.playerId) + '">')
            ) +
            field('Notes', '<textarea name="notes"></textarea>') +
            '<div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" type="submit">Record Event</button></div>' +
        '</form>';
    }

    function row(a, b) {
        return '<div class="fliq-row">' + a + b + '</div>';
    }

    function field(label, control) {
        return '<div class="fliq-field"><label>' + esc(label) + '</label>' + control + '</div>';
    }

    function pendingTransactions() {
        return liveTransactions().filter(function (tx) {
            return (tx.type === 'PURCHASE' || tx.type === 'ARMORY_OUT') && tx.status === 'PENDING';
        });
    }

    function renderPending() {
        const list = pendingTransactions();
        if (!list.length) return '<div class="fliq-empty">No pending actions.</div>';
        return '<div class="fliq-list">' + list.map(function (tx) {
            return transactionCard(tx, true);
        }).join('') + '</div>';
    }

    function displayInventory() {
        const map = new Map();

        liveTransactions().forEach(function (tx) {
            const key = String(tx.itemId || tx.itemName || '').toLowerCase();
            if (!key) return;

            if (!map.has(key)) {
                map.set(key, { itemName: tx.itemName, itemId: tx.itemId, qty: 0, factionQty: 0 });
            }

            const item = map.get(key);

            if (tx.type === 'DISPLAY_IN') {
                item.qty += Number(tx.qty || 0);
                if (tx.ownership === 'FACTION') item.factionQty += Number(tx.qty || 0);
            }

            if (tx.type === 'DISPLAY_OUT') {
                item.qty -= Number(tx.qty || 0);
                if (tx.ownership === 'FACTION') item.factionQty -= Number(tx.qty || 0);
            }
        });

        return Array.from(map.values()).filter(function (x) { return x.qty !== 0; });
    }

    function renderInventory() {
        const inventory = displayInventory();

        const inventoryHtml = inventory.length
            ? '<div class="fliq-list">' + inventory.map(function (x) {
                return '<div class="fliq-item"><b>' + esc(x.itemName) + '</b>' +
                    '<div>Tracked qty: ' + Number(x.qty).toLocaleString() + '</div>' +
                    '<div class="fliq-muted">Faction-owned qty: ' + Number(x.factionQty).toLocaleString() + '</div></div>';
            }).join('') + '</div>'
            : '<div class="fliq-empty">No display-case movements recorded yet.</div>';

        const whitelistHtml = state.whitelist.length
            ? state.whitelist.map(function (w) {
                return '<div class="fliq-item fliq-item-top"><span>' + esc(w.itemName) +
                    (w.itemId ? ' <span class="fliq-muted">#' + esc(w.itemId) + '</span>' : '') +
                    '</span><button class="fliq-btn fliq-btn-danger" data-fliq="remove-whitelist" data-id="' +
                    esc(w.id) + '">Remove</button></div>';
            }).join('')
            : '<div class="fliq-empty">Whitelist is empty.</div>';

        return '<div class="fliq-section"><h3>Display Case Ledger</h3>' + inventoryHtml + '</div>' +
            '<div class="fliq-section"><h3>Whitelist</h3>' +
                '<form id="fliq-whitelist-form" class="fliq-card">' +
                    row(
                        field('Item name', '<input name="itemName" required>'),
                        field('Torn item ID (optional)', '<input name="itemId" inputmode="numeric">')
                    ) +
                    '<button class="fliq-btn fliq-btn-primary" type="submit">Add to Whitelist</button>' +
                '</form>' +
                '<div class="fliq-list" style="margin-top:8px">' + whitelistHtml + '</div>' +
            '</div>';
    }

    function receiptText(tx) {
        const aboveMV = Number(tx.actualTotal || 0) > Number(tx.mvTotal || 0) &&
            Number(tx.mvTotal || 0) > 0;

        return [
            'FACTIONLEDGERIQ RECEIPT',
            'Transaction: ' + tx.id,
            'Date: ' + new Date(tx.timestamp).toLocaleString(),
            'Person: ' + actor(tx),
            'Event: ' + tx.type,
            'Item: ' + tx.itemName + (tx.itemId ? ' [Item ' + tx.itemId + ']' : ''),
            'Quantity: ' + Number(tx.qty || 0).toLocaleString(),
            tx.source ? 'Source: ' + tx.source : null,
            tx.destination ? 'Destination: ' + tx.destination : null,
            tx.ownership ? 'Ownership: ' + tx.ownership : null,
            Number(tx.actualTotal || 0) ? 'Actual Cost/Amount: ' + money(tx.actualTotal) : null,
            Number(tx.mvTotal || 0) ? 'MV at Event: ' + money(tx.mvTotal) : null,
            tx.type === 'PURCHASE' ? 'Billable: ' + money(tx.billableTotal) : null,
            tx.type === 'PURCHASE'
                ? 'Pricing Rule: ' + (aboveMV
                    ? 'Actual cost used - purchase was above MV'
                    : 'MV used when purchase cost was below MV')
                : null,
            'Status: ' + tx.status,
            tx.notes ? 'Notes: ' + tx.notes : null
        ].filter(Boolean).join('\n');
    }

    function renderReceipts() {
        const txs = state.transactions.slice().reverse();
        if (!txs.length) return '<div class="fliq-empty">No receipts yet.</div>';

        return '<div class="fliq-list">' + txs.map(function (tx) {
            return '<div class="fliq-item">' +
                '<div class="fliq-item-top"><b>' + esc(tx.itemName) + ' × ' +
                    Number(tx.qty || 0).toLocaleString() + '</b><span class="fliq-pill">' +
                    esc(tx.type) + '</span></div>' +
                '<div class="fliq-muted">' + esc(tx.id) + ' · ' +
                    esc(new Date(tx.timestamp).toLocaleString()) + '</div>' +
                '<div class="fliq-actions"><button class="fliq-btn" data-fliq="copy-receipt" data-id="' +
                    esc(tx.id) + '">Copy Discord Receipt</button></div>' +
            '</div>';
        }).join('') + '</div>';
    }

    function transactionCard(tx, pendingActions) {
        let actions = '';

        if (pendingActions && tx.type === 'PURCHASE') {
            actions =
                '<div class="fliq-actions">' +
                    '<button class="fliq-btn" data-fliq="purchase-armory" data-id="' + esc(tx.id) + '">Deposited to Armory</button>' +
                    '<button class="fliq-btn" data-fliq="purchase-display" data-id="' + esc(tx.id) + '">Deposited to Display</button>' +
                '</div>';
        }

        if (pendingActions && tx.type === 'ARMORY_OUT') {
            actions =
                '<div class="fliq-actions">' +
                    '<button class="fliq-btn" data-fliq="armory-display" data-id="' + esc(tx.id) + '">Hold in Display</button>' +
                    '<button class="fliq-btn" data-fliq="armory-sell" data-id="' + esc(tx.id) + '">Sell for Faction</button>' +
                    '<button class="fliq-btn" data-fliq="armory-other" data-id="' + esc(tx.id) + '">Other</button>' +
                '</div>';
        }

        return '<div class="fliq-item">' +
            '<div class="fliq-item-top"><b>' + esc(tx.itemName) + ' × ' +
                Number(tx.qty || 0).toLocaleString() + '</b><span class="fliq-pill">' +
                esc(tx.type) + '</span></div>' +
            '<div>' + esc(actor(tx)) + ' · ' + esc(new Date(tx.timestamp).toLocaleString()) + '</div>' +
            (tx.type === 'PURCHASE'
                ? '<div>Actual ' + money(tx.actualTotal) + ' · MV ' + money(tx.mvTotal) +
                    ' · Billable <b>' + money(tx.billableTotal) + '</b></div>'
                : '') +
            '<div class="fliq-muted">' + esc(tx.source || '') +
                (tx.source && tx.destination ? ' → ' : '') + esc(tx.destination || '') +
                ' · ' + esc(tx.status) + '</div>' +
            actions +
            '<div class="fliq-actions">' +
                '<button class="fliq-btn" data-fliq="copy-receipt" data-id="' + esc(tx.id) + '">Receipt</button>' +
                (tx.status !== 'VOID'
                    ? '<button class="fliq-btn fliq-btn-danger" data-fliq="void" data-id="' + esc(tx.id) + '">Void</button>'
                    : '') +
            '</div>' +
        '</div>';
    }

    function renderHistory() {
        const txs = state.transactions.slice().reverse();
        if (!txs.length) return '<div class="fliq-empty">Ledger is empty.</div>';
        return '<div class="fliq-list">' + txs.map(function (tx) {
            return transactionCard(tx, false);
        }).join('') + '</div>';
    }

    function renderSettings() {
        return '<form id="fliq-settings-form" class="fliq-card">' +
            row(
                field('Your Torn name', '<input name="playerName" value="' + esc(state.settings.playerName) + '" required>'),
                field('Your Torn ID', '<input name="playerId" value="' + esc(state.settings.playerId) + '" required>')
            ) +
            field('Faction name (optional)', '<input name="factionName" value="' + esc(state.settings.factionName) + '">') +
            field('Automatic purchase detection', '<select name="autoDetectPurchases"><option value="true"' +
                (state.settings.autoDetectPurchases ? ' selected' : '') + '>On</option><option value="false"' +
                (!state.settings.autoDetectPurchases ? ' selected' : '') + '>Off</option></select>') +
            field('Torn API key', '<input name="apiKey" type="password" autocomplete="off" value="' + esc(state.settings.apiKey || '') + '" placeholder="Stored only in this TornPDA/browser storage">') +
            row(
                field('API log polling', '<select name="apiPolling"><option value="true"' + (state.settings.apiPolling ? ' selected' : '') + '>On</option><option value="false"' + (!state.settings.apiPolling ? ' selected' : '') + '>Off</option></select>'),
                field('Poll interval', '<select name="apiPollSeconds"><option value="5"' + (Number(state.settings.apiPollSeconds) === 5 ? ' selected' : '') + '>5 seconds</option><option value="10"' + (Number(state.settings.apiPollSeconds) === 10 ? ' selected' : '') + '>10 seconds</option><option value="15"' + (Number(state.settings.apiPollSeconds) === 15 ? ' selected' : '') + '>15 seconds</option></select>')
            ) +
            '<div class="fliq-muted">API status: ' + esc(state.detection.apiStatus || 'Not configured') +
                (state.detection.lastApiPollAt ? ' · Last check ' + esc(new Date(state.detection.lastApiPollAt).toLocaleTimeString()) : '') +
                (state.detection.lastApiError ? '<br>Error: ' + esc(state.detection.lastApiError) : '') + '</div>' +
            '<div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" type="submit">Save Settings</button><button class="fliq-btn" type="button" data-fliq="test-api">Test API</button></div>' +
        '</form>' +
        '<div class="fliq-section"><h3>Backup & Restore</h3><div class="fliq-card">' +
            '<div class="fliq-muted">Ledger data is stored locally in TornPDA/browser storage. Export backups regularly.</div>' +
            '<div class="fliq-actions">' +
                '<button class="fliq-btn" data-fliq="copy-backup">Copy JSON Backup</button>' +
                '<button class="fliq-btn" data-fliq="download-backup">Download Backup</button>' +
                '<button class="fliq-btn" data-fliq="import-backup">Import Backup</button>' +
            '</div>' +
            '<input id="fliq-import-file" type="file" accept=".json,application/json" style="display:none">' +
        '</div></div>' +
        '<div class="fliq-section"><h3>About</h3><div class="fliq-card fliq-muted">' +
            'v' + VERSION + ' performs no Torn game actions. This release adds local Torn API log polling and API-confirmed purchase reconciliation while retaining DOM context capture, the ledger, receipts, backup/restore, and TornPDA launcher.' +
        '</div></div>';
    }

    function formValue(fd, key) {
        return String(fd.get(key) || '').trim();
    }

    function handleSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);

        if (form.id === 'fliq-settings-form') {
            state.settings.playerName = formValue(fd, 'playerName');
            state.settings.playerId = formValue(fd, 'playerId');
            state.settings.factionName = formValue(fd, 'factionName');
            state.settings.autoDetectPurchases = formValue(fd, 'autoDetectPurchases') !== 'false';
            state.settings.apiKey = formValue(fd, 'apiKey');
            state.settings.apiPolling = formValue(fd, 'apiPolling') !== 'false';
            state.settings.apiPollSeconds = Math.max(5, Number(fd.get('apiPollSeconds') || 5));
            saveState();
            restartApiPolling();
            toast('Settings saved');
            return;
        }

        if (form.id === 'fliq-whitelist-form') {
            const itemName = formValue(fd, 'itemName');
            if (!itemName) return;

            state.whitelist.push({
                id: uid('WL'),
                itemName: itemName,
                itemId: formValue(fd, 'itemId'),
                createdAt: new Date().toISOString()
            });

            saveState();
            toast('Added to whitelist');
            return;
        }

        if (form.id === 'fliq-event-form') {
            const type = formValue(fd, 'type');
            const qty = Math.max(1, Number(fd.get('qty') || 1));
            const actualTotal = Math.max(0, Number(fd.get('actualTotal') || 0));
            const mvTotal = Math.max(0, Number(fd.get('mvTotal') || 0));

            state.transactions.push({
                id: uid('TX'),
                chainId: uid('CHAIN'),
                parentId: null,
                type: type,
                timestamp: new Date().toISOString(),
                itemName: formValue(fd, 'itemName'),
                itemId: formValue(fd, 'itemId'),
                qty: qty,
                actualTotal: actualTotal,
                mvTotal: mvTotal,
                billableTotal: type === 'PURCHASE' ? billable(actualTotal, mvTotal) : 0,
                amount: actualTotal,
                source: formValue(fd, 'source'),
                destination: formValue(fd, 'destination'),
                personName: formValue(fd, 'personName'),
                personId: formValue(fd, 'personId'),
                notes: formValue(fd, 'notes'),
                ownership: type === 'ARMORY_OUT' ? 'FACTION' : (type === 'PURCHASE' ? 'PERSONAL' : ''),
                status: (type === 'PURCHASE' || type === 'ARMORY_OUT') ? 'PENDING' : 'RECORDED',
                createdAt: new Date().toISOString()
            });

            saveState();
            form.reset();
            toast('Event recorded');
        }
    }

    function addChild(parent, type, overrides) {
        const child = {
            ...clone(parent),
            id: uid('TX'),
            type: type,
            parentId: parent.id,
            chainId: parent.chainId || parent.id,
            timestamp: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            actualTotal: 0,
            billableTotal: 0,
            amount: 0,
            notes: '',
            status: 'RECORDED',
            ...(overrides || {})
        };

        state.transactions.push(child);
        return child;
    }

    function handleClick(e) {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
            activeTab = tab.dataset.tab;
            render();
            return;
        }

        const btn = e.target.closest('[data-fliq]');
        if (!btn) return;

        const action = btn.dataset.fliq;
        const id = btn.dataset.id;
        const tx = state.transactions.find(function (x) { return x.id === id; });

        if (action === 'close') {
            togglePanel(false);
            return;
        }

        if (action === 'remove-whitelist') {
            state.whitelist = state.whitelist.filter(function (x) { return x.id !== id; });
            saveState();
            return;
        }

        if (action === 'copy-receipt' && tx) {
            copyText(receiptText(tx)).then(function () { toast('Receipt copied'); });
            return;
        }

        if (action === 'void' && tx) {
            const reason = prompt('Reason for void/correction?');
            if (reason === null) return;
            tx.status = 'VOID';
            tx.voidReason = reason.trim() || 'Voided by user';
            tx.voidedAt = new Date().toISOString();
            saveState();
            toast('Transaction voided; audit retained');
            return;
        }

        if (action === 'purchase-armory' && tx) {
            tx.status = 'DEPOSITED';
            addChild(tx, 'ARMORY_IN', {
                source: 'Personal Inventory',
                destination: 'Faction Armory',
                ownership: 'PERSONAL_PURCHASE_PENDING_REIMBURSEMENT'
            });
            saveState();
            return;
        }

        if (action === 'purchase-display' && tx) {
            tx.status = 'DEPOSITED';
            addChild(tx, 'DISPLAY_IN', {
                source: 'Personal Inventory',
                destination: 'Display Case',
                ownership: 'FACTION_AFTER_BILLING'
            });
            saveState();
            return;
        }

        if (action === 'armory-display' && tx) {
            tx.status = 'DISPLAY';
            addChild(tx, 'DISPLAY_IN', {
                source: 'Faction Armory',
                destination: 'Display Case',
                ownership: 'FACTION'
            });
            saveState();
            return;
        }

        if (action === 'armory-sell' && tx) {
            tx.status = 'HELD';
            tx.notes = [tx.notes, 'Purpose: Sell for faction'].filter(Boolean).join(' | ');
            saveState();
            return;
        }

        if (action === 'armory-other' && tx) {
            const note = prompt('Purpose / note:');
            if (note === null) return;
            tx.status = 'OTHER';
            tx.notes = [tx.notes, note].filter(Boolean).join(' | ');
            saveState();
            return;
        }

        if (action === 'test-api') {
            pollApiLogs(true);
            return;
        }

        if (action === 'copy-backup') {
            copyText(JSON.stringify(state, null, 2)).then(function () { toast('Backup copied'); });
            return;
        }

        if (action === 'download-backup') {
            const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'FactionLedgerIQ-backup-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            return;
        }

        if (action === 'import-backup') {
            const input = document.getElementById('fliq-import-file');
            if (!input) return;

            input.onchange = async function () {
                const file = input.files && input.files[0];
                if (!file) return;

                try {
                    const parsed = JSON.parse(await file.text());
                    if (!parsed || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.whitelist)) {
                        throw new Error('Invalid backup');
                    }

                    if (!confirm('Import backup with ' + parsed.transactions.length +
                        ' transactions? This replaces current local data.')) return;

                    state = {
                        ...clone(DEFAULT_STATE),
                        ...parsed,
                        settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) }
                    };

                    saveState();
                    toast('Backup imported');
                } catch (err) {
                    alert('FactionLedgerIQ: Could not import that backup.');
                }

                input.value = '';
            };

            input.click();
        }
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    }

    function toast(message) {
        let el = document.getElementById('fliq-toast');

        if (!el) {
            el = document.createElement('div');
            el.id = 'fliq-toast';
            el.style.cssText =
                'position:fixed;z-index:2147483647;left:50%;bottom:70px;transform:translateX(-50%);' +
                'background:#111;color:#fff;border:1px solid #555;border-radius:8px;padding:9px 12px;' +
                'font:12px Arial;box-shadow:0 4px 18px #0008';
            document.body.appendChild(el);
        }

        el.textContent = message;
        el.style.display = 'block';
        clearTimeout(el._timer);
        el._timer = setTimeout(function () { el.style.display = 'none'; }, 1800);
    }

    function init() {
        injectStyles();
        ensurePanel();
        ensureDockButton();
        startDockObserver();
        startPurchaseDetection();
        restartApiPolling();
        window.addEventListener('pageshow', ensureDockButton);
        window.addEventListener('popstate', function () {
            setTimeout(ensureDockButton, 100);
        });
        console.info('[FactionLedgerIQ] v' + VERSION + ' loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
