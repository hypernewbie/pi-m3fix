# Changelog

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
