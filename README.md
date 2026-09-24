# FactionLedgerIQ

FactionLedgerIQ is a TornPDA-first userscript for tracking faction-related purchases, faction assets, reimbursements, sale proceeds, display-case movements, and Discord-ready receipts.

## Current version

**v0.1.0**

This foundation release includes:

- Docked `L` launcher in Torn's bottom navigation.
- Dashboard balances for **Faction owes me**, **I owe faction**, **Ready for faction to collect**, and **Faction assets held**.
- Editable whitelist for personally purchased items.
- Manual transaction entry for purchases, armory movements, display-case movements, sales, reimbursements, faction-balance deposits, and collections.
- Purchase billing rule: bill at market value when bought below MV; bill actual cost when bought above MV.
- Discord-ready receipts with transaction IDs and Torn player identity.
- Audit-friendly voiding instead of silent deletion.
- JSON backup/import.
- Separate FactionLedgerIQ IDs, storage keys, observers, and CSS so it can coexist with other Torn scripts.

## Planned next step

Automatic Torn event detection and reconciliation, starting with purchase detection and faction armory movements.

## Data storage

FactionLedgerIQ currently stores its ledger in browser/TornPDA local storage under its own namespaced key.

Back up the ledger regularly from **Settings → Backup & Restore**.

## Safety model

FactionLedgerIQ is designed as a read-only assistant around Torn. It does not submit Torn forms or perform game actions on the player's behalf.

## Installation

For development, install `FactionLedgerIQ.user.js` in TornPDA's userscript manager.

Greasy Fork distribution can be added after the foundation build is tested.
