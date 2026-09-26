// ==UserScript==
// @name         FactionLedgerIQ
// @namespace    FactionLedgerIQ
// @version      0.6.2
// @description  TornPDA-first faction purchase, asset, reimbursement, and receipt ledger.
// @match        *://www.torn.com/*
// @match        *://torn.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.6.2';
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
        people: {},
        accounting: { schemaVersion: 1, lots: [], allocations: [] },
        detection: { processedFingerprints: [], processedLogIds: [], recentApiEvents: [], recentFactionCandidates: [], factionMovementBuffer: [], factionBalanceSnapshot: null, lastDetectedAt: '', lastSource: '', lastApiPollAt: '', lastApiError: '', apiStatus: 'Not configured' },
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
    let itemCatalog = [];
    let itemCatalogLoadedAt = 0;
    let itemSearchTimer = null;
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
                people: { ...(parsed.people || {}) },
                accounting: { ...clone(DEFAULT_STATE.accounting), ...(parsed.accounting || {}), lots: Array.isArray(parsed.accounting && parsed.accounting.lots) ? parsed.accounting.lots : [], allocations: Array.isArray(parsed.accounting && parsed.accounting.allocations) ? parsed.accounting.allocations : [] },
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

    function ensureAccounting() {
        state.accounting = state.accounting || {};
        state.accounting.schemaVersion = 2;
        state.accounting.lots = Array.isArray(state.accounting.lots) ? state.accounting.lots : [];
        state.accounting.allocations = Array.isArray(state.accounting.allocations) ? state.accounting.allocations : [];
    }

    function lotForSource(sourceTxId) {
        ensureAccounting();
        return state.accounting.lots.find(function (lot) { return lot.sourceTxId === sourceTxId && lot.status !== 'VOID'; }) || null;
    }

    function allocatedQty(lotId) {
        ensureAccounting();
        return state.accounting.allocations.filter(function (a) { return a.lotId === lotId && a.status !== 'VOID'; })
            .reduce(function (n, a) { return n + Number(a.qty || 0); }, 0);
    }

    function ensureSourceLot(tx) {
        if (!tx || tx.status === 'VOID' || !tx.itemId) return null;
        let ownership = '', location = '', reimbursable = false;
        if (tx.type === 'PURCHASE') {
            ownership = 'PERSONAL'; location = 'PERSONAL_INVENTORY'; reimbursable = true;
        } else if (tx.type === 'ARMORY_OUT' && tx.ownership === 'FACTION') {
            ownership = 'FACTION'; location = tx.status === 'DISPLAY' ? 'DISPLAY_CASE' : 'PERSONAL_INVENTORY';
        } else return null;
        let lot = lotForSource(tx.id);
        if (!lot) {
            lot = { id: uid('LOT'), sourceTxId: tx.id, chainId: tx.chainId || tx.id,
                itemId: String(tx.itemId), itemName: tx.itemName || '', ownership: ownership,
                reimbursable: reimbursable, location: location, qtyOriginal: Number(tx.qty || 0),
                qtyRemaining: Number(tx.qty || 0), actualTotal: Number(tx.actualTotal || 0),
                mvTotal: Number(tx.mvTotal || 0), billableTotal: Number(tx.billableTotal || 0),
                createdAt: tx.timestamp || new Date().toISOString(), status: 'OPEN' };
            state.accounting.lots.push(lot);
        }
        lot.qtyRemaining = Math.max(0, Number(lot.qtyOriginal || 0) - allocatedQty(lot.id));
        lot.status = lot.qtyRemaining ? 'OPEN' : 'CONSUMED';
        if (tx.type === 'ARMORY_OUT' && tx.status === 'DISPLAY') lot.location = 'DISPLAY_CASE';
        return lot;
    }

    function openLots(itemId, ownership) {
        ensureAccounting();
        liveTransactions().forEach(ensureSourceLot);
        return state.accounting.lots.filter(function (lot) {
            lot.qtyRemaining = Math.max(0, Number(lot.qtyOriginal || 0) - allocatedQty(lot.id));
            lot.status = lot.qtyRemaining ? 'OPEN' : 'CONSUMED';
            return lot.status === 'OPEN' && String(lot.itemId) === String(itemId) &&
                (!ownership || lot.ownership === ownership);
        }).sort(function (a,b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    }

    function allocateMovement(tx, ownership) {
        ensureAccounting();
        if (!tx || !tx.id || state.accounting.allocations.some(function (a) { return a.movementId === tx.id && a.status !== 'VOID'; })) return false;
        let remaining = Number(tx.qty || 0), changed = false;
        openLots(tx.itemId, ownership).forEach(function (lot) {
            if (remaining <= 0) return;
            const take = Math.min(remaining, Number(lot.qtyRemaining || 0));
            if (!take) return;
            const q = Math.max(1, Number(lot.qtyOriginal || 1));
            state.accounting.allocations.push({ id: uid('ALLOC'), lotId: lot.id, sourceTxId: lot.sourceTxId,
                movementId: tx.id, itemId: tx.itemId, qty: take, ownership: lot.ownership,
                actualTotal: Math.round(Number(lot.actualTotal || 0) / q * take),
                mvTotal: Math.round(Number(lot.mvTotal || 0) / q * take),
                billableTotal: Math.round(Number(lot.billableTotal || 0) / q * take),
                createdAt: new Date().toISOString(), status: 'ACTIVE' });
            remaining -= take; changed = true;
            lot.qtyRemaining = Math.max(0, Number(lot.qtyRemaining || 0) - take);
            lot.status = lot.qtyRemaining ? 'OPEN' : 'CONSUMED';
        });
        if (changed) {
            tx.lotAllocatedQty = Number(tx.qty || 0) - remaining;
            tx.lotUnresolvedQty = remaining;
        }
        return changed;
    }

    function reconcileOwnershipLots() {
        ensureAccounting();
        let changed = false;
        liveTransactions().forEach(function (tx) {
            if ((tx.type === 'PURCHASE' || (tx.type === 'ARMORY_OUT' && tx.ownership === 'FACTION')) && !lotForSource(tx.id)) {
                ensureSourceLot(tx); changed = true;
            }
        });
        liveTransactions().forEach(function (tx) {
            if (tx.type === 'SALE' && tx.parentId && allocateMovement(tx, 'FACTION')) changed = true;
            if (tx.type === 'DISPLAY_IN' && tx.ownership === 'FACTION' && tx.parentId) {
                const lot = lotForSource(tx.parentId);
                if (lot && lot.location !== 'DISPLAY_CASE') { lot.location = 'DISPLAY_CASE'; changed = true; }
            }
        });
        return changed;
    }

    function sameMovement(tx, type, timestamp, factionId, itemId, qty) {
        if (!tx || tx.type !== type || tx.status === 'VOID') return false;
        const a = new Date(tx.timestamp).getTime();
        const b = Number(timestamp || 0) * 1000;
        if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 2000) return false;
        if (String(tx.itemId || '') !== String(itemId || '')) return false;
        if (Number(tx.qty || 0) !== Number(qty || 0)) return false;
        // Older versions did not always persist factionId, so missing factionId must not defeat dedup.
        if (tx.factionId && factionId && String(tx.factionId) !== String(factionId)) return false;
        return true;
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
        const source = data.log != null ? data.log : (data.logs != null ? data.logs : data);
        if (Array.isArray(source)) return source;
        if (source && typeof source === 'object') {
            return Object.keys(source).map(function (key) {
                const value = source[key];
                if (!value || typeof value !== 'object') return null;
                if (value.id == null && value.log_id == null && value.logId == null) {
                    return { ...value, id: key };
                }
                return value;
            }).filter(Boolean);
        }
        return [];
    }

    function logId(log) {
        return String(log && (log.id || log.log_id || log.logId || log.ID) || '');
    }

    function safeApiEvent(log) {
        if (!log || typeof log !== 'object') return null;
        const data = log.data && typeof log.data === 'object' ? log.data : {};
        const safeData = {};
        Object.keys(data).slice(0, 40).forEach(function (key) {
            if (/key|token|secret|auth/i.test(key)) return;
            const value = data[key];
            if (value == null || ['string','number','boolean'].includes(typeof value)) safeData[key] = value;
            else if (Array.isArray(value)) safeData[key] = value.slice(0, 10);
            else if (typeof value === 'object') {
                const nested = {};
                Object.keys(value).slice(0, 20).forEach(function (k) {
                    if (/key|token|secret|auth/i.test(k)) return;
                    const v = value[k];
                    if (v == null || ['string','number','boolean'].includes(typeof v)) nested[k] = v;
                });
                safeData[key] = nested;
            }
        });
        return {
            id: logId(log),
            timestamp: log.timestamp || '',
            title: log.title || '',
            category: log.category || '',
            type: log.type || '',
            text: String(log.text || log.log || '').slice(0, 500),
            data: safeData
        };
    }

    function rememberApiEvents(logs) {
        const incoming = (logs || []).map(safeApiEvent).filter(Boolean);
        const existing = Array.isArray(state.detection.recentApiEvents) ? state.detection.recentApiEvents : [];
        const merged = [];
        const seen = new Set();
        incoming.concat(existing).forEach(function (ev) {
            const key = String(ev && ev.id || '') || [ev && ev.timestamp, JSON.stringify(ev && ev.data || {})].join('|');
            if (!key || seen.has(key)) return;
            seen.add(key);
            merged.push(ev);
        });
        state.detection.recentApiEvents = merged
            .sort(function (a, b) { return Number(b.timestamp || 0) - Number(a.timestamp || 0); })
            .slice(0, 40);
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

    function factionMovementCandidate(log) {
        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        const text = logText(log).toLowerCase();
        const hasFactionHint = /faction|armou?r|display case/.test(text);
        if (!hasFactionHint) return null;

        // Exclude the already-understood Item Market purchase signature.
        if (Array.isArray(data.items) && data.items.length &&
            (data.cost_total != null || data.cost_each != null) && data.seller != null) return null;

        const movementHint = /deposit|deposited|give|gave|add|added|put|store|stored|withdraw|withdrew|take|took|remove|removed|retrieve|retrieved/.test(text);
        if (!movementHint) return null;

        return {
            id: logId(log),
            timestamp: log.timestamp || '',
            text: text.slice(0, 800),
            data: safeApiEvent(log) ? safeApiEvent(log).data : {}
        };
    }

    function rememberFactionCandidate(log) {
        const candidate = factionMovementCandidate(log);
        if (!candidate) return false;
        state.detection.recentFactionCandidates = Array.isArray(state.detection.recentFactionCandidates)
            ? state.detection.recentFactionCandidates : [];
        if (state.detection.recentFactionCandidates.some(function (x) { return x.id === candidate.id; })) return false;
        state.detection.recentFactionCandidates.unshift(candidate);
        state.detection.recentFactionCandidates = state.detection.recentFactionCandidates.slice(0, 20);
        return true;
    }

    function factionTransferPart(log) {
        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        const rows = Array.isArray(data.items) ? data.items : (Array.isArray(data.item) ? data.item : []);
        if (!rows.length || data.faction == null) return null;
        const actorId = String(state.settings.playerId || '').trim();
        const sender = data.sender == null ? '' : String(data.sender);
        const receiver = data.receiver == null ? '' : String(data.receiver);
        if (!sender && !receiver) return null;
        if (actorId && sender !== actorId && receiver !== actorId) return null;
        return {
            logId: logId(log),
            timestamp: Number(log.timestamp || 0),
            factionId: String(data.faction),
            sender: sender,
            receiver: receiver,
            rows: rows.map(function (row) {
                return { itemId: String(row.id || row.item_id || ''), qty: Math.max(1, Number(row.qty || row.quantity || 1)) };
            }).filter(function (row) { return row.itemId; })
        };
    }

    function movementKey(part, row) {
        return [part.timestamp, part.factionId, row.itemId, row.qty].join('|');
    }

    function suppressDuplicateArmoryOuts() {
        const rows = state.transactions.filter(function (tx) {
            return tx && tx.type === 'ARMORY_OUT' && tx.status !== 'VOID';
        }).sort(function (a, b) {
            return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
        let changed = false;
        for (let i = 0; i < rows.length; i += 1) {
            const keep = rows[i];
            if (!keep || keep.status === 'VOID') continue;
            for (let j = i + 1; j < rows.length; j += 1) {
                const dup = rows[j];
                if (!dup || dup.status === 'VOID') continue;
                const dt = Math.abs(new Date(keep.timestamp).getTime() - new Date(dup.timestamp).getTime());
                if (dt > 2000) break;
                if (String(keep.itemId || '') !== String(dup.itemId || '')) continue;
                if (Number(keep.qty || 0) !== Number(dup.qty || 0)) continue;
                if (keep.factionId && dup.factionId && String(keep.factionId) !== String(dup.factionId)) continue;
                if (childrenOf(dup.id).length) continue;
                dup.status = 'VOID';
                dup.voidReason = 'Automatically suppressed duplicate API armory-withdrawal record.';
                dup.voidedAt = new Date().toISOString();
                changed = true;
            }
        }
        return changed;
    }

    function reconcileLegacyPurchaseDuplicates() {
        let changed = false;
        const purchases = state.transactions.filter(function (tx) {
            return tx && tx.type === 'PURCHASE' && tx.status !== 'VOID';
        }).sort(function (a, b) { return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); });

        for (let i = 0; i < purchases.length; i += 1) {
            const a = purchases[i];
            if (!a || a.status === 'VOID') continue;
            for (let j = i + 1; j < purchases.length; j += 1) {
                const b = purchases[j];
                if (!b || b.status === 'VOID') continue;
                const dt = Math.abs(new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                if (dt > 15000) break;
                if (String(a.itemId || '') !== String(b.itemId || '')) continue;
                if (Number(a.qty || 0) !== Number(b.qty || 0)) continue;
                if (Number(a.actualTotal || 0) !== Number(b.actualTotal || 0)) continue;
                const apiA = String(a.detectionMethod || '').indexOf('API') === 0;
                const apiB = String(b.detectionMethod || '').indexOf('API') === 0;
                const domA = a.detectionMethod === 'DOM_CONFIRMATION';
                const domB = b.detectionMethod === 'DOM_CONFIRMATION';
                if (!((apiA && domB) || (apiB && domA))) continue;
                const keep = apiA ? a : b;
                const dup = apiA ? b : a;
                if (childrenOf(dup.id).length) continue;
                dup.status = 'VOID';
                dup.voidReason = 'Legacy cleanup: duplicate DOM purchase superseded by API-confirmed purchase.';
                dup.voidedAt = new Date().toISOString();
                dup.supersededBy = keep.id;
                changed = true;
            }
        }
        return changed;
    }

    function reconcilePurchasesToArmoryDeposits() {
        let changed = false;
        const cutoffMs = Date.now() - (30 * 60 * 1000);
        const deposits = liveTransactions().filter(function (tx) {
            return tx.type === 'ARMORY_IN' &&
                tx.ownership === 'PERSONAL_CONTRIBUTION_PENDING_REIMBURSEMENT' &&
                !tx.purchaseAllocationId &&
                new Date(tx.timestamp).getTime() >= cutoffMs;
        }).sort(function (a, b) { return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); });

        deposits.forEach(function (dep) {
            const remaining = Number(dep.qty || 0);
            if (!(remaining > 0)) return;
            const depMs = new Date(dep.timestamp).getTime();
            const candidates = liveTransactions().filter(function (p) {
                if (p.type !== 'PURCHASE' || p.status !== 'PENDING') return false;
                if (String(p.itemId || '') !== String(dep.itemId || '')) return false;
                if (Number(p.qty || 0) !== remaining) return false;
                const pMs = new Date(p.timestamp).getTime();
                return Number.isFinite(pMs) && pMs <= depMs && depMs - pMs <= 7 * 24 * 60 * 60 * 1000;
            }).sort(function (a, b) { return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); });

            if (candidates.length !== 1) {
                if (candidates.length > 1) {
                    const nextIds = candidates.map(function (p) { return p.id; });
                    const wasSame = dep.status === 'ALLOCATION_REQUIRED' &&
                        JSON.stringify(dep.allocationCandidateIds || []) === JSON.stringify(nextIds);
                    dep.status = 'ALLOCATION_REQUIRED';
                    dep.allocationRequired = true;
                    dep.allocationCandidateIds = nextIds;
                    if (!wasSame) {
                        dep.notes = [dep.notes, 'Multiple exact-quantity personal purchase lots exist; select which purchase funded this armory deposit.']
                            .filter(Boolean).join(' | ');
                        changed = true;
                    }
                }
                return;
            }

            const purchase = candidates[0];
            purchase.status = 'DEPOSITED';
            purchase.depositTransactionId = dep.id;
            dep.purchaseAllocationId = purchase.id;
            dep.ownership = 'PERSONAL_PURCHASE_PENDING_REIMBURSEMENT';
            dep.status = 'RECORDED';
            dep.allocationRequired = false;
            dep.allocationCandidateIds = [];
            dep.billableTotal = Number(purchase.billableTotal || dep.billableTotal || dep.mvTotal || 0);
            dep.actualTotal = Number(purchase.actualTotal || 0);
            dep.mvTotal = Number(purchase.mvTotal || dep.mvTotal || 0);
            dep.mvEach = Number(purchase.mvEach || dep.mvEach || 0);
            dep.notes = [dep.notes, 'Matched to the only exact-quantity eligible purchase ' + purchase.id + '; frozen purchase billable amount retained.']
                .filter(Boolean).join(' | ');
            purchase.notes = [purchase.notes, 'Automatically matched to faction armory deposit ' + dep.id + '.']
                .filter(Boolean).join(' | ');
            ensureAccounting();
            state.accounting.allocations.push({
                id: uid('ALLOC'), kind: 'PURCHASE_TO_ARMORY', purchaseId: purchase.id,
                movementId: dep.id, itemId: dep.itemId, qty: remaining,
                billableTotal: dep.billableTotal, createdAt: new Date().toISOString(), status: 'ACTIVE'
            });
            changed = true;
        });
        return changed;
    }

    function displayCaseDepositPart(log) {
        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        const rows = Array.isArray(data.items) ? data.items : [];
        if (!rows.length) return null;
        // Observed Display Case deposit event: items[] only. Reject faction transfers,
        // market purchases, and other actor-addressed item movements.
        if (data.faction != null || data.sender != null || data.receiver != null ||
            data.seller != null || data.cost_total != null || data.cost_each != null) return null;
        const meaningfulKeys = Object.keys(data).filter(function (k) { return data[k] != null; });
        if (meaningfulKeys.some(function (k) { return k !== 'items'; })) return null;
        return {
            logId: logId(log),
            timestamp: Number(log.timestamp || 0),
            rows: rows.map(function (row) {
                return {
                    itemId: String(row && (row.id || row.item_id) || '').trim(),
                    qty: Math.max(1, Number(row && (row.qty || row.quantity) || 1))
                };
            }).filter(function (row) { return row.itemId; })
        };
    }

    function reconcileDisplayCaseDeposits(logs) {
        let changed = false;
        const candidates = (logs || []).map(displayCaseDepositPart).filter(Boolean)
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        candidates.forEach(function (part) {
            if (!part.logId || liveTransactions().some(function (tx) {
                return tx.displayApiLogId === part.logId ||
                    (Array.isArray(tx.apiLogIds) && tx.apiLogIds.includes(part.logId));
            })) return;

            part.rows.forEach(function (row) {
                const eventMs = part.timestamp * 1000;
                const match = liveTransactions().filter(function (tx) {
                    if (tx.type !== 'ARMORY_OUT' || tx.ownership !== 'FACTION') return false;
                    if (tx.status !== 'PENDING' && tx.status !== 'HELD') return false;
                    if (String(tx.itemId || '') !== row.itemId || Number(tx.qty || 0) !== row.qty) return false;
                    const outMs = new Date(tx.timestamp).getTime();
                    return Number.isFinite(outMs) && outMs <= eventMs && eventMs - outMs <= 10 * 60 * 1000;
                }).sort(function (a, b) {
                    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                })[0];

                if (!match) return;
                match.status = 'DISPLAY';
                match.notes = [match.notes, 'API-confirmed matching deposit into Display Case; faction ownership retained.']
                    .filter(Boolean).join(' | ');
                match.displayApiLogId = part.logId;
                match.apiLogIds = Array.from(new Set([].concat(match.apiLogIds || [], [part.logId]).filter(Boolean)));

                state.transactions.push({
                    id: uid('TX'),
                    chainId: match.chainId || match.id,
                    parentId: match.id,
                    type: 'DISPLAY_IN',
                    timestamp: part.timestamp ? new Date(part.timestamp * 1000).toISOString() : new Date().toISOString(),
                    itemName: match.itemName,
                    itemId: match.itemId,
                    qty: match.qty,
                    actualTotal: 0,
                    mvTotal: Number(match.mvTotal || 0),
                    mvEach: Number(match.mvEach || 0),
                    billableTotal: 0,
                    amount: 0,
                    source: 'Personal Inventory',
                    destination: 'Display Case',
                    personName: state.settings.playerName,
                    personId: state.settings.playerId,
                    notes: 'Automatically reconciled from faction armory withdrawal to Display Case. Faction-owned; no reimbursement created.',
                    ownership: 'FACTION',
                    status: 'RECORDED',
                    detectionMethod: 'API_DISPLAY_IN_RECONCILED',
                    displayApiLogId: part.logId,
                    apiLogIds: [part.logId],
                    createdAt: new Date().toISOString()
                });
                changed = true;
            });
        });
        return changed;
    }

    function displayCaseWithdrawalPart(log) {
        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        const rows = Array.isArray(data.items) ? data.items : [];
        if (!rows.length) return null;
        // Display Case removals are not assumed from the same items-only signature used
        // for deposits. Only accept an items-only event when it can be paired uniquely
        // with a currently displayed faction-owned chain. This avoids inventing provenance.
        if (data.faction != null || data.sender != null || data.receiver != null ||
            data.seller != null || data.cost_total != null || data.cost_each != null) return null;
        const meaningfulKeys = Object.keys(data).filter(function (k) { return data[k] != null; });
        if (meaningfulKeys.some(function (k) { return k !== 'items'; })) return null;
        return {
            logId: logId(log),
            timestamp: Number(log.timestamp || 0),
            rows: rows.map(function (row) {
                return {
                    itemId: String(row && (row.id || row.item_id) || '').trim(),
                    qty: Math.max(1, Number(row && (row.qty || row.quantity) || 1))
                };
            }).filter(function (row) { return row.itemId; })
        };
    }

    function reconcileDisplayCaseWithdrawals(logs) {
        let changed = false;
        const candidates = (logs || []).map(displayCaseWithdrawalPart).filter(Boolean)
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        candidates.forEach(function (part) {
            if (!part.logId || liveTransactions().some(function (tx) {
                return tx.displayOutApiLogId === part.logId ||
                    (tx.type === 'DISPLAY_OUT' && Array.isArray(tx.apiLogIds) && tx.apiLogIds.includes(part.logId));
            })) return;

            part.rows.forEach(function (row) {
                // A DISPLAY_IN event using this same API log means this was a deposit,
                // not a withdrawal. Never reinterpret a previously reconciled deposit.
                if (liveTransactions().some(function (tx) {
                    return tx.type === 'DISPLAY_IN' &&
                        (tx.displayApiLogId === part.logId ||
                         (Array.isArray(tx.apiLogIds) && tx.apiLogIds.includes(part.logId)));
                })) return;

                const displayed = liveTransactions().filter(function (tx) {
                    return tx.type === 'ARMORY_OUT' && tx.ownership === 'FACTION' &&
                        tx.status === 'DISPLAY' &&
                        String(tx.itemId || '') === row.itemId &&
                        Number(tx.qty || 0) === row.qty &&
                        childrenOf(tx.id, 'DISPLAY_IN').length &&
                        !childrenOf(tx.id, 'DISPLAY_OUT').length;
                });

                // Exact item + quantity + exactly one open displayed faction chain.
                // If ambiguous, leave it unresolved for diagnostics rather than guessing.
                if (displayed.length !== 1) return;
                const match = displayed[0];
                const displayIn = childrenOf(match.id, 'DISPLAY_IN')
                    .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); })[0];
                const inMs = displayIn ? new Date(displayIn.timestamp).getTime() : 0;
                const outMs = part.timestamp * 1000;
                if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) return;

                match.status = 'HELD';
                match.notes = [match.notes, 'API-confirmed removal from Display Case; faction ownership retained while held in personal inventory.']
                    .filter(Boolean).join(' | ');
                match.displayOutApiLogId = part.logId;
                match.apiLogIds = Array.from(new Set([].concat(match.apiLogIds || [], [part.logId]).filter(Boolean)));

                state.transactions.push({
                    id: uid('TX'),
                    chainId: match.chainId || match.id,
                    parentId: match.id,
                    type: 'DISPLAY_OUT',
                    timestamp: part.timestamp ? new Date(part.timestamp * 1000).toISOString() : new Date().toISOString(),
                    itemName: match.itemName,
                    itemId: match.itemId,
                    qty: row.qty,
                    actualTotal: 0,
                    mvTotal: Number(match.mvTotal || 0),
                    mvEach: Number(match.mvEach || 0),
                    billableTotal: 0,
                    amount: 0,
                    source: 'Display Case',
                    destination: 'Personal Inventory',
                    personName: state.settings.playerName,
                    personId: state.settings.playerId,
                    notes: 'Automatically reconciled Display Case withdrawal. Faction-owned asset is now held in personal inventory; no reimbursement or debt created.',
                    ownership: 'FACTION',
                    status: 'HELD',
                    detectionMethod: 'API_DISPLAY_OUT_RECONCILED',
                    displayOutApiLogId: part.logId,
                    apiLogIds: [part.logId],
                    createdAt: new Date().toISOString()
                });

                const lot = lotForSource(match.id);
                if (lot) {
                    lot.location = 'PERSONAL_INVENTORY';
                    lot.status = Number(lot.qtyRemaining || 0) > 0 ? 'OPEN' : lot.status;
                }
                state.detection.lastDetectedAt = new Date().toISOString();
                state.detection.lastSource = 'Torn API · Display Case Withdrawal';
                changed = true;
            });
        });
        return changed;
    }

    function factionHeldSourceForMovement(itemId, qty, eventTimestamp) {
        const eventMs = Number(eventTimestamp || 0) * 1000;
        const candidates = liveTransactions().filter(function (tx) {
            if (tx.type !== 'ARMORY_OUT' || tx.ownership !== 'FACTION') return false;
            if (tx.status !== 'HELD' && tx.status !== 'PENDING') return false;
            if (String(tx.itemId || '') !== String(itemId || '')) return false;
            const txMs = new Date(tx.timestamp).getTime();
            if (!Number.isFinite(txMs) || !Number.isFinite(eventMs) || txMs > eventMs) return false;
            const lot = lotForSource(tx.id) || ensureSourceLot(tx);
            return lot && Number(lot.qtyRemaining || 0) >= Number(qty || 0);
        }).sort(function (a,b) { return new Date(b.timestamp) - new Date(a.timestamp); });
        return candidates.length === 1 ? candidates[0] : null;
    }

    function allocateFactionLotSlice(source, movement, qty, kind) {
        ensureAccounting();
        const lot = lotForSource(source.id) || ensureSourceLot(source);
        if (!lot || Number(lot.qtyRemaining || 0) < Number(qty || 0)) return false;
        const q = Math.max(1, Number(lot.qtyOriginal || source.qty || 1));
        state.accounting.allocations.push({
            id: uid('ALLOC'), kind: kind, lotId: lot.id, sourceTxId: source.id,
            movementId: movement.id, itemId: source.itemId, qty: Number(qty || 0),
            ownership: 'FACTION',
            actualTotal: Math.round(Number(lot.actualTotal || 0) / q * Number(qty || 0)),
            mvTotal: Math.round(Number(lot.mvTotal || source.mvTotal || 0) / q * Number(qty || 0)),
            billableTotal: 0, createdAt: new Date().toISOString(), status: 'ACTIVE'
        });
        lot.qtyRemaining = Math.max(0, Number(lot.qtyRemaining || 0) - Number(qty || 0));
        lot.status = lot.qtyRemaining ? 'OPEN' : 'CONSUMED';
        source.lotAllocatedQty = Number(source.qty || 0) - lot.qtyRemaining;
        source.lotUnresolvedQty = lot.qtyRemaining;
        if (!lot.qtyRemaining && kind === 'FACTION_RETURN') source.status = 'RETURNED';
        return true;
    }

    async function reconcileFactionMovement(logs) {
        try { await ensureItemCatalog(false); } catch (e) {}
        const actorId = String(state.settings.playerId || '').trim();
        let changed = false;

        // Observed ARMORY_IN signature: faction + items[], with no sender/receiver.
        // This is distinct from Item Market purchases because there are no cost fields/seller.
        (logs || []).forEach(function (log) {
            const data = log && log.data && typeof log.data === 'object' ? log.data : {};
            const rows = Array.isArray(data.items) ? data.items : [];
            if (data.faction == null || !rows.length || data.sender != null || data.receiver != null) return;
            if (data.cost_total != null || data.cost_each != null || data.seller != null) return;

            rows.forEach(function (row) {
                const itemId = String(row.id || row.item_id || '').trim();
                const qty = Math.max(1, Number(row.qty || row.quantity || 1));
                if (!itemId) return;
                const key = ['IN', log.timestamp || 0, data.faction, itemId, qty, logId(log)].join('|');
                if (liveTransactions().some(function (tx) {
                    return tx.factionMovementKey === key ||
                        sameMovement(tx, 'ARMORY_IN', log.timestamp, data.faction, itemId, qty);
                })) return;

                const item = itemCatalog.find(function (x) { return String(x.id) === itemId; });
                const mvEach = item ? Math.max(0, Number(item.marketValue || 0)) : 0;
                const mvTotal = mvEach * qty;
                const factionSource = factionHeldSourceForMovement(itemId, qty, log.timestamp);
                if (factionSource) {
                    const returned = {
                        id: uid('TX'), chainId: factionSource.chainId || factionSource.id, parentId: factionSource.id,
                        type: 'ARMORY_IN',
                        timestamp: log.timestamp ? new Date(Number(log.timestamp) * 1000).toISOString() : new Date().toISOString(),
                        itemName: factionSource.itemName || (item ? item.name : ('Item #' + itemId)),
                        itemId: itemId, qty: qty, actualTotal: 0, mvTotal: mvTotal, mvEach: mvEach,
                        billableTotal: 0, amount: 0, source: 'Personal Inventory', destination: 'Faction Armory',
                        personName: state.settings.playerName, personId: state.settings.playerId,
                        notes: 'API-confirmed return of faction-owned inventory to faction armory. No reimbursement created.',
                        ownership: 'FACTION', status: 'RETURNED', detectionMethod: 'API_FACTION_ARMORY_RETURN',
                        factionId: String(data.faction), factionMovementKey: key,
                        apiLogIds: [logId(log)].filter(Boolean), createdAt: new Date().toISOString()
                    };
                    state.transactions.push(returned);
                    allocateFactionLotSlice(factionSource, returned, qty, 'FACTION_RETURN');
                    changed = true;
                    return;
                }
                state.transactions.push({
                    id: uid('TX'), chainId: uid('CHAIN'), parentId: null,
                    type: 'ARMORY_IN',
                    timestamp: log.timestamp ? new Date(Number(log.timestamp) * 1000).toISOString() : new Date().toISOString(),
                    itemName: item ? item.name : ('Item #' + itemId), itemId: itemId, qty: qty,
                    actualTotal: 0, mvTotal: mvTotal, mvEach: mvEach,
                    billableTotal: mvTotal, amount: mvTotal,
                    source: 'Personal Inventory', destination: 'Faction Armory',
                    personName: state.settings.playerName, personId: state.settings.playerId,
                    notes: 'API-confirmed personal inventory deposit to faction armory. Full deposited quantity valued at movement-time MV.',
                    ownership: 'PERSONAL_CONTRIBUTION_PENDING_REIMBURSEMENT',
                    status: 'DEPOSITED', detectionMethod: 'API_FACTION_ARMORY_IN',
                    factionId: String(data.faction), factionMovementKey: key,
                    apiLogIds: [logId(log)].filter(Boolean), createdAt: new Date().toISOString()
                });
                changed = true;
            });
        });

        // Observed ARMORY_OUT signature: matching sender/receiver events for the player.
        const parts = (logs || []).map(factionTransferPart).filter(Boolean);
        const groups = new Map();
        parts.forEach(function (part) {
            part.rows.forEach(function (row) {
                const key = movementKey(part, row);
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push({ part: part, row: row });
            });
        });
        groups.forEach(function (entries, baseKey) {
            const senderSide = entries.find(function (x) { return actorId && x.part.sender === actorId; });
            const receiverSide = entries.find(function (x) { return actorId && x.part.receiver === actorId; });
            if (!senderSide || !receiverSide) return;
            const row = senderSide.row;
            const key = 'OUT|' + baseKey;
            if (liveTransactions().some(function (tx) {
                return tx.factionMovementKey === key ||
                    sameMovement(tx, 'ARMORY_OUT', senderSide.part.timestamp, senderSide.part.factionId, row.itemId, row.qty);
            })) return;
            const item = itemCatalog.find(function (x) { return String(x.id) === row.itemId; });
            const mvEach = item ? Math.max(0, Number(item.marketValue || 0)) : 0;
            const mvTotal = mvEach * row.qty;
            state.transactions.push({
                id: uid('TX'), chainId: uid('CHAIN'), parentId: null,
                type: 'ARMORY_OUT',
                timestamp: new Date(senderSide.part.timestamp * 1000).toISOString(),
                itemName: item ? item.name : ('Item #' + row.itemId), itemId: row.itemId, qty: row.qty,
                actualTotal: 0, mvTotal: mvTotal, mvEach: mvEach, billableTotal: 0, amount: 0,
                source: 'Faction Armory', destination: 'Personal Inventory',
                personName: state.settings.playerName, personId: state.settings.playerId,
                notes: 'API-confirmed faction armory withdrawal. Faction-owned asset held by player; purpose pending.',
                ownership: 'FACTION', status: 'PENDING', detectionMethod: 'API_FACTION_ARMORY_OUT',
                factionId: senderSide.part.factionId, factionMovementKey: key,
                apiLogIds: entries.map(function (x) { return x.part.logId; }).filter(Boolean),
                createdAt: new Date().toISOString()
            });
            changed = true;
        });
        return changed;
    }

    function tradeIdFromLog(log) {
        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        if (data.parsed_trade_id != null && String(data.parsed_trade_id).trim()) return String(data.parsed_trade_id).trim();
        const raw = String(data.trade_id || '');
        const m = raw.match(/(?:ID=|ID%3D)(\d+)/i);
        return m ? m[1] : '';
    }

    async function reconcileTradePurchases(logs) {
        const groups = {};
        (logs || []).forEach(function (log) {
            const tradeId = tradeIdFromLog(log);
            if (!tradeId) return;
            const data = log && log.data && typeof log.data === 'object' ? log.data : {};
            if (!groups[tradeId]) groups[tradeId] = { tradeId: tradeId, logs: [], itemParts: [], moneyParts: [], userId: '', description: '' };
            const g = groups[tradeId];
            g.logs.push(log);
            if (data.user != null) g.userId = String(data.user);
            if (data.description) g.description = String(data.description);
            if (Array.isArray(data.items) && data.items.length) g.itemParts.push(log);
            if (data.money != null || data.total != null) g.moneyParts.push(log);
        });

        let catalogReady = itemCatalog.length > 0;
        if (!catalogReady) {
            try { await ensureItemCatalog(false); catalogReady = true; } catch (err) {
                console.warn('[FactionLedgerIQ] Could not resolve Torn item catalog for trade', err);
            }
        }

        let changed = false;
        Object.keys(groups).forEach(function (tradeId) {
            const g = groups[tradeId];
            if (!g.itemParts.length || !g.moneyParts.length) return;
            const itemLog = g.itemParts.slice().sort(function (a,b) { return Number(b.timestamp||0)-Number(a.timestamp||0); })[0];
            const moneyLog = g.moneyParts.slice().sort(function (a,b) { return Number(b.timestamp||0)-Number(a.timestamp||0); })[0];
            const rows = Array.isArray(itemLog.data.items) ? itemLog.data.items : [];
            const paid = Math.max(0, Number(moneyLog.data.money != null ? moneyLog.data.money : moneyLog.data.total || 0));
            if (!paid || !rows.length) return;

            const totalQty = rows.reduce(function (n,row) { return n + Math.max(1,Number(row && (row.qty||row.quantity)||1)); },0);
            rows.forEach(function (row) {
                const itemId = String(row && (row.id || row.item_id) || '').trim();
                const qty = Math.max(1, Number(row && (row.qty || row.quantity) || 1));
                const catalogItem = itemCatalog.find(function (item) { return String(item.id) === itemId; });
                const itemName = catalogItem ? catalogItem.name : '';
                const wl = whitelistMatch(itemName, itemId);
                if (!wl) return;
                if (liveTransactions().some(function (tx) { return tx.type === 'PURCHASE' && tx.tradeId === tradeId && String(tx.itemId||'') === itemId; })) return;

                const actualTotal = totalQty ? Math.round(paid * (qty / totalQty)) : paid;
                const mvEach = catalogItem ? Math.max(0, Number(catalogItem.marketValue || 0)) : 0;
                const mvTotal = mvEach * qty;
                state.transactions.push({
                    id: uid('TX'), chainId: uid('CHAIN'), parentId: null, type: 'PURCHASE',
                    timestamp: itemLog.timestamp ? new Date(Number(itemLog.timestamp)*1000).toISOString() : new Date().toISOString(),
                    itemName: wl.itemName || itemName || ('Item #' + itemId), itemId: wl.itemId || itemId, qty: qty,
                    actualTotal: actualTotal, mvTotal: mvTotal, mvEach: mvEach,
                    billableTotal: billable(actualTotal, mvTotal), amount: actualTotal,
                    source: 'Trade', destination: 'Personal Inventory',
                    personName: state.settings.playerName, personId: state.settings.playerId,
                    notes: 'API-confirmed trade purchase. Trade ID: ' + tradeId + '. Counterparty ID: ' + (g.userId || 'unknown') +
                        (g.description ? '. Description: ' + g.description : '') + '. Purchase-time MV frozen at ' + money(mvTotal) + '.',
                    ownership: 'PERSONAL', status: 'PENDING', detectionMethod: 'API_TRADE_PURCHASE',
                    tradeId: tradeId, counterpartyId: g.userId, apiLogIds: g.logs.map(logId).filter(Boolean),
                    createdAt: new Date().toISOString()
                });
                changed = true;
            });
            if (changed) g.logs.forEach(function (log) { markLogProcessed(logId(log)); });
        });
        if (changed) { state.detection.lastDetectedAt = new Date().toISOString(); state.detection.lastSource = 'Torn API · Trade'; }
        return changed;
    }

    async function reconcileObservedBazaarPurchases(logs) {
        let catalogReady = itemCatalog.length > 0;
        if (!catalogReady) {
            try { await ensureItemCatalog(false); catalogReady = true; } catch (err) {
                console.warn('[FactionLedgerIQ] Could not resolve Torn item catalog for Bazaar', err);
            }
        }
        let changed = false;
        for (const log of (logs || [])) {
            const data = log && log.data && typeof log.data === 'object' ? log.data : {};
            if (data.seller == null || data.anonymous != null || !Array.isArray(data.items) || !data.items.length) continue;
            if (data.cost_total == null && data.cost_each == null) continue;
            const id = logId(log);
            const totalLogCost = Math.max(0, Number(data.cost_total || 0));
            const costEach = Math.max(0, Number(data.cost_each || 0));
            const totalQty = data.items.reduce(function (n,row) { return n + Math.max(1,Number(row && (row.qty||row.quantity)||1)); },0);

            for (const row of data.items) {
                const itemId = String(row && (row.id || row.item_id) || '').trim();
                const qty = Math.max(1, Number(row && (row.qty || row.quantity) || 1));
                const catalogItem = itemCatalog.find(function (item) { return String(item.id) === itemId; });
                const itemName = catalogItem ? catalogItem.name : '';
                const wl = whitelistMatch(itemName, itemId);
                if (!wl) continue;

                let tx = liveTransactions().find(function (x) {
                    return x.type === 'PURCHASE' && x.apiLogId === id && String(x.itemId||'') === itemId && Number(x.qty||0) === qty;
                });
                if (tx) {
                    if (tx.source !== 'Bazaar' || tx.detectionMethod !== 'API_BAZAAR_PURCHASE') {
                        tx.source = 'Bazaar'; tx.detectionMethod = 'API_BAZAAR_PURCHASE';
                        tx.notes = 'API-confirmed Bazaar purchase. Seller ID: ' + String(data.seller) +
                            '. Purchase-time MV frozen at ' + money(tx.mvTotal || 0) +
                            (Number(tx.actualTotal||0) > Number(tx.mvTotal||0) && Number(tx.mvTotal||0) > 0 ? '; actual cost was above MV.' : '; billing uses the greater of actual cost or MV.');
                        changed = true;
                    }
                    continue;
                }

                const actualTotal = costEach ? costEach * qty :
                    (totalQty > 0 ? Math.round(totalLogCost * (qty / totalQty)) : totalLogCost);
                const mvEach = catalogItem ? Math.max(0, Number(catalogItem.marketValue || 0)) : 0;
                const mvTotal = mvEach * qty;
                state.transactions.push({
                    id: uid('TX'), chainId: uid('CHAIN'), parentId: null, type: 'PURCHASE',
                    timestamp: log.timestamp ? new Date(Number(log.timestamp)*1000).toISOString() : new Date().toISOString(),
                    itemName: wl.itemName || itemName || ('Item #' + itemId), itemId: wl.itemId || itemId, qty: qty,
                    actualTotal: actualTotal, mvTotal: mvTotal, mvEach: mvEach,
                    billableTotal: billable(actualTotal, mvTotal), amount: actualTotal,
                    source: 'Bazaar', destination: 'Personal Inventory',
                    personName: state.settings.playerName, personId: state.settings.playerId,
                    notes: 'API-confirmed Bazaar purchase. Seller ID: ' + String(data.seller) +
                        '. Purchase-time MV frozen at ' + money(mvTotal) +
                        (actualTotal > mvTotal && mvTotal > 0 ? '; actual cost was above MV.' : '; billing uses the greater of actual cost or MV.'),
                    ownership: 'PERSONAL', status: 'PENDING', detectionMethod: 'API_BAZAAR_PURCHASE',
                    apiLogId: id, sellerId: String(data.seller), costEach: costEach,
                    createdAt: new Date().toISOString()
                });
                changed = true;
            }
            markLogProcessed(id);
        }
        if (changed) { state.detection.lastDetectedAt = new Date().toISOString(); state.detection.lastSource = 'Torn API · Bazaar'; }
        return changed;
    }

    function repairObservedBazaarSources(logs) {
        let changed = false;
        (logs || []).forEach(function (log) {
            const data = log && log.data && typeof log.data === 'object' ? log.data : {};
            if (data.seller == null || data.anonymous != null || !Array.isArray(data.items) || !data.items.length) return;
            if (data.cost_total == null && data.cost_each == null) return;
            const id = logId(log);
            data.items.forEach(function (row) {
                const itemId = String(row && (row.id || row.item_id) || '').trim();
                const qty = Math.max(1, Number(row && (row.qty || row.quantity) || 1));
                const tx = liveTransactions().find(function (x) {
                    return x.type === 'PURCHASE' && x.apiLogId === id && String(x.itemId||'') === itemId && Number(x.qty||0) === qty;
                });
                if (tx && tx.source !== 'Bazaar') {
                    tx.source = 'Bazaar';
                    tx.detectionMethod = 'API_BAZAAR_PURCHASE';
                    tx.notes = 'API-confirmed Bazaar purchase. Seller ID: ' + String(data.seller) +
                        '. Purchase-time MV frozen at ' + money(tx.mvTotal || 0) +
                        (Number(tx.actualTotal||0) > Number(tx.mvTotal||0) && Number(tx.mvTotal||0) > 0 ? '; actual cost was above MV.' : '; billing uses the greater of actual cost or MV.');
                    changed = true;
                }
            });
        });
        return changed;
    }

    async function reconcileApiPurchase(log) {
        const id = logId(log);
        if (!id || isLogProcessed(id)) return false;

        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        const items = Array.isArray(data.items) ? data.items : [];

        // Confirmed Item Market BUY signature includes seller. Confirmed SELL signature
        // includes buyer and fee. Never let a sale create a reimbursement purchase.
        if (data.buyer != null || data.fee != null) return false;
        if (data.seller == null) return false;
        if (!items.length || (data.cost_total == null && data.cost_each == null)) return false;

        let catalogReady = itemCatalog.length > 0;
        if (!catalogReady) {
            try {
                await ensureItemCatalog(false);
                catalogReady = true;
            } catch (err) {
                console.warn('[FactionLedgerIQ] Could not resolve Torn item catalog', err);
            }
        }

        let recorded = false;
        const totalLogCost = Math.max(0, Number(data.cost_total || 0));
        const costEach = Math.max(0, Number(data.cost_each || 0));
        const totalQty = items.reduce(function (sum, row) {
            return sum + Math.max(1, Number(row && (row.qty || row.quantity) || 1));
        }, 0);

        items.forEach(function (row) {
            if (!row || typeof row !== 'object') return;
            const itemId = String(row.id || row.item_id || '').trim();
            const qty = Math.max(1, Number(row.qty || row.quantity || 1));
            const catalogItem = itemCatalog.find(function (item) { return String(item.id) === itemId; });
            const itemName = catalogItem ? catalogItem.name : '';
            const wl = whitelistMatch(itemName, itemId);
            if (!wl) return;

            let actualTotal = costEach ? costEach * qty : 0;
            if (!actualTotal && totalLogCost) {
                actualTotal = totalQty > 0 ? Math.round(totalLogCost * (qty / totalQty)) : totalLogCost;
            }
            const mvEach = catalogItem ? Math.max(0, Number(catalogItem.marketValue || 0)) : 0;
            const mvTotal = mvEach * qty;
            const billedTotal = billable(actualTotal, mvTotal);

            const duplicate = liveTransactions().find(function (tx) {
                return tx.type === 'PURCHASE' && tx.apiLogId === id &&
                    String(tx.itemId || '') === itemId;
            });
            if (duplicate) return;

            const capture = recentClickCaptures.slice().reverse().find(function (c) {
                return Date.now() - c.at < 120000 &&
                    (!c.itemId || String(c.itemId) === itemId ||
                        !c.itemName || !itemName ||
                        normalizeItemName(c.itemName).includes(normalizeItemName(itemName)) ||
                        normalizeItemName(itemName).includes(normalizeItemName(c.itemName)));
            }) || null;

            state.transactions.push({
                id: uid('TX'),
                chainId: uid('CHAIN'),
                parentId: null,
                type: 'PURCHASE',
                timestamp: log.timestamp ? new Date(Number(log.timestamp) * 1000).toISOString() : new Date().toISOString(),
                itemName: wl.itemName || itemName || ('Item #' + itemId),
                itemId: wl.itemId || itemId,
                qty: qty,
                actualTotal: actualTotal,
                mvTotal: mvTotal,
                mvEach: mvEach,
                billableTotal: billedTotal,
                amount: actualTotal,
                source: data.anonymous == null ? 'Bazaar' : 'Item Market',
                destination: 'Personal Inventory',
                personName: state.settings.playerName,
                personId: state.settings.playerId,
                notes: 'API-confirmed ' + (data.anonymous == null ? 'Bazaar' : 'Item Market') + ' purchase. Seller ID: ' +
                    String(data.seller == null ? 'unknown' : data.seller) +
                    '. Purchase-time MV frozen at ' + money(mvTotal) + (actualTotal > mvTotal && mvTotal > 0 ? '; actual cost was above MV.' : '; billing uses the greater of actual cost or MV.'),
                ownership: 'PERSONAL',
                status: 'PENDING',
                detectionMethod: data.anonymous == null ? 'API_BAZAAR_PURCHASE' : 'API_CONFIRMED',
                apiLogId: id,
                sellerId: data.seller == null ? '' : String(data.seller),
                costEach: costEach,
                createdAt: new Date().toISOString()
            });
            recorded = true;
        });

        // Only mark the log processed once it is understood. Whitelisted purchases are
        // recorded; non-whitelisted purchases can be safely ignored after inspection.
        markLogProcessed(id);
        if (recorded) {
            state.detection.lastDetectedAt = new Date().toISOString();
            state.detection.lastSource = data.anonymous == null ? 'Torn API · Bazaar' : 'Torn API · Item Market';
        }
        return recorded;
    }

    function itemMarketSalePart(log) {
        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        const rows = Array.isArray(data.items) ? data.items : [];
        if (!rows.length || data.buyer == null || data.cost_total == null) return null;
        return {
            logId: logId(log),
            timestamp: Number(log.timestamp || 0),
            buyerId: String(data.buyer),
            netTotal: Math.max(0, Number(data.cost_total || 0)),
            fee: Math.max(0, Number(data.fee || 0)),
            priceEach: Math.max(0, Number(data.cost_each || data.price || 0)),
            rows: rows.map(function (row) {
                return {
                    itemId: String(row && (row.id || row.item_id) || '').trim(),
                    qty: Math.max(1, Number(row && (row.qty || row.quantity) || 1))
                };
            }).filter(function (row) { return row.itemId; })
        };
    }

    function voidFalsePurchasesForSale(part, row) {
        let changed = false;
        state.transactions.forEach(function (tx) {
            if (!tx || tx.type !== 'PURCHASE' || tx.status === 'VOID') return;
            if (String(tx.itemId || '') !== row.itemId || Number(tx.qty || 0) !== row.qty) return;
            const txMs = new Date(tx.timestamp).getTime();
            const saleMs = part.timestamp * 1000;
            if (!Number.isFinite(txMs) || Math.abs(txMs - saleMs) > 2000) return;
            // v0.4.3 could misclassify the sale itself as an API-confirmed purchase.
            if (String(tx.detectionMethod || '') !== 'API_CONFIRMED') return;
            tx.status = 'VOID';
            tx.voidReason = 'Automatically corrected: Item Market sale was previously misclassified as a purchase.';
            tx.voidedAt = new Date().toISOString();
            tx.correctedByApiLogId = part.logId;
            changed = true;
        });
        return changed;
    }

    function reconcileItemMarketSales(logs) {
        let changed = false;
        const sales = (logs || []).map(itemMarketSalePart).filter(Boolean)
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        sales.forEach(function (part) {
            part.rows.forEach(function (row) {
                if (voidFalsePurchasesForSale(part, row)) changed = true;

                const already = liveTransactions().some(function (tx) {
                    return tx.type === 'SALE' && tx.saleApiLogId === part.logId &&
                        String(tx.itemId || '') === row.itemId && Number(tx.qty || 0) === row.qty;
                });
                if (already) return;

                const saleMs = part.timestamp * 1000;
                const match = liveTransactions().filter(function (tx) {
                    if (tx.type !== 'ARMORY_OUT' || tx.ownership !== 'FACTION') return false;
                    if (tx.status !== 'PENDING' && tx.status !== 'HELD') return false;
                    if (String(tx.itemId || '') !== row.itemId) return false;
                    const lot = lotForSource(tx.id) || ensureSourceLot(tx);
                    if (!lot || Number(lot.qtyRemaining || 0) < row.qty) return false;
                    const outMs = new Date(tx.timestamp).getTime();
                    return Number.isFinite(outMs) && outMs <= saleMs && saleMs - outMs <= 24 * 60 * 60 * 1000;
                }).sort(function (a, b) {
                    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                })[0];

                if (!match) return;

                const grossTotal = part.netTotal + part.fee;
                const saleLot = lotForSource(match.id) || ensureSourceLot(match);
                match.status = (saleLot && Number(saleLot.qtyRemaining || 0) > row.qty) ? 'HELD' : 'SOLD';
                match.notes = [match.notes, 'API-confirmed Item Market sale; faction ownership converted to sale proceeds.']
                    .filter(Boolean).join(' | ');
                match.saleApiLogId = part.logId;
                match.apiLogIds = Array.from(new Set([].concat(match.apiLogIds || [], [part.logId]).filter(Boolean)));

                state.transactions.push({
                    id: uid('TX'),
                    chainId: match.chainId || match.id,
                    parentId: match.id,
                    type: 'SALE',
                    timestamp: part.timestamp ? new Date(part.timestamp * 1000).toISOString() : new Date().toISOString(),
                    itemName: match.itemName,
                    itemId: match.itemId,
                    qty: row.qty,
                    actualTotal: part.netTotal,
                    grossTotal: grossTotal,
                    fee: part.fee,
                    priceEach: part.priceEach,
                    mvTotal: Number(match.mvTotal || 0),
                    billableTotal: 0,
                    amount: part.netTotal,
                    source: 'Personal Inventory',
                    destination: 'Item Market',
                    personName: state.settings.playerName,
                    personId: state.settings.playerId,
                    buyerId: part.buyerId,
                    notes: 'Automatically reconciled faction-owned Item Market sale. Net proceeds owed to faction: ' +
                        money(part.netTotal) + '; market fee: ' + money(part.fee) + '.',
                    ownership: 'FACTION_PROCEEDS',
                    status: 'SOLD',
                    detectionMethod: 'API_ITEM_MARKET_SALE_RECONCILED',
                    saleApiLogId: part.logId,
                    apiLogIds: [part.logId],
                    createdAt: new Date().toISOString()
                });
                const createdSale = state.transactions[state.transactions.length - 1];
                allocateFactionLotSlice(match, createdSale, row.qty, 'FACTION_SALE');
                changed = true;
            });
        });
        return changed;
    }


    function personLabel(name, id) {
        const n = String(name || '').trim();
        const i = String(id || '').trim();
        return n ? (n + (i ? ' [' + i + ']' : '')) : (i ? ('Player [' + i + ']') : '');
    }

    function cachedPlayerName(id) {
        const key = String(id || '').trim();
        return key && state.people && state.people[key] ? String(state.people[key].name || '') : '';
    }

    async function resolvePlayerName(id) {
        const key = String(id || '').trim();
        if (!key) return '';
        const cached = cachedPlayerName(key);
        if (cached) return cached;
        try {
            const data = await apiFetch('user/' + encodeURIComponent(key) + '/profile', {});
            const root = data && (data.profile || data);
            const name = String(root && (root.name || root.player_name || root.username) || '').trim();
            if (name) {
                state.people = state.people || {};
                state.people[key] = { name: name, resolvedAt: new Date().toISOString() };
                return name;
            }
        } catch (err) {
            console.warn('[FactionLedgerIQ] Player-name lookup failed for ' + key, err);
        }
        return '';
    }

    function factionCollectionPart(log) {
        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        if (data.user == null || data.faction == null ||
            data.balance_before == null || data.balance_after == null) return null;
        const before = Number(data.balance_before);
        const after = Number(data.balance_after);
        if (!Number.isFinite(before) || !Number.isFinite(after) || before <= after) return null;
        return {
            logId: logId(log),
            timestamp: Number(log.timestamp || 0),
            factionId: String(data.faction),
            collectorId: String(data.user),
            balanceBefore: before,
            balanceAfter: after,
            amount: before - after
        };
    }

    async function reconcileFactionCollections(logs) {
        let changed = false;
        const parts = (logs || []).map(factionCollectionPart).filter(Boolean)
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        for (const part of parts) {
            if (!part.logId || !(part.amount > 0)) continue;
            const already = liveTransactions().some(function (tx) {
                return tx.type === 'FACTION_COLLECTION' &&
                    (tx.collectionApiLogId === part.logId ||
                     (Array.isArray(tx.apiLogIds) && tx.apiLogIds.includes(part.logId)));
            });
            if (already) continue;

            const candidates = liveTransactions().filter(function (sale) {
                if (sale.type !== 'SALE') return false;
                const b = saleOutstanding(sale);
                if (!b || b.ready !== part.amount) return false;
                const saleMs = new Date(sale.timestamp).getTime();
                const eventMs = part.timestamp * 1000;
                return Number.isFinite(saleMs) && saleMs <= eventMs &&
                    eventMs - saleMs <= 7 * 24 * 60 * 60 * 1000;
            });
            if (candidates.length !== 1) continue;

            const sale = candidates[0];
            const collectorName = await resolvePlayerName(part.collectorId);
            const child = addChild(sale, 'FACTION_COLLECTION', {
                timestamp: part.timestamp ? new Date(part.timestamp * 1000).toISOString() : new Date().toISOString(),
                itemName: sale.itemName,
                itemId: sale.itemId,
                qty: sale.qty,
                amount: part.amount,
                actualTotal: part.amount,
                source: 'Faction Balance',
                destination: 'Faction',
                ownership: 'FACTION',
                status: 'SETTLED',
                personName: collectorName,
                personId: part.collectorId,
                collectedByName: collectorName,
                collectedById: part.collectorId,
                detectionMethod: 'API_FACTION_COLLECTION',
                collectionApiLogId: part.logId,
                apiLogIds: [part.logId],
                factionId: part.factionId,
                balanceBefore: part.balanceBefore,
                balanceAfter: part.balanceAfter,
                notes: 'API-confirmed faction collection of ' + money(part.amount) + ' by ' +
                    personLabel(collectorName, part.collectorId) + '. Linked sale-proceeds chain is settled.'
            });
            child.collectionApiLogId = part.logId;
            state.detection.lastDetectedAt = new Date().toISOString();
            state.detection.lastSource = 'Torn API · Faction Collection';
            changed = true;
        }
        return changed;
    }

    function factionMoneyDepositPart(log) {
        const data = log && log.data && typeof log.data === 'object' ? log.data : {};
        const amount = Number(data.money_deposited || 0);
        if (!(amount > 0) || data.faction == null) return null;
        return {
            logId: logId(log),
            timestamp: Number(log.timestamp || 0),
            factionId: String(data.faction),
            amount: amount
        };
    }

    function reconcileFactionMoneyDeposits(logs) {
        let changed = false;
        const deposits = (logs || []).map(factionMoneyDepositPart).filter(Boolean)
            .sort(function (a, b) { return a.timestamp - b.timestamp; });

        deposits.forEach(function (part) {
            if (!part.logId) return;
            const already = liveTransactions().some(function (tx) {
                return tx.type === 'FACTION_BALANCE_IN' &&
                    (tx.depositApiLogId === part.logId ||
                     (Array.isArray(tx.apiLogIds) && tx.apiLogIds.includes(part.logId)));
            });
            if (already) return;

            const candidates = liveTransactions().filter(function (sale) {
                if (sale.type !== 'SALE') return false;
                const b = saleOutstanding(sale);
                if (!b || b.owed !== part.amount) return false;
                const saleMs = new Date(sale.timestamp).getTime();
                const depositMs = part.timestamp * 1000;
                return Number.isFinite(saleMs) && saleMs <= depositMs &&
                    depositMs - saleMs <= 7 * 24 * 60 * 60 * 1000;
            }).sort(function (a, b) {
                return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            });

            // Exact amount + chronology is intentionally strict. If ambiguous, leave it
            // unresolved rather than assigning faction money to the wrong sale.
            if (candidates.length !== 1) return;
            const sale = candidates[0];
            const child = addChild(sale, 'FACTION_BALANCE_IN', {
                timestamp: part.timestamp ? new Date(part.timestamp * 1000).toISOString() : new Date().toISOString(),
                itemName: sale.itemName,
                itemId: sale.itemId,
                qty: sale.qty,
                amount: part.amount,
                actualTotal: part.amount,
                source: 'Personal Wallet',
                destination: 'Faction Balance',
                ownership: 'FACTION_PROCEEDS',
                status: 'READY_FOR_COLLECTION',
                detectionMethod: 'API_FACTION_MONEY_DEPOSIT',
                depositApiLogId: part.logId,
                apiLogIds: [part.logId],
                factionId: part.factionId,
                notes: 'API-confirmed faction money deposit matched to outstanding sale proceeds. Player obligation settled; funds are ready for faction collection.'
            });
            child.depositApiLogId = part.logId;
            state.detection.lastDetectedAt = new Date().toISOString();
            state.detection.lastSource = 'Torn API · Faction Money Deposit';
            changed = true;
        });
        return changed;
    }

    function factionBalanceMemberMoney(data) {
        const root = data && (data.balance || data);
        const members = root && Array.isArray(root.members) ? root.members : [];
        const playerId = String(state.settings.playerId || '').trim();
        if (!playerId) return null;
        const member = members.find(function (m) {
            return String(m && (m.id || m.user_id || m.player_id) || '') === playerId;
        });
        if (!member) return null;
        const value = Number(member.money);
        return Number.isFinite(value) ? value : null;
    }

    function saleOutstanding(tx) {
        if (!tx || tx.type !== 'SALE' || tx.status === 'VOID') return 0;
        const deposited = childrenOf(tx.id, 'FACTION_BALANCE_IN').reduce(function (sum, r) {
            return sum + Number(r.amount || 0);
        }, 0);
        const collected = childrenOf(tx.id, 'FACTION_COLLECTION').reduce(function (sum, r) {
            return sum + Number(r.amount || 0);
        }, 0);
        return {
            owed: Math.max(0, Number(tx.amount || tx.actualTotal || 0) - deposited - collected),
            ready: Math.max(0, deposited - collected)
        };
    }

    function recordBalanceDeposit(sale, amount, balanceNow) {
        const child = addChild(sale, 'FACTION_BALANCE_IN', {
            timestamp: new Date().toISOString(),
            itemName: sale.itemName,
            itemId: sale.itemId,
            qty: sale.qty,
            amount: amount,
            actualTotal: amount,
            source: 'Personal Wallet',
            destination: 'Faction Balance',
            ownership: 'FACTION_PROCEEDS',
            status: 'READY_FOR_COLLECTION',
            detectionMethod: 'API_FACTION_BALANCE_DELTA',
            notes: 'Faction member balance increased by ' + money(amount) +
                '; matched automatically to sale proceeds. Balance after deposit: ' + money(balanceNow) + '.'
        });
        child.balanceAfter = balanceNow;
        return child;
    }

    function recordFactionCollection(sale, amount, balanceNow) {
        const child = addChild(sale, 'FACTION_COLLECTION', {
            timestamp: new Date().toISOString(),
            itemName: sale.itemName,
            itemId: sale.itemId,
            qty: sale.qty,
            amount: amount,
            actualTotal: amount,
            source: 'Faction Member Balance',
            destination: 'Faction',
            ownership: 'FACTION',
            status: 'COLLECTED',
            detectionMethod: 'API_FACTION_BALANCE_DELTA',
            notes: 'Faction member balance decreased by ' + money(amount) +
                '; matched automatically to sale proceeds previously ready for collection. Balance after collection: ' + money(balanceNow) + '.'
        });
        child.balanceAfter = balanceNow;
        return child;
    }

    async function reconcileFactionBalance() {
        let data;
        try {
            data = await apiFetch('faction/balance', { cat: 'current' });
        } catch (err) {
            // Balance permission is optional. User-log tracking continues normally when unavailable.
            return false;
        }

        const current = factionBalanceMemberMoney(data);
        if (current == null) return false;

        const previous = state.detection.factionBalanceSnapshot;
        state.detection.factionBalanceSnapshot = {
            money: current,
            at: new Date().toISOString()
        };

        if (!previous || !Number.isFinite(Number(previous.money))) return false;
        const delta = current - Number(previous.money);
        if (!delta) return false;

        const sales = liveTransactions().filter(function (tx) { return tx.type === 'SALE'; })
            .sort(function (a, b) { return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(); });

        if (delta > 0) {
            const exact = sales.find(function (sale) {
                const b = saleOutstanding(sale);
                return b && b.owed === delta;
            });
            if (!exact) return false;
            recordBalanceDeposit(exact, delta, current);
            state.detection.lastDetectedAt = new Date().toISOString();
            state.detection.lastSource = 'Torn API · Faction Balance';
            return true;
        }

        const decrease = Math.abs(delta);
        const exactReady = sales.find(function (sale) {
            const b = saleOutstanding(sale);
            return b && b.ready === decrease;
        });
        if (!exactReady) return false;
        recordFactionCollection(exactReady, decrease, current);
        state.detection.lastDetectedAt = new Date().toISOString();
        state.detection.lastSource = 'Torn API · Faction Balance';
        return true;
    }

    async function pollApiLogs(showToast) {
        if (apiPollBusy || !state.settings.apiPolling || !apiKeyValue()) return;
        apiPollBusy = true;
        try {
            // Always request Torn's latest log page. Polling with a moving from/to window
            // can intermittently return an empty/cached historical page even while new logs
            // are visible in Torn. Persistent log-ID dedup makes re-reading the latest page safe.
            let data = await apiFetch('user/log', { limit: '100' });
            let logs = logArray(data);

            // Defensive recovery: if the latest-page request is unexpectedly empty, retry once
            // with a six-hour bounded window. Do not erase previously captured diagnostics.
            if (!logs.length) {
                const now = Math.floor(Date.now() / 1000);
                const from = now - (6 * 60 * 60);
                data = await apiFetch('user/log', { from: String(from), to: String(now), limit: '100' });
                logs = logArray(data);
            }
            rememberApiEvents(logs);
            let changed = false;
            logs.forEach(function (log) { rememberFactionCandidate(log); });
            if (suppressDuplicateArmoryOuts()) changed = true;
            if (reconcileLegacyPurchaseDuplicates()) changed = true;
            if (await reconcileFactionMovement(logs)) changed = true;
            if (reconcilePurchasesToArmoryDeposits()) changed = true;
            if (reconcileDisplayCaseDeposits(logs)) changed = true;
            if (reconcileDisplayCaseWithdrawals(logs)) changed = true;
            if (reconcileOwnershipLots()) changed = true;
            // Bazaar recovery must also inspect the persisted diagnostic cache. Torn's latest
            // 100-log page can advance past a purchase before a newer script version gets a
            // chance to reconcile it; recentApiEvents retains the authoritative sanitized log.
            const bazaarRecoveryLogs = [];
            const bazaarSeen = new Set();
            logs.concat(Array.isArray(state.detection.recentApiEvents) ? state.detection.recentApiEvents : []).forEach(function (ev) {
                const key = logId(ev) || [ev && ev.timestamp, JSON.stringify(ev && ev.data || {})].join('|');
                if (!key || bazaarSeen.has(key)) return;
                bazaarSeen.add(key);
                bazaarRecoveryLogs.push(ev);
            });
            if (repairObservedBazaarSources(bazaarRecoveryLogs)) changed = true;
            if (await reconcileObservedBazaarPurchases(bazaarRecoveryLogs)) changed = true;
            if (await reconcileTradePurchases(logs)) changed = true;
            if (reconcileItemMarketSales(logs)) changed = true;
            if (reconcileFactionMoneyDeposits(logs)) changed = true;
            if (await reconcileFactionCollections(logs)) changed = true;
            if (await reconcileFactionBalance()) changed = true;
            for (const log of logs) {
                if (await reconcileApiPurchase(log)) changed = true;
            }
            state.detection.lastApiPollAt = new Date().toISOString();
            state.detection.lastApiError = '';
            state.detection.apiStatus = 'Connected';
            if (changed) {
                // Persist and refresh silently during background polling. Reconciliation can
                // legitimately update bookkeeping metadata on successive passes; that should
                // never spam the user with repeated activity toasts.
                state.updatedAt = new Date().toISOString();
                localStorage.setItem(STATE_KEY, JSON.stringify(state));
                // Do not rebuild an open panel during background polling. Replacing the body
                // collapses diagnostics and interrupts scrolling/taps on TornPDA.
                if (showToast) {
                    render();
                    toast('API connected · ledger reconciled');
                } else {
                    updateApiStatusDom();
                }
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
            updateApiStatusDom();
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

    function normalizeItemCatalog(data) {
        const source = data && (data.items || data);
        const out = [];
        if (Array.isArray(source)) {
            source.forEach(function (item) {
                if (!item) return;
                const id = String(item.id || item.item_id || '').trim();
                const name = String(item.name || item.item_name || '').trim();
                if (id && name) out.push({ id: id, name: name, marketValue: Number(item.market_value || item.marketValue || (item.value && (item.value.market_price || item.value.market_value)) || 0) || 0 });
            });
        } else if (source && typeof source === 'object') {
            Object.keys(source).forEach(function (key) {
                const item = source[key];
                if (!item || typeof item !== 'object') return;
                const id = String(item.id || item.item_id || key || '').trim();
                const name = String(item.name || item.item_name || '').trim();
                if (id && name) out.push({ id: id, name: name, marketValue: Number(item.market_value || item.marketValue || (item.value && (item.value.market_price || item.value.market_value)) || 0) || 0 });
            });
        }
        return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    async function ensureItemCatalog(force) {
        if (!force && itemCatalog.length && Date.now() - itemCatalogLoadedAt < 3600000) return itemCatalog;
        const data = await apiFetch('torn/items', { cat: 'All' });
        const parsed = normalizeItemCatalog(data);
        if (!parsed.length) throw new Error('No items returned by Torn API');
        itemCatalog = parsed;
        itemCatalogLoadedAt = Date.now();
        return itemCatalog;
    }

    function renderItemSuggestions(input) {
        const wrap = input && input.closest('.fliq-item-search');
        const list = wrap && wrap.querySelector('.fliq-suggestions');
        if (!list) return;
        const q = normalizeItemName(input.value);
        if (q.length < 2) {
            list.innerHTML = '';
            list.classList.remove('fliq-suggestions-open');
            return;
        }
        const matches = itemCatalog.filter(function (item) {
            return normalizeItemName(item.name).includes(q);
        }).slice(0, 12);
        list.innerHTML = matches.length ? matches.map(function (item) {
            return '<button type="button" class="fliq-suggestion" data-fliq="pick-item" data-item-id="' +
                esc(item.id) + '" data-item-name="' + esc(item.name) + '"><span>' +
                esc(item.name) + '</span><small>#' + esc(item.id) + '</small></button>';
        }).join('') : '<div class="fliq-suggestion-empty">No matching Torn items</div>';
        list.classList.add('fliq-suggestions-open');
    }

    async function handleItemSearchInput(input) {
        clearTimeout(itemSearchTimer);
        itemSearchTimer = setTimeout(async function () {
            try {
                if (normalizeItemName(input.value).length >= 2 && !itemCatalog.length) {
                    await ensureItemCatalog(false);
                }
                if (document.body.contains(input)) renderItemSuggestions(input);
            } catch (err) {
                const wrap = input.closest('.fliq-item-search');
                const list = wrap && wrap.querySelector('.fliq-suggestions');
                if (list) {
                    list.innerHTML = '<div class="fliq-suggestion-empty">Could not load Torn item list. Check API key permissions.</div>';
                    list.classList.add('fliq-suggestions-open');
                }
            }
        }, 180);
    }

    function itemSearchControl() {
        return '<div class="fliq-item-search">' +
            '<input name="itemSearch" class="fliq-item-search-input" autocomplete="off" placeholder="Type 2+ letters, e.g. emp" required>' +
            '<input name="itemName" type="hidden"><input name="itemId" type="hidden">' +
            '<div class="fliq-suggestions"></div>' +
        '</div>';
    }

    function updateApiStatusDom() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        const el = panel.querySelector('[data-fliq-api-status]');
        if (!el) return;
        el.innerHTML = 'API status: ' + esc(state.detection.apiStatus || 'Not configured') +
            (state.detection.lastApiPollAt ? ' · Last check ' + esc(new Date(state.detection.lastApiPollAt).toLocaleTimeString()) : '') +
            (state.detection.lastApiError ? '<br>Error: ' + esc(state.detection.lastApiError) : '');
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

            if (tx.type === 'ARMORY_IN' &&
                (tx.ownership === 'PERSONAL_CONTRIBUTION_PENDING_REIMBURSEMENT' ||
                 tx.ownership === 'PERSONAL_PURCHASE_PENDING_REIMBURSEMENT')) {
                const refunded = childrenOf(tx.id, 'REFUND').reduce(function (sum, r) {
                    return sum + Number(r.amount || r.actualTotal || 0);
                }, 0);
                if (!tx.purchaseAllocationId) {
                    factionOwesMe += Math.max(0, Number(tx.billableTotal || tx.mvTotal || 0) - refunded);
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
                const lot = lotForSource(tx.id) || ensureSourceLot(tx);
                const originalQty = Math.max(1, Number(tx.qty || 1));
                const remainingQty = lot ? Number(lot.qtyRemaining || 0) : Number(tx.qty || 0);
                assetsHeld += Math.round(Number(tx.currentValue || tx.mvTotal || 0) / originalQty * remainingQty);
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
            '.fliq-item-search{position:relative}.fliq-suggestions{display:none;position:absolute;z-index:2147483600;left:0;right:0;top:calc(100% + 3px);max-height:260px;overflow:auto;background:#0f151c;border:1px solid #42505f;border-radius:7px;box-shadow:0 8px 22px #0009}',
            '.fliq-suggestions.fliq-suggestions-open{display:block}.fliq-suggestion{width:100%;display:flex;justify-content:space-between;gap:8px;text-align:left;border:0;border-bottom:1px solid #2c3946;background:#0f151c;color:#fff;padding:10px}.fliq-suggestion:last-child{border-bottom:0}.fliq-suggestion small{opacity:.55}.fliq-suggestion-empty{padding:10px;opacity:.65;font-size:12px}',
            '.fliq-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}',
            '.fliq-btn{cursor:pointer}.fliq-btn-primary{background:#315b86}.fliq-btn-danger{background:#69363b}',
            '.fliq-list{display:flex;flex-direction:column;gap:7px}.fliq-item-top{display:flex;justify-content:space-between;gap:8px}',
            '.fliq-pill{display:inline-block;padding:2px 6px;border-radius:999px;background:#293746;font-size:10px}',
            '.fliq-empty{text-align:center;padding:24px 10px;opacity:.55}',
            '.fliq-diag{white-space:pre-wrap;word-break:break-word;font:11px monospace;max-height:280px;overflow:auto;background:#0f151c;border-radius:6px;padding:8px;margin:8px 0 0}',
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
        panel.addEventListener('input', function (e) {
            if (e.target && e.target.classList.contains('fliq-item-search-input')) handleItemSearchInput(e.target);
        });
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
                '<div class="fliq-muted" style="margin-top:6px">v0.4.6 adds authoritative money_deposited log reconciliation for sale proceeds, while retaining faction-balance fallback, movement deduplication, and reimbursement tracking.</div>' +
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
            return ((tx.type === 'PURCHASE' || tx.type === 'ARMORY_OUT') && tx.status === 'PENDING') ||
                (tx.type === 'ARMORY_IN' && tx.status === 'ALLOCATION_REQUIRED');
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
                        field('Search Torn items', itemSearchControl()),
                        field('Selection', '<div class="fliq-muted">Type at least 2 letters, then tap an item.</div>')
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
            tx.type === 'ARMORY_IN' ? 'Reimbursement Due: ' + money(tx.billableTotal || tx.mvTotal) : null,
            tx.type === 'PURCHASE'
                ? 'Pricing Rule: ' + (Number(tx.mvTotal || 0) <= 0
                    ? 'MV unavailable - actual cost used'
                    : (aboveMV ? 'Actual cost used - purchase was above MV' : 'MV used when purchase cost was at or below MV'))
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

        if (pendingActions && tx.type === 'ARMORY_IN' && tx.status === 'ALLOCATION_REQUIRED') {
            const ids = Array.isArray(tx.allocationCandidateIds) ? tx.allocationCandidateIds : [];
            const candidates = ids.map(function (id) { return liveTransactions().find(function (p) { return p.id === id; }); })
                .filter(function (p) { return p && p.type === 'PURCHASE' && p.status === 'PENDING'; });
            actions =
                '<div class="fliq-muted" style="margin-top:8px">Ownership allocation required. Torn does not identify which identical stackable items were deposited. Choose the purchase lot to reimburse:</div>' +
                '<div class="fliq-actions">' +
                candidates.map(function (p) {
                    return '<button class="fliq-btn" data-fliq="allocate-armory-purchase" data-id="' + esc(tx.id) +
                        '" data-purchase-id="' + esc(p.id) + '">' + esc(p.source || 'Purchase') + ' · ' +
                        Number(p.qty || 0).toLocaleString() + ' × ' + esc(p.itemName) + ' · ' +
                        money(p.billableTotal) + '</button>';
                }).join('') +
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
                : (tx.type === 'ARMORY_IN'
                    ? '<div>MV each ' + money(tx.mvEach) + ' · Qty ' + Number(tx.qty || 0).toLocaleString() +
                        ' · Reimbursement <b>' + money(tx.billableTotal || tx.mvTotal) + '</b></div>'
                    : (tx.type === 'SALE'
                        ? '<div>Net proceeds <b>' + money(tx.amount || tx.actualTotal) + '</b>' +
                            (Number(tx.fee || 0) ? ' · Fee ' + money(tx.fee) : '') + '</div>'
                        : (tx.type === 'ARMORY_OUT' && Number(tx.mvTotal || 0)
                            ? '<div>Movement MV ' + money(tx.mvTotal) + ' · Faction-owned</div>'
                            : '')))) +
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

    function renderCatalogDiagnostic() {
        const beer = itemCatalog.find(function (item) { return String(item.id) === '180'; });
        if (!itemCatalog.length) return 'Item catalog not loaded yet.';
        return 'Catalog loaded: ' + itemCatalog.length + ' items' +
            (beer ? ' · Bottle of Beer MV: ' + money(beer.marketValue || 0) : '');
    }

    function renderFactionDiagnostics() {
        const events = Array.isArray(state.detection.recentFactionCandidates) ? state.detection.recentFactionCandidates : [];
        if (!events.length) return '<div class="fliq-empty">No faction armory/display movement candidates captured yet.</div>';
        return '<div class="fliq-list">' + events.map(function (ev, i) {
            return '<div class="fliq-item"><div class="fliq-item-top"><b>Faction Candidate ' + (i + 1) + '</b><span class="fliq-pill">' +
                esc(ev.id || 'no id') + '</span></div><pre class="fliq-diag">' +
                esc(JSON.stringify(ev, null, 2)) + '</pre></div>';
        }).join('') + '</div>';
    }

    function renderApiDiagnostics() {
        const events = Array.isArray(state.detection.recentApiEvents) ? state.detection.recentApiEvents : [];
        if (!events.length) return '<div class="fliq-empty">No recent API events captured yet. Tap Test API first.</div>';
        return '<div class="fliq-list">' + events.map(function (ev, i) {
            return '<div class="fliq-item"><div class="fliq-item-top"><b>Event ' + (i + 1) + '</b><span class="fliq-pill">' +
                esc(ev.id || 'no id') + '</span></div><pre class="fliq-diag">' +
                esc(JSON.stringify(ev, null, 2)) + '</pre></div>';
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
            '<div class="fliq-muted" data-fliq-api-status>API status: ' + esc(state.detection.apiStatus || 'Not configured') +
                (state.detection.lastApiPollAt ? ' · Last check ' + esc(new Date(state.detection.lastApiPollAt).toLocaleTimeString()) : '') +
                (state.detection.lastApiError ? '<br>Error: ' + esc(state.detection.lastApiError) : '') + '</div>' +
            '<div class="fliq-actions"><button class="fliq-btn fliq-btn-primary" type="submit">Save Settings</button><button class="fliq-btn" type="button" data-fliq="create-api-key">Create FactionLedgerIQ API Key</button><button class="fliq-btn" type="button" data-fliq="test-api">Test API</button><button class="fliq-btn" type="button" data-fliq="toggle-api-diagnostics">Show API Diagnostics</button></div>' +
        '</form>' +
        '<div id="fliq-api-diagnostics" class="fliq-section" style="display:none"><h3>Recent API Events</h3><div class="fliq-card fliq-muted" style="margin-bottom:8px">Diagnostic output excludes API keys/tokens. ' + esc(renderCatalogDiagnostic()) + '</div>' + renderApiDiagnostics() + '<h3 style="margin-top:12px">Faction Movement Candidates</h3>' + renderFactionDiagnostics() + '</div>' +
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
            'v' + VERSION + ' performs no Torn game actions. Faction-owned lots now support partial returns and partial Item Market sales without creating false reimbursements; held-asset value follows the remaining faction quantity. Trade and Bazaar sale shapes remain diagnostic-first until observed.' +
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
            const itemId = formValue(fd, 'itemId');
            if (!itemName || !itemId) {
                toast('Choose an item from the Torn item list');
                return;
            }
            if (whitelistMatch(itemName, itemId)) {
                toast('That item is already whitelisted');
                return;
            }

            state.whitelist.push({
                id: uid('WL'),
                itemName: itemName,
                itemId: itemId,
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

        if (action === 'pick-item') {
            const wrap = btn.closest('.fliq-item-search');
            if (!wrap) return;
            const visible = wrap.querySelector('input[name="itemSearch"]');
            const nameInput = wrap.querySelector('input[name="itemName"]');
            const idInput = wrap.querySelector('input[name="itemId"]');
            if (visible) visible.value = btn.dataset.itemName || '';
            if (nameInput) nameInput.value = btn.dataset.itemName || '';
            if (idInput) idInput.value = btn.dataset.itemId || '';
            const list = wrap.querySelector('.fliq-suggestions');
            if (list) {
                list.innerHTML = '';
                list.classList.remove('fliq-suggestions-open');
            }
            if (visible) visible.blur();
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

        if (action === 'allocate-armory-purchase' && tx && tx.type === 'ARMORY_IN') {
            const purchaseId = btn.dataset.purchaseId;
            const purchase = liveTransactions().find(function (p) {
                return p.id === purchaseId && p.type === 'PURCHASE' && p.status === 'PENDING' &&
                    String(p.itemId || '') === String(tx.itemId || '') && Number(p.qty || 0) === Number(tx.qty || 0);
            });
            if (!purchase) { toast('That purchase lot is no longer available'); return; }
            purchase.status = 'DEPOSITED';
            purchase.depositTransactionId = tx.id;
            tx.purchaseAllocationId = purchase.id;
            tx.ownership = 'PERSONAL_PURCHASE_PENDING_REIMBURSEMENT';
            tx.status = 'RECORDED';
            tx.allocationRequired = false;
            tx.billableTotal = Number(purchase.billableTotal || tx.billableTotal || tx.mvTotal || 0);
            tx.actualTotal = Number(purchase.actualTotal || 0);
            tx.mvTotal = Number(purchase.mvTotal || tx.mvTotal || 0);
            tx.mvEach = Number(purchase.mvEach || tx.mvEach || 0);
            tx.notes = [tx.notes, 'User selected purchase ' + purchase.id + ' as the reimbursement lot; frozen purchase pricing retained.']
                .filter(Boolean).join(' | ');
            purchase.notes = [purchase.notes, 'Allocated by user to faction armory deposit ' + tx.id + '.']
                .filter(Boolean).join(' | ');
            ensureAccounting();
            state.accounting.allocations.push({
                id: uid('ALLOC'), kind: 'PURCHASE_TO_ARMORY', purchaseId: purchase.id,
                movementId: tx.id, itemId: tx.itemId, qty: Number(tx.qty || 0),
                billableTotal: tx.billableTotal, createdAt: new Date().toISOString(), status: 'ACTIVE'
            });
            saveState();
            toast('Purchase lot allocated to armory deposit');
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

        if (action === 'create-api-key') {
            window.location.href = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=FactionLedgerIQ&user=log&torn=items&faction=balance';
            return;
        }

        if (action === 'test-api') {
            pollApiLogs(true);
            return;
        }

        if (action === 'toggle-api-diagnostics') {
            const box = document.getElementById('fliq-api-diagnostics');
            if (!box) return;
            const showing = box.style.display !== 'none';
            box.style.display = showing ? 'none' : 'block';
            btn.textContent = showing ? 'Show API Diagnostics' : 'Hide API Diagnostics';
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

    function repairLegacyAllocationPrompts() {
        let changed = false;
        const cutoffMs = Date.now() - (30 * 60 * 1000);
        liveTransactions().forEach(function (tx) {
            if (tx.type !== 'ARMORY_IN' || tx.status !== 'ALLOCATION_REQUIRED') return;
            if (new Date(tx.timestamp).getTime() >= cutoffMs) return;
            tx.status = 'DEPOSITED';
            tx.allocationRequired = false;
            tx.allocationCandidateIds = [];
            tx.notes = [tx.notes, 'v0.6.2 migration: stale allocation prompt cleared; historical transaction retained.']
                .filter(Boolean).join(' | ');
            changed = true;
        });
        if (changed) {
            state.updatedAt = new Date().toISOString();
            localStorage.setItem(STATE_KEY, JSON.stringify(state));
        }
    }

    function init() {
        repairLegacyAllocationPrompts();
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