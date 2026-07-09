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

## Behavior

For assistant messages, `/m3fix` can:

1. Set `provider`, `api`, and `model` to the selected target model.
2. Clear stale `thinkingSignature` values on non-redacted thinking blocks.
3. Convert active-context text blocks back into thinking blocks.

Active context is computed from Pi's session tree using the current leaf and compaction metadata, so branched sessions are handled correctly.

Signature clearing and text-to-thinking repair are limited to compatible Anthropic Messages reasoning models. If you pass an explicit `--api anthropic-messages` target, that is treated as an opt-in for the repair. Redacted thinking blocks are never modified.

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
