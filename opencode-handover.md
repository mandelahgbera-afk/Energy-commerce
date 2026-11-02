# Handing Power Store to OpenCode with DeepSeek V4 Pro

For the owner. OpenCode loads the rules by itself, so you only paste a short prompt each session.

## What's set up in this folder

| File | What it does |
|---|---|
| `AGENTS.md` | Always loaded: what the project is, rules that must never break, when to stop and ask, how to save credits |
| `.opencode/skills/` | Five skills, loaded only when needed: planning, database, testing, app, screens |
| `.opencode/agents/reviewer.md` | A read-only second reader for money, stock and permission changes |
| `opencode.json` | What it may do alone, what it must ask about, and what it can never do |
| `sim/check.mjs` | The gate: fails if the locked database files change, or a baseline test goes missing or stops passing |
| `docs/progress.md` | Where things stand and the next items, in order |

**What it can never do:** push code, deploy, connect to a real database, run `rm -rf`, reset git, or edit the locked migrations, the gate, or `opencode.json`.

**What it must ask you first:** installing a package, fetching a web page, or touching anything outside this folder. If it ever asks to change a Gleey file, say no. It only needs to read Gleey or Nazia, and rarely.

## One-time setup

1. Open this folder in OpenCode.
2. Run `/connect`, choose DeepSeek, and paste your API key. (If you buy credits through OpenCode itself, choose that instead.)
3. Run `/models` and pick **DeepSeek V4 Pro**. I didn't fix the model in the config, because I can't tell from here which provider you'll use.
4. To save more: if `/models` also offers **V4 Flash** under the same provider, ask me or edit `opencode.json` to add `"agent": { "explore": { "model": "<provider>/deepseek-v4-flash" } }`. Wide searches then use the cheap model.

## First session: paste this

```
You are taking over Power Store. Its money and stock rules are already built and tested. I won't be watching closely, so follow AGENTS.md exactly.

Setup, once:
1. Read AGENTS.md and docs/progress.md only.
2. Run `git status`. If this folder isn't a git repo or has no commits: run `git init -b main`, then `git add -A`. Check with `git status` that no .env file and no node_modules is staged. Commit with the message "Baseline from Claude: tested money and stock core". Then run `git switch -c build`.
3. In sim/, run `npm ci` only if node_modules is missing, then `node check.mjs`. If it doesn't say OK, stop and show me.

Then do the first unticked item in docs/progress.md: load the skills it needs, write the short plan, build, test, commit on build, and update docs/progress.md. Then stop and tell me in plain words what now works, what you ran and its result, and what you didn't check. Do only that one item.
```

## Every session after: paste this

Start a **new session** each time, since a long session slowly costs more and gets less careful.

```
Continue Power Store. Read AGENTS.md and docs/progress.md only, run `cd sim && node check.mjs`, then do the next unticked item, stop when it's finished, and report in plain words.
```

## Keeping it honest

- **After each session, run this yourself.** It should end with `OK`:

```bash
cd sim && node check.mjs
```

- **See what changed:**

```bash
git log --oneline main..build
```

- **Undo everything since the last good point:** go back to `main`. Nothing on `build` is lost unless you delete it.

```bash
git switch main
```

- **After every 3 to 5 items touching money, stock or permissions, get an outside read before trusting them.** Ask Claude (or another strong reviewer) to attack `git diff main..build`. Claude wrote this core with 81 tests passing, and a second reader still proved 15 serious bugs in it. One let a counter give a panel away free. No model marking its own homework is enough for money code.
- **When an outside read passes,** merge `build` into `main` and move the bar up, so the new tests can't be removed either:

```bash
git switch main && git merge build && cd sim && node make-baseline.mjs
```

## Credits

- DeepSeek caches automatically, and reuse only counts when the start of the conversation matches exactly. Cached input is far cheaper than new input. That's why the rules say to read less, keep test output short, and not edit `AGENTS.md` during a session.
- I left `prune` off in `opencode.json`. Pruning rewrites old messages, which breaks that exact match. The cost control is one item per session instead.
- `opencode.json` hides the 20-odd skills in your global Claude folder from OpenCode, so they aren't sent with every request.
- **Prices:** I couldn't confirm them. DeepSeek's docs wouldn't load from this network, and the sources I could reach disagree. DeepSeek's platform page, seen only as a search snippet, lists V4 Pro at $0.003625 cached, $0.435 new input and $0.87 output per million tokens. Other sites say $1.74 and $3.48, which may be the rate without a promotion. Check your console.
- **Top up a small amount first, and check your balance after session 1.** That's your real cost per item.

## What I couldn't test

OpenCode isn't on this laptop's command path, so **I haven't run this setup in OpenCode**. The config follows OpenCode's current docs, but on the first run check that:

- `opencode agent list` shows `reviewer`
- it can load `power-plan`
- it refuses to edit a file in `supabase/migrations/` dated `20261101`

If that last one isn't refused, tell me. `node check.mjs` still catches the change, but the block isn't working.

Your global `~/.claude/CLAUDE.md` is also read by OpenCode, so it gets your Docker and disk rules, but the hook that enforces Docker renders only runs in Claude Code. `AGENTS.md` repeats the rule, and `ffmpeg` is blocked.
