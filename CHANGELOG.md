# Changelog

## Unreleased

- Test coverage: 68.85% → 100% statements/lines/functions, 63.48% → 99.43%
  branches. Added dedicated coverage for `index.ts` (command orchestration:
  no-match, multi-match select/cancel/no-UI, live-session refusal, dry-run,
  force-live reload, switchSession cancellation, non-Error throws) and
  `session-find.ts` (0% → 100%: current-session fallback, absolute-path
  match, partial-id/filename/name search, ambiguous matches), plus edge
  cases in `args.ts` (quoting, missing flag values, too many positionals)
  and `repair.ts` (empty session file, pre-existing backup preservation,
  missing/non-array message content). `session-find.ts` gained an optional
  `sessionsRoot` field (test-only hook, defaults to Pi's real sessions
  directory) to make partial-match search testable without touching
  `~/.pi/agent/sessions`.

## 0.4.0

- **Fix (critical):** removed the `api === "anthropic-messages"` gate entirely.
  `/m3fix` previously refused to do anything at all — no relabel, no blank, no
  unflatten — unless the target's API was exactly `anthropic-messages`. If M3
  is proxied over `openai-completions`/`openai-responses`/anything else, this
  was a full no-op. `thinkingSignature` is a generic Pi concept (documented as
  doubling for the OpenAI Responses reasoning-item id) and the leak pattern is
  pure text matching — there was never a real reason for the gate.
- **Fix:** signature blanking and redacted-thinking neutralization now only
  apply to messages actually being relabeled away from a different provider.
  Previously blanking ran unconditionally on every thinking block. Verified
  against `openai-responses-shared.ts`: an empty/falsy `thinkingSignature`
  makes Pi silently drop the entire thinking block from context on replay (no
  text fallback — it just disappears). Running `/m3fix` on an
  already-correct, native M3 session would have destroyed valid working
  content. Now a guaranteed no-op for signatures already belonging to the
  target provider.
- **Added:** foreign `redacted` thinking blocks (a safety-redaction mechanism
  most providers besides Anthropic don't understand) are neutralized into
  empty thinking blocks when the message is being relabeled away from a
  different provider — prevents Pi from replaying an uninterpretable opaque
  payload to M3 and risking a hard API rejection.
- Verified the relabel+blank+neutralize approach against Pi's own source:
  `google-shared.ts` and `openai-completions.ts` (`requiresThinkingAsText`
  models) both explicitly downgrade cross-provider thinking blocks to plain
  text, commented "to avoid model mimicking them". `anthropic-messages.ts` —
  M3's own API in Pi's built-in provider config — has no equivalent
  same-provider check at all. This repair replicates, for M3, protection Pi
  already gives other providers natively.

## 0.3.1

- **Retracts `0.3.0`.** It added a `message_end` hook that live-patched every
  assistant message on the `anthropic-messages` API — unasked for, unreviewed
  scope creep with real unexamined implications (runs on every message end,
  for every provider, changes what gets persisted without the user seeing it
  first). Reverted in full. This release's actual behavior is byte-for-byte
  the same repair as 0.2.3 — the version number is 0.3.1 (not 0.2.4) only
  because npm requires a version higher than the already-published 0.3.0 to
  become `latest` again. `pi-m3fix@0.3.0` is deprecated on npm; do not
  install it.

## 0.2.3

- **Fix (critical):** bare `/m3fix --force-live` silently skipped the unflatten
  step entirely. The auto-detect compat path still required
  `compat.allowEmptySignature === true` from the model registry, but Pi only
  registers that flag for the `xiaomi` provider — not `minimax` or custom/proxy
  providers. Result: m3fix relabeled and blanked signatures but never converted
  leaked reasoning text to thinking blocks. underp.py (which has no compat gate)
  worked; m3fix appeared dead. The registry check is now removed — any
  `anthropic-messages` model is trusted (matching underp.py).
- **Fix:** turns that already had a thinking block but ALSO had leaked bold-phrase
  reasoning text (`[thinking, text:"**...**", toolCall]`) were skipped entirely by
  the `!hasThinking` guard. M3 routinely emits both. The guard is removed and
  replaced with **pattern-based leak detection**: a text block is only converted to
  thinking if it consists entirely of `**bold phrase**` segments with no prose.
  Real responses (e.g. `"**Vibe: hard.** This is not a shallow port..."`) are
  preserved.
- **Fix:** leaked reasoning in pre-compaction turns was left untouched because the
  unflatten only ran on active-context entries. Pre-compaction turns are displayed
  in the TUI but not sent to the LLM, so there is no signature risk — unflatten now
  applies to all assistant turns except the last active one.
- `--allow-empty-signature` flag is now a no-op (kept for backward compatibility).

## 0.2.2

- First release published entirely through CI via OIDC trusted publishing
  (no npm token involved). Confirms the trusted publisher / "require 2FA and
  disallow tokens" setup works end-to-end.

## 0.2.1

- Published to npm as `pi-m3fix`.
- Added CI publish job that runs on `v*` tags, gated on tests passing and the tag
  matching `package.json`'s version.
- Added npm install instructions to README.
- CI publishing moved to npm's [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers/)
  instead of a long-lived `NPM_TOKEN`. This follows npm's own migration guidance
  ([2FA-bypass token deprecation](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)):
  2FA-bypass tokens lose the ability to publish directly starting ~January 2027.
  The CI workflow now authenticates via GitHub Actions OIDC (`id-token: write`)
  and npm CLI >= 11.5.1; no `NPM_TOKEN` secret is used for publishing.

## 0.2.0

- **Fix:** the auto-detect compat check (used when `/m3fix` is run with no explicit
  `--provider/--api/--model` flags) required `compat.allowEmptySignature: true` to be
  registered for the current model before it would blank thinking signatures or
  unflatten leaked reasoning text. Many custom/proxy providers (e.g. MiniMax M3
  through an anthropic-messages-compatible endpoint) don't register that flag even
  though the backend tolerates empty signatures. When the check failed, `provider`/
  `api`/`model` relabeling still happened, but the unflatten step was silently
  skipped, leaving leaked-reasoning text in context for the model to imitate on the
  next turn.
- **Fix:** explicit `--provider`/`--api`/`--model` targets now always trust the
  caller for the signature/unflatten repair (same as the original `underp.py`
  script), instead of falling back to the strict registry check when the explicit
  target happened to exactly match the current model.
- **Added:** `--allow-empty-signature` flag to force the signature/unflatten repair
  regardless of registry compat metadata, for the no-explicit-target/current-model
  path.
- Added unit tests covering `resolveTargetModel` compat resolution.

## 0.1.0

- Initial release: `/m3fix` command, relabel/blank/unflatten repair engine,
  tree-aware active-branch resolution, `.bak2` backups.
