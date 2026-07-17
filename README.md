# pi-m3fix

[![CI](https://github.com/hypernewbie/pi-m3fix/actions/workflows/ci.yml/badge.svg)](https://github.com/hypernewbie/pi-m3fix/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/pi-m3fix.svg)](https://www.npmjs.com/package/pi-m3fix)

Pi extension for repairing session files affected by flattened reasoning blocks.

**"M3" in this name/doc refers to whatever model is currently exhibiting this
behavior in your session — not a hardcoded requirement.** The tool has zero
dependency on any specific provider or model name. With no explicit target,
`/m3fix` resolves to `ctx.model` (Pi's currently selected model), whatever
that is: a built-in provider, or a fully custom one you registered yourself
under any name, doesn't matter. Whatever is currently selected becomes the target
that the whole session gets synced to. `--provider`/`--api`/`--model` override
it explicitly if you need to target something other than the current model.

## Install

From npm (recommended, versioned):

```bash
pi install npm:pi-m3fix
```

Pin to a specific version:

```bash
pi install npm:pi-m3fix@0.5.0
```

From GitHub, latest `main`:

```bash
pi install git:github.com/hypernewbie/pi-m3fix
```

From GitHub, pinned to a released tag:

```bash
pi install git:github.com/hypernewbie/pi-m3fix@v0.5.0
```

`v0.1.0` was broken (see [CHANGELOG.md](CHANGELOG.md)) and has been removed. Do not install it.

Local development checkout:

```bash
pi install /path/to/pi-m3fix
```

Restart Pi or run `/reload`, then use `/m3fix`.

## Usage

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
- `--no-synthetic-thinking` — skip synthetic thinking insertion (see below).
- `--allow-empty-signature` — deprecated no-op (kept for backward compatibility). The repair now always runs for `anthropic-messages` models regardless of registry metadata.

## Behavior

For assistant messages, `/m3fix` can:

1. Set `provider`, `api`, and `model` to the selected target model.
2. Clear stale `thinkingSignature` values — but only on messages actually being
   relabeled away from a different provider. A signature on a message that
   already belongs to the target provider is left completely untouched.
3. Neutralize foreign `redacted` thinking blocks — same rule: only when the
   message is being relabeled away from a different provider.
4. Convert leaked-reasoning text blocks back into thinking blocks.
5. Insert a synthetic thinking block before a different-provider turn's
   genuine reply when that turn has no thinking block at all.

All five operations work for **any API** (`anthropic-messages`,
`openai-completions`, `openai-responses`, etc.) — there is no API allowlist.
M3 can be proxied through any of them, and none of these repairs are
Anthropic-specific: `thinkingSignature` is a generic Pi concept (for
OpenAI Responses it holds a JSON-encoded reasoning-item id, not a signature),
and the leak-pattern match is pure text matching.

Leaked-reasoning detection uses **pattern matching**: a text block is only
converted to thinking if it consists entirely of `**bold phrase**` segments with
no prose content. This matches M3's flattened reasoning output
(`"**Checking license metadata**"`, `"**Planning X**\n\n**Doing Y**"`) while
preserving real responses that happen to start with bold
(`"**Vibe: hard.** This is not a shallow port..."` → kept as text).
Use `--no-unflatten` to skip this step.

Unflatten applies to **every** assistant turn, including the most recently
produced one. Pre-compaction turns are included because they are displayed in
the TUI (even though they aren't sent to the LLM), and leaving leaked
reasoning visible is the exact problem this tool solves.

A turn that genuinely came from a different provider (a real model switch,
not M3's own leak) can have a real reply with no thinking block at all -
some providers don't emit anthropic-style thinking. Once relabeled and
replayed to M3 on a later call, that turn is serialized as a bare
text/tool-call-only assistant turn, indistinguishable from M3's own broken
shape - and M3 can pick up that shape on its very next reply. `/m3fix` closes
this gap by inserting a synthetic thinking block before the existing reply
(never replacing or hiding it), picked deterministically from a small
rotating pool of generic placeholders so repeated runs stay idempotent. Use
`--no-synthetic-thinking` to skip this step.

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
