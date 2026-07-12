# Changelog

## 0.3.0

- **Added: live auto-fix.** pi-m3fix now hooks Pi's `message_end` event and
  intercepts every assistant message the instant it's finalized, converting
  M3's flattened-reasoning text blocks to `thinking` blocks before they are
  ever written to the session file. No command invocation needed — it's
  always on once the extension is loaded. This is the actual fix for the
  fundamental limitation shared by `underp.py` and the manual `/m3fix`
  command: both are one-shot repairs of whatever's already in the file, so
  new leaks reappear on every subsequent M3 turn until you remember to
  re-run them. The live hook removes that gap.
- Added `--m3fix-no-live` flag to opt out of the live auto-fix for a run.
- Leak-detection pattern (`isReasoningLeak`) extracted into a shared module
  (`src/leak-pattern.ts`) used by both the live hook and the historical
  `/m3fix` repair, so behavior can't drift between the two paths.
- `/m3fix` (the manual command) is unchanged and still useful for repairing
  session files recorded before this extension was installed, or for
  relabeling `provider`/`api`/`model` on sessions from a renamed/changed
  custom provider.

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
