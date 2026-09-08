# Deferred migrations

These files are intentionally kept OUT of `migrations/` so `npm run migrate`
skips them (the runner only reads files directly inside `migrations/`, not
subdirectories). Move a file back into `migrations/` when it's ready to run,
then run `npm run migrate` again.

- **20260501-add-gsec-amortization-mappings.js** - blocked: requires a
  `chart_of_accounts` row for code `111-101-170-044-44`
  ("Financial Assets at amortised cost"), which does not exist yet on the
  live database. Add that GL account first, then move this file back in.

- **20260610-replicate-account-mappings.js** - blocked: requires an input
  file at `migrations/data/account-mappings-export.json` (produced by
  `scripts/export-account-mappings.js` on a source environment), which
  does not exist in this checkout. Only relevant if/when you actually want
  to replicate account_mappings from another environment into this one.

- **20260618-add-repo-deal-number.js** - parked on request (2026-09-07):
  `repo_deals.deal_number` is already fully populated on live (nothing to
  backfill there), but this migration also rewrites `ledger_entries.deal_number`
  for 150 existing rows (from raw internal repo_deals.id to the formatted
  deal number) and would do the same for any matching `cashflow_transactions`
  rows. That's real UPDATEs against live accounting data, held back
  deliberately pending a decision on when to apply it.
