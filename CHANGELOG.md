# Changelog

All notable FactionLedgerIQ changes will be recorded here.

## 0.2.0 - 2026-09-24

### Added

- Automatic Torn-page purchase confirmation detection for whitelisted items.
- Purchase click context capture for Item Market, Bazaar, City Shop, and Trade pages.
- Persistent purchase fingerprints to reduce duplicate ledger entries.
- Detector on/off setting and last-detection status.
- Auto-created pending purchase records with actual purchase cost when detected.

### In progress

- Purchase-time market-value capture and API/log reconciliation.
- More source-specific confirmation parsers and completed-trade reconciliation.

## 0.1.0 - 2026-09-24

### Added

- Initial TornPDA userscript foundation.
- Docked `L` launcher using Torn's bottom navigation.
- Dashboard accounting summary.
- Manual transaction ledger.
- Item whitelist.
- Purchase billing rule using the higher of actual cost or MV at purchase.
- Pending purchase and armory-withdrawal workflows.
- Display-case inventory ledger.
- Discord-ready transaction receipts.
- Void-with-audit behavior.
- Local JSON backup, download, copy, and import.
- Namespaced storage, DOM IDs, CSS, and observers for script isolation.
