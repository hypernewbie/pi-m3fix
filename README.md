# pi-m3fix

Pi extension for repairing session files affected by flattened reasoning blocks.

## Install

Recommended install from GitHub:

```bash
pi install git:github.com/hypernewbie/pi-m3fix@v0.1.0
```

Install the latest `main` branch instead:

```bash
pi install git:github.com/hypernewbie/pi-m3fix
```

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
- `--allow-empty-signature` — force the signature/unflatten repair even if compat metadata is missing/unproven for the current model. Use this for custom providers (e.g. MiniMax M3 through an anthropic-messages-compatible endpoint) that tolerate empty thinking signatures but don't have `compat.allowEmptySignature: true` registered.

## Behavior

For assistant messages, `/m3fix` can:

1. Set `provider`, `api`, and `model` to the selected target model.
2. Clear stale `thinkingSignature` values on non-redacted thinking blocks.
3. Convert active-context text blocks back into thinking blocks.

Active context is computed from Pi's session tree using the current leaf and compaction metadata, so branched sessions are handled correctly.

Signature clearing and text-to-thinking repair only run for compatible Anthropic Messages reasoning models. "Compatible" is determined like this:

- If you pass an explicit `--provider`/`--api`/`--model` target with `--api anthropic-messages`, the repair runs — this is treated as an informed opt-in, same as the original `underp.py` script, and does not require `compat.allowEmptySignature` to be registered.
- If you rely on the currently selected model (no explicit target), the repair only runs if that model's registry entry has `compat.allowEmptySignature: true`. Otherwise it's skipped with a warning, unless you pass `--allow-empty-signature` to force it.

If the repair is skipped, `provider`/`api`/`model` relabeling and signature blanking still happen, but leaked-reasoning text blocks are **not** converted back into `thinking` blocks — leaving corrupted context that the model can imitate on the next turn. If your model output starts degrading right after `/m3fix`, check the notification for a "does not have compat.allowEmptySignature=true" warning and re-run with `--allow-empty-signature` or explicit `--provider/--api/--model` flags.

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
