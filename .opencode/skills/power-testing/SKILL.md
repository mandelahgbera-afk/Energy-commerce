---
name: power-testing
description: How Power Store is tested. Load before writing or running tests, when a test fails in a way you don't understand, or before committing a money, stock or permission change. Covers which command to run when, how to add a scene, and what you may never do to a test.
---

# Testing Power Store

All commands run from `sim/`.

| Command | What it does | When | Time here |
|---|---|---|---|
| `node check.mjs` | Locked files unchanged, then every rule scene on PGlite. Prints only failures and totals | After every change | About a minute |
| `node check.mjs --full` | The above, plus the same scenes on real Postgres and the race tests, then cleans up temp folders | Before committing a money, stock or permission change | A few minutes |
| `node backup-proof.mjs` | Seeds a whole shop day on a throwaway server, seals an encrypted dump, restores it into a blank one, and compares every table, the ledger and `i_books_check()`; a tampered dump refuses to open | Before go-live, and whenever the schema grew | A minute or two |
| `node edge.mjs` | Every rule scene, one per line | When you need to see scene names | About a minute |
| `node race.mjs` | Real connections fighting over the same stock and money | Included in `--full` | Under a minute |
| `npm run e2e` (from the project folder, not `sim/`) | A throwaway local Supabase (real Postgres, sign-in and API images), the app, and Chrome. Signs in as test staff, sells at the counter, closes the till, works the owner's screen, and checks each result in the books. Never touches staging | After changing a screen, or a function a screen calls. Needs Docker running | About two minutes |
| `node simulate.mjs 30 90` | 90 pretend days through the real functions. Reports KB per sale and checks the books daily | Only when the schema grew and new size numbers are wanted | A few minutes |

Filter anything you run directly, to save credits: `node edge.mjs | grep -vE '^pass'`.

After `race.mjs`, `edge.mjs --real` or `simulate.mjs`, run `node ~/.claude/tools/dev-clean.mjs --yes`. `--full` does this for you.

Embedded Postgres refuses to run from an administrator shell. If that happens, use a normal shell, or set `POWER_TEST_PG=docker` with Docker running.

## Adding a scene

Scenes live in `sim/edge.mjs`. They read like a shop's day, and they use the same functions the screens will call, logged in as a real role:

```js
await test('a deposit is money we owe, and only becomes a sale when goods leave', async () => {
  const p = await product({ price: 100000000, cost: 70000000, qty: 2 });
  const o = await order(p, { phone: '08030000001' });
  same(await moved(() => pay(o, 40000000)), { bank: 40000000, goods_owed: -40000000 });
  await fails(deliver(o), 'payment_required');
});
```

- `moved(fn)` returns how each ledger account changed. Assert the exact result, never just "it didn't throw".
- `fails(promise, 'error_name')` asserts the exact refusal.
- `i_books_check()` runs automatically after every scene.
- Add new scenes before the final "a month closes" scene. That one moves the clock and closes the month.

Every new money or stock function needs at least: the normal path with exact ledger movement, a retry with the same key changing nothing, a refusal for a role that shouldn't, and a race scene in `race.mjs` if two people could collide on it. Every new exposed function must also join the list in `only the functions on this list can be run from outside` and the table in `each role is refused what is not its job`.

Row triggers don't fire on zero rows, so a test that an update is refused must first create a row.

## What you may never do

- Delete, rename, skip or loosen a test to get green. `check.mjs` compares against `sim/baseline.json` and fails if a baseline scene is missing or failing.
- Edit `check.mjs`, `baseline.json`, `make-baseline.mjs`, `stubs.sql` or a locked migration. They are denied on purpose.
- Report "tests pass" without having just run them.

## When a scene fails

1. Read the failure message. It names the expected and actual result.
2. Decide which is wrong, the code or the scene, by asking what should happen in a real shop. Work the naira through by hand.
3. Fix the cause. Two failed fixes means stop and read properly. Three means stop and tell the owner.

If the books check fails after a scene, the bug is real until proven otherwise: some record and its money have drifted apart.
