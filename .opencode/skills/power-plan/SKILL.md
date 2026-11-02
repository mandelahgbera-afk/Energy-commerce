---
name: power-plan
description: Write a real implementation plan for Power Store, based on checked facts, with risky assumptions probed first and proof for every step. Load before any item touching more than one layer (database, app, screens), any migration, money or permission change, any replan, and whenever the owner asks for a plan.
---

# Power Store plans

The owner's standard: "fact-based planning and probability probing and retesting based implementation, so the implementation plan is actually an implementation plan, not a next move masked as an implementation plan."

## Is it a real plan?

It fails if any answer is no:

1. Does it end at a tested result the owner can see, not at "then we'll see"?
2. Could a fresh session carry it out from this file alone?
3. Is every step's starting point a fact you checked, with `file:line`?
4. Is every risky assumption tested before the work that depends on it?
5. Does each step say how you'll know it worked, and what you'd do if it didn't?

## How to write one

Keep it short: most items need 30 to 60 lines. If it grows past one sitting, it is two plans.

1. **Facts first.** Read the actual code and migrations. List what's true today with `file:line`. Mark anything you couldn't check as **unverified**. Never plan from memory.
2. **Assumptions with a probability.** "Bank statements export as CSV: 60%, my judgement." Say whether the number is measured, documented or your judgement.
3. **Probe first.** Anything under about 80% that later work depends on gets the cheapest test that could prove it wrong, placed before that work. If a probe fails, change the plan before building more.
4. **Pre-mortem.** Imagine it failed a month from now. Name the top three likely reasons, and add a step or test for each.
5. **Steps.**

| # | Step | Depends on | Files | Proof it worked | If it fails |
|---|---|---|---|---|---|

   The proof is something someone can run: `node check.mjs`, a named test, a number, a phone-size look. Mark what needs the owner's yes.
6. **Done means.** Tests named, the plan and `docs/progress.md` updated, the owner told what exists and what doesn't.

## Where it lives

`docs/plans/<date>-<topic>.md`. `docs/plans/2026-11-01-phase-1-core.md` is a worked example.

## While building

- Update the plan when reality disagrees, and say what changed and why.
- Retest after each step, not just at the end.
- Report results as they are.
