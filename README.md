# pi-m3fix

[![CI](https://github.com/hypernewbie/pi-m3fix/actions/workflows/ci.yml/badge.svg)](https://github.com/hypernewbie/pi-m3fix/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pi-m3fix.svg)](https://www.npmjs.com/package/pi-m3fix)

Pi extension that fixes M3's flattened reasoning: **live**, as it happens, plus a
manual command to repair session files recorded before this was installed.

## Install

From npm (recommended, versioned):

```bash
pi install npm:pi-m3fix
```

Pin to a specific version:

```bash
pi install npm:pi-m3fix@0.2.2
```

From GitHub, latest `main`:

```bash
pi install git:github.com/hypernewbie/pi-m3fix
```

From GitHub, pinned to a released tag:

```bash
pi install git:github.com/hypernewbie/pi-m3fix@v0.2.2
```

`v0.1.0` was broken (see [CHANGELOG.md](CHANGELOG.md)) and has been removed. Do not install it.

Local development checkout:

```bash
pi install /path/to/pi-m3fix
```

Restart Pi or run `/reload`. The live auto-fix is on immediately, no command
needed. Use `/m3fix` only to repair sessions recorded before installing.

## Live auto-fix

As soon as this extension is loaded, it hooks Pi's `message_end` event and
intercepts every assistant message the instant it's finalized — before it is
ever written to the session file. If a text block is entirely M3's flattened
reasoning (bold-phrase segments, no prose), it's converted to a `thinking`
block with an empty signature right there. Leaked reasoning never gets a
chance to sit in the session file.

This is the fundamental improvement over `underp.py` and over running `/m3fix`
manually: both of those are reactive, one-shot repairs of whatever's already in
the file. If you keep chatting with M3, both `underp.py` and `/m3fix` need to
be re-run over and over, and there's always a live turn on screen that's still
leaking until you next run them. The live auto-fix removes that gap entirely.

Same pattern-matching as the historical repair (see below) — conservative
enough to leave real responses untouched, including ones that start with bold
emphasis. Applies to any `anthropic-messages` assistant message; no
provider allowlist. Disable for a single run with `--m3fix-no-live` if needed.

## Usage (historical/manual repair)

```text
/m3fix [partial-session-id|session-file] [options]
```

Examples:

```text
/m3fix --dry-run
/m3fix --force-live
/m3fix 019f311c --provider m3 --api anthropic-messages --model MiniMax-M3
/m3fix /absolute/path/to/session.jsonl --dry-run
```

Options:

- `--dry-run`, `-n` — show changes without writing.
- `--force-live` — repair the loaded session and reload it from disk.
- `--provider <id>` — override the target provider.
- `--api <api>` — override the target API.
- `--model <id>` — override the target model.
- `--no-relabel` — skip provider/API/model relabeling.
- `--no-unflatten` — skip text-to-thinking repair.
- `--allow-empty-signature` — deprecated no-op (kept for backward compatibility). The repair now always runs for `anthropic-messages` models regardless of registry metadata.

## Behavior (`/m3fix` command)

For assistant messages, `/m3fix` can:

1. Set `provider`, `api`, and `model` to the selected target model.
2. Clear stale `thinkingSignature` values on non-redacted thinking blocks.
3. Convert leaked-reasoning text blocks back into thinking blocks.

Leaked-reasoning detection uses **pattern matching**: a text block is only
converted to thinking if it consists entirely of `**bold phrase**` segments with
no prose content. This matches M3's flattened reasoning output
(`"**Checking license metadata**"`, `"**Planning X**\n\n**Doing Y**"`) while
preserving real responses that happen to start with bold
(`"**Vibe: hard.** This is not a shallow port..."` → kept as text).

Signature clearing and text-to-thinking repair run for any `anthropic-messages`
model — the same behavior as the original `underp.py` script. No registry compat
metadata is required. Use `--no-unflatten` to skip the text-to-thinking step.

Unflatten applies to **all** assistant turns except the last active one.
Pre-compaction turns are included because they are displayed in the TUI (even
though they aren't sent to the LLM), and leaving leaked reasoning visible is the
exact problem this tool solves.

Redacted thinking blocks are never modified.

## Safety

- Creates a one-time `.bak2` backup before writing.
- Writes through a temporary file and atomic rename.
- Re-opens the repaired file with Pi's `SessionManager` to validate it.
- Refuses to modify the loaded session unless `--force-live` is supplied.

## Development

```bash
npm install
npm test
npm run typecheck
npm pack --dry-run
```

## Releasing (maintainers)

CI publishes to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers/) — no npm token involved. To cut a release:

1. Bump `version` in `package.json`.
2. Commit, then tag `vX.Y.Z` matching that version and push both:
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
3. CI runs tests, verifies the tag matches `package.json`'s version, then publishes via OIDC. Provenance is generated automatically.

The npm package's Trusted Publisher is configured to only accept publishes from this repo's `.github/workflows/ci.yml` workflow. Publishing access via classic/granular tokens is disabled on npmjs.com ("Require two-factor authentication and disallow tokens"), so a compromised or misconfigured token cannot publish a release.
