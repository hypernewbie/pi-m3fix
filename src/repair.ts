import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { SessionManager, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import type { TargetModel } from "./target-model.ts";

export interface RepairStats {
	relabeled: number;
	blanked: number;
	unflattened: number;
	neutralizedRedacted: number;
	activeAssistantTurns: number;
}

export interface RepairResult {
	changed: boolean;
	stats: RepairStats;
	backupPath?: string;
}

export interface RepairOptions {
	target: TargetModel;
	dryRun?: boolean;
	noRelabel?: boolean;
	noUnflatten?: boolean;
}

export async function repairSessionFile(
	sessionFile: string,
	options: RepairOptions,
): Promise<RepairResult> {
	const sm = await SessionManager.open(sessionFile);
	let lastActiveAssistantId: string | undefined;

	for (const entry of buildActiveEntries(sm)) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			lastActiveAssistantId = entry.id;
		}
	}

	const raw = await readFile(sessionFile, "utf8");
	const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
	const stats: RepairStats = {
		relabeled: 0,
		blanked: 0,
		unflattened: 0,
		neutralizedRedacted: 0,
		activeAssistantTurns: 0,
	};

	let changed = false;
	const outputLines: string[] = [];

	for (const line of lines) {
		const entry = JSON.parse(line) as SessionEntry;

		if (entry.type === "message" && entry.message.role === "assistant") {
			const wasChanged = transformAssistantEntry(
				entry as SessionMessageEntry,
				lastActiveAssistantId,
				options,
				stats,
			);
			if (wasChanged) changed = true;
		}

		outputLines.push(JSON.stringify(entry));
	}

	if (options.dryRun || !changed) {
		return { changed, stats };
	}

	const backupPath = `${sessionFile}.bak2`;
	if (!existsSync(backupPath)) {
		await writeFile(backupPath, raw, "utf8");
	}

	const tempPath = `${sessionFile}.tmp-${Date.now()}`;
	await writeFile(tempPath, outputLines.join("\n") + "\n", "utf8");
	await rename(tempPath, sessionFile);

	await SessionManager.open(sessionFile);

	return { changed, stats, backupPath };
}

function buildActiveEntries(sm: SessionManager): SessionEntry[] {
	const allEntries = sm.getEntries();
	const byId = new Map<string, SessionEntry>();
	for (const entry of allEntries) {
		byId.set(entry.id, entry);
	}

	const leafId = sm.getLeafId();
	let leaf: SessionEntry | undefined;
	if (leafId) {
		leaf = byId.get(leafId);
	}
	if (!leaf) {
		leaf = allEntries[allEntries.length - 1];
	}
	if (!leaf) {
		return [];
	}

	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	path.reverse();

	let compaction: SessionEntry & { type: "compaction"; firstKeptEntryId?: string } | undefined;
	let compactionIdx = -1;
	for (let i = 0; i < path.length; i++) {
		const entry = path[i];
		if (entry.type === "compaction") {
			compaction = entry as SessionEntry & { type: "compaction"; firstKeptEntryId?: string };
			compactionIdx = i;
		}
	}

	if (!compaction) {
		return path;
	}

	const active: SessionEntry[] = [];
	let foundFirstKept = false;
	for (let i = 0; i < compactionIdx; i++) {
		const entry = path[i];
		if (entry.id === compaction.firstKeptEntryId) {
			foundFirstKept = true;
		}
		if (foundFirstKept) {
			active.push(entry);
		}
	}
	for (let i = compactionIdx + 1; i < path.length; i++) {
		active.push(path[i]);
	}

	return active;
}

function transformAssistantEntry(
	entry: SessionMessageEntry,
	lastActiveAssistantId: string | undefined,
	options: RepairOptions,
	stats: RepairStats,
): boolean {
	let changed = false;
	const message = entry.message as unknown as Record<string, unknown>;
	const content = Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : [];
	const originalProvider = message.provider;
	const wasFromDifferentProvider = originalProvider !== options.target.provider;

	if (!options.noRelabel) {
		if (message.provider !== options.target.provider) {
			message.provider = options.target.provider;
			changed = true;
		}
		if (message.api !== options.target.api) {
			message.api = options.target.api;
			changed = true;
		}
		if (message.model !== options.target.model) {
			message.model = options.target.model;
			changed = true;
		}
		if (changed) {
			stats.relabeled++;
		}
	}

	for (const block of content) {
		if (block.type === "thinking") {
			if (block.redacted === true) {
				// Redacted thinking is an opaque, provider-specific safety-redaction
				// payload (Pi's schema stores it in thinkingSignature, replayed
				// verbatim as-is to whatever API the message is now labeled under).
				// If this message used to belong to a different provider, that
				// payload is foreign: the target model has no way to interpret it,
				// and some backends reject a redacted_thinking block they don't
				// recognize outright, breaking the whole API call. We can't recover
				// the real (encrypted) content, so neutralize it into an empty
				// thinking block - Pi's own request serialization already drops
				// thinking blocks with empty thinking text AND empty signature, so
				// this cleanly disappears from context instead of risking an error.
				if (wasFromDifferentProvider && !options.noRelabel) {
					delete block.redacted;
					block.thinking = "";
					block.thinkingSignature = "";
					stats.neutralizedRedacted++;
					changed = true;
				}
				continue;
			}
			// Only blank a signature when the message is actually being relabeled
			// away from a different provider - i.e. the signature is genuinely
			// stale (belongs to a provider this message no longer claims to be
			// from). Blanking an ALREADY-native signature is actively harmful, not
			// neutral: for openai-responses, thinkingSignature holds a real JSON
			// reasoning-item payload, and a falsy/empty signature causes Pi to
			// silently drop the entire thinking block from context on the next
			// call (no fallback to text - it just disappears). Running /m3fix on
			// an already-correct, native M3 session must not destroy working
			// content like that.
			if (
				wasFromDifferentProvider &&
				!options.noRelabel &&
				block.thinkingSignature !== "" &&
				block.thinkingSignature !== undefined
			) {
				block.thinkingSignature = "";
				stats.blanked++;
				changed = true;
			}
		}
	}

	const isLastActiveAssistant = entry.id === lastActiveAssistantId;

	// Unflatten leaked reasoning in ALL assistant turns except the last active one.
	// Pre-compaction / branched-off turns are not sent to the LLM, so there is no
	// signature risk — but they ARE displayed in the TUI, so cleaning them up
	// matters for readability. Pattern detection (isReasoningLeak) ensures real
	// response text is never touched.
	//
	// New thinking blocks synthesized here always get thinkingSignature: ""
	// (empty string, never anything else). This is deliberate and must not
	// change: for openai-responses, thinkingSignature holds a real JSON-encoded
	// reasoning-item object, and Pi's serializer does `JSON.parse(signature)`
	// whenever the signature is truthy. An empty string is falsy, so the block
	// is cleanly skipped (dropped from that turn's outbound context, no crash).
	// Putting anything non-empty but non-JSON here (e.g. a placeholder string)
	// would make Pi's JSON.parse throw and break the entire API call the next
	// time this turn is replayed - strictly worse than the original leak.
	if (!isLastActiveAssistant && !options.noUnflatten) {
		const newContent: Array<Record<string, unknown>> = [];
		let convertedThisTurn = false;

		for (const block of content) {
			if (
				block.type === "text" &&
				typeof block.text === "string" &&
				block.text.trim().length > 0 &&
				isReasoningLeak(block.text)
			) {
				newContent.push({
					type: "thinking",
					thinking: block.text,
					thinkingSignature: "",
				});
				stats.unflattened++;
				convertedThisTurn = true;
				changed = true;
			} else {
				newContent.push(block);
			}
		}

		if (convertedThisTurn) {
			message.content = newContent;
			stats.activeAssistantTurns++;
		}
	}

	return changed;
}

/**
 * Detect M3's flattened reasoning: text that consists entirely of **bold phrase**
 * segments with no prose content. Real assistant responses have prose
 * between/after bold markers.
 *
 * Examples:
 *   "**Checking license metadata**"                        → true  (leak)
 *   "**Inspecting X**\n\n**Planning Y**"                      → true  (leak)
 *   "**Vibe: hard.** This is not a shallow port — it's..."    → false (real response)
 *   "Yes — there's a file in /path..."                        → false (real response)
 */
function isReasoningLeak(text: string): boolean {
	const stripped = text.replace(/\*\*.+?\*\*/g, "").trim();
	return stripped.length === 0;
}
