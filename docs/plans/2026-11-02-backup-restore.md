# Plan: backup and restore, local proof

Item from `docs/progress.md`: "Backup and restore, local proof. Dump the database, restore into a blank one, and check the numbers match, including `i_books_check()`. Follow the plan's section 9. The upload to R2 needs an account later, so stop there."

Plan section 9 (`2026-11-01-power-store-plan.md:255,459`): "Our own encrypted database dump every 6 hours, to Cloudflare R2... A restore must be tested before go-live" — step 1.1's proof is "a backup restores into a blank database and the numbers match".

## Facts and probes, checked today

- **Gleey's pattern, read with the owner's permission** (`eventwebapp\Gleey\sim\db-backup.mjs`): `pg_dump --format=custom --no-owner --no-privileges` to a dated file, Docker postgres:17-alpine as the fallback, `pg_restore --list` to verify, connection never printed. That is the shape the future R2 job will take.
- **Probe 1:** the embedded Postgres ships only `pg_ctl.exe` — no `pg_dump`/`pg_restore`/`psql`. A local proof cannot lean on those binaries, and demanding Docker would break the laptop-only loop.
- **Probe 2:** postgres.js streams `COPY TO STDOUT` and `COPY FROM STDIN` both ways (`sim/probe-copy.mjs`) — Postgres's own reversible text format, no external binaries, exact for bigint/numeric.
- `check.mjs`, `baseline.json`, `make-baseline.mjs` and `stubs.sql` may never be edited, so the proof stands alone as a script the owner runs.

## Design

1. `sim/db-dump.mjs`: walks every user table, streams each one out with `COPY ... TO STDOUT` (explicit column list, stored generated columns excluded), frames it (`T schema table` header, then raw COPY data to its `\.` terminator), adds a manifest with per-table row counts and a SHA-256 of all frames, then encrypts the whole payload with AES-256-GCM (key from `POWER_BACKUP_KEY`, hex, or generated). Writes a dated `.dump.enc` file. Never prints the connection or the key.
2. `sim/db-restore.mjs`: decrypts and verifies the SHA-256, truncates every table, loads frames with `COPY ... FROM STDIN` under `session_replication_role = replica` (skips FK and trigger checks, the same idea as pg_restore), resets identity sequences from the restored data, and returns the manifest. Restore expects a blank database that already has the migrations applied — the real restore path too.
3. `sim/backup-proof.mjs`: starts two embedded Postgres servers, seeds a whole shop day through the real functions on the source (sales, card taps, transfers, returns, refunds, quotes, counts, owner money, till close, expenses), dumps, wipes, restores into the target, and checks: every table's row count matches, ledger account sums match, `i_books_check()` is clean on both, a tampered dump refuses to decrypt, and the restored database takes a new posting (identity sequences fixed). Ends with the dev-clean, like `check.mjs --full` does.

## What the build changed (reality vs this plan)

- **Framing by length, not by COPY's `\.` terminator.** Probed: the postgres.js driver strips `\.` from COPY TO output, so a terminator-based parser reads to end of file. Frames now carry a byte length in the header and parsing is buffer-level — no string round-trips, no ambiguity, and the checksum verifies exact bytes.
- **Truncate must run under `session_replication_role = replica`.** The append-only tables (ledger, audit, stock movements) refuse truncate by trigger; the role switch must come before the truncate, not after.

## Pre-mortem: likely failures and their guards

- **A restored database looks right but is dead** (identity sequence collision on the next write) → the proof posts a new expense after restore; setval step fixes it.
- **A column type does not survive COPY text** → the proof covers the schema's own types (bigint kobo, numeric, enums, jsonb, arrays, dates, generated columns excluded).
- **A tampered or wrong-key dump silently restores garbage** → AES-GCM authentication fails loudly; the proof flips one byte and expects failure.
- **The proof needs Docker** → no: embedded Postgres plus the driver's COPY; the R2 job later follows Gleey's pg_dump pattern on the server.

## Steps

| # | Step | Files | Proof it worked | If it fails |
|---|---|---|---|---|
| 1 | `sim/db-dump.mjs`, `sim/db-restore.mjs`, `sim/backup-proof.mjs` | the three new files | `node backup-proof.mjs` prints OK; `node check.mjs` still green | fix and rerun |
| 2 | Document the commands in the testing skill and `docs/progress.md`; commit on `build` | docs | plain report to the owner | — |

## Done means

A dump made today restores into a blank database, every table count and ledger sum matches, the books agree, a tampered dump refuses to open, and the restored shop takes new writes. The R2 upload and 6-hourly job stay for later, exactly as the item says.
