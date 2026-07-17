# Changelog

## 0.8.0

- **Added: signature filling (`signed` stat, `--no-sign` opt-out).** A repair
  that writes empty `thinkingSignature` values is invisible where it
  matters: Pi's `anthropic-messages` request serialization only replays a
  thinking block as thinking when its signature is non-empty (unless the
  model registry sets `compat.allowEmptySignature`, which is unset for most
  anthropic-compatible providers). An empty-signature block is converted
  back to plain text at request time — so a session could look fully
  repaired on disk while the model still received a history of text-only
  assistant turns, and every previous version of this tool wrote exactly
  those empty signatures. `/m3fix` now fills a deterministic sha256-based
  signature (seeded per entry+block, idempotent across re-runs) into every
  non-redacted, non-empty thinking block that has none — covering blocks it
  creates (unflatten, synthetic thinking), blocks it blanks during
  relabeling, and pre-existing empty-signature blocks alike. Restricted to
  `anthropic-messages` targets: under other APIs the signature field holds
  provider-specific payloads that cannot be fabricated (for
  `openai-responses` it is a real reasoning-item payload; inventing one
  would corrupt the request). Anthropic-compatible endpoints generally do
  not validate signature contents; for one that does, use `--no-sign`.
- README: documented `--rewrite` in the options list (missed in 0.7.0) and
  added `--no-sign`.
- Test coverage: 100% statements/lines/functions maintained (92 tests).

## 0.7.0

- **Added: `--rewrite` flag.** Fixes a real, confirmed-stuck case: once a
  turn has been relabeled to the target provider - by this tool, an older
  version of it, or any other script - its `provider` field permanently
  reads as native, and the normal synthetic-thinking check (v0.6.0) can never
  again prove it used to be foreign. Traced directly against a real session:
  a turn confirmed foreign in a pre-repair backup (toolCall-only, no
  thinking) had already been relabeled by an earlier repair pass that
  predated synthetic-thinking entirely, permanently hiding it from every
  subsequent run - `/m3fix` reported no changes while the turn stayed
  visibly broken. `--rewrite` is opt-in and catches this by inserting
  synthetic thinking on any toolCall-bearing turn with no thinking block,
  regardless of current provider label - trusting the verified structural
  invariant that M3 always thinks before any tool call. Deliberately does
  **not** extend to text-only turns with no tool call, even with
  `--rewrite`: those might be genuine M3 final summaries (verified real:
  46/46 stop-reason, text-only, no-toolCall samples in real sessions were
  substantive genuine answers, not leaks), and once the provider label is
  gone there is no way to tell a laundered-foreign clean reply apart from one
  of those by content alone - only the unambiguous toolCall signal is
  trusted in this weaker-signal mode.
- Test coverage: 100% statements/lines/functions maintained.

## 0.6.0

- **Added: synthetic thinking insertion.** A separate gap from every prior fix
  in this tool: a turn genuinely produced by a *different* provider/model (not
  M3's own leak) can have a real reply with no thinking block at all, because
  some providers don't emit anthropic-style thinking. Once relabeled and
  replayed to M3 on a later call, that turn is serialized as a bare
  text/tool-call-only assistant turn - structurally identical to M3's own
  broken shape. Verified directly against a real repro session: right after
  such a foreign-provider turn sat in context, M3's very next reply copied
  that exact text-only-no-thinking shape for the first time in the whole
  session. `/m3fix` now inserts a synthetic thinking block before the
  existing reply on any different-provider turn that has none - the real
  reply is never touched, hidden, or altered, only prepended to. Wording is
  picked deterministically (hashed on the entry id) from a small rotating
  pool of generic placeholders, so repeated runs on an already-repaired file
  stay idempotent and never drift, and no single repeated phrase becomes its
  own imitable pattern. Skips turns whose text still matches the bold-only
  leak pattern (that's unflatten's job). New `--no-synthetic-thinking` flag to
  opt out.
- Test coverage: 100% statements/lines/functions maintained; added dedicated
  coverage for the new synthetic-thinking module and its integration into the
  repair pipeline (foreign text-only replies, foreign tool-call-only turns,
  idempotency across repeated runs, the opt-out flag, and the interaction
  with `--no-unflatten`).

## 0.5.0

- **Fix (critical, root cause):** found by inspecting a real, live-broken
  session rather than guessing further. A completed/genuine assistant turn
  never has visible text without an accompanying thinking block (verified
  across 483 real assistant turns from that session: every `stop`-reason
  turn with text also has thinking, 17/17, zero exceptions). A text-only
  shape with no thinking occurred exclusively on turns with
  `stopReason: "aborted"` (2/2) - the generation was cut off before Pi
  received a proper thinking-type marker from the stream, so whatever had
  arrived so far got stored as plain text instead. This is unrelated to any
  particular text formatting: it happened once as bold-header-style notes
  and once as fully unformatted prose, in the same real session, with the
  same cause. Unflatten now also converts any text block in a turn where
  `stopReason === "aborted"` and no thinking block is present anywhere in
  that turn, independent of the existing bold-phrase pattern match (which
  remains, for the separate, non-aborted case of a fully completed turn
  that still emits some reasoning as bold-header text alongside a real
  thinking block).
- **Fix:** the most recent ("last active") assistant turn was
  unconditionally excluded from unflatten, on every single run, forever.
  This is a direct regression from before pattern-based leak detection
  existed: the exclusion was originally there to "preserve the final
  answer" back when unflatten blindly converted any text block. Once
  `isReasoningLeak` became the actual safety mechanism (proven to never
  match real prose, even text that starts with bold emphasis), the
  last-turn exclusion stopped adding any protection and instead permanently
  protected the most recently produced - and most visible - leaked-reasoning
  turn from ever being fixed. Symptom: run `/m3fix`, it fixes everything
  older, reports non-zero stats once; run it again and it reports all
  zeros forever while the session still looks broken, because the one turn
  actually being looked at was never eligible for repair in the first
  place. Unflatten now applies uniformly to every assistant turn.
- Note: relabeling and signature/redacted-block handling only ever trigger
  when a message's provider differs from the target. A pure single-provider
  session (never switched models) that hits the aborted-stream bug above
  will correctly show `relabeled: 0` - only `unflattened` moves - since
  there was never anything to relabel in the first place.

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
