import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { SessionManager, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import type { TargetModel } from "./target-model.ts";
import { isAbortedWithNoThinking, isReasoningLeak, shouldUnflattenBlock } from "./leak-detect.ts";
import {
	needsSyntheticThinking,
	needsSyntheticThinkingForToolCall,
	pickSyntheticThinking,
	syntheticSignature,
} from "./synthetic-thinking.ts";

export interface RepairStats {
	relabeled: number;
	blanked: number;
	unflattened: number;
	neutralizedRedacted: number;
	syntheticThinking: number;
	signed: number;
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
	noSyntheticThinking?: boolean;
	rewrite?: boolean;
	noSign?: boolean;
}

export async function repairSessionFile(
	sessionFile: string,
	options: RepairOptions,
): Promise<RepairResult> {
	// Fail fast if the file isn't a well-formed Pi session before we start
	// rewriting it by hand.
	await SessionManager.open(sessionFile);

	const raw = await readFile(sessionFile, "utf8");
	const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
	const stats: RepairStats = {
		relabeled: 0,
		blanked: 0,
		unflattened: 0,
		neutralizedRedacted: 0,
		syntheticThinking: 0,
		signed: 0,
		activeAssistantTurns: 0,
	};

	let changed = false;
	const outputLines: string[] = [];

	for (const line of lines) {
		const entry = JSON.parse(line) as SessionEntry;

		if (entry.type === "message" && entry.message.role === "assistant") {
			const wasChanged = transformAssistantEntry(entry as SessionMessageEntry, options, stats);
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

function transformAssistantEntry(
	entry: SessionMessageEntry,
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

	// Unflatten leaked reasoning in EVERY assistant turn, including the most
	// recent one. This used to skip the last active turn "to preserve the
	// final answer" - a rule inherited from a version of this repair that
	// blindly converted ANY text block to thinking. That's no longer how this
	// works: isReasoningLeak only matches text that is entirely **bold
	// phrase** segments with zero prose (verified never to match a genuine
	// response, even one that starts with bold emphasis). With that
	// per-block safety guarantee already in place, excluding the last turn
	// added no protection - it only meant the most recently produced (and
	// most visible) leaked-reasoning turn was permanently unfixable, forever,
	// on every single run: "0 changes reported, still broken" is exactly
	// what that produces once every OLDER leaked turn has already been
	// cleaned up and the only remaining leak is the newest one.
	//
	// Second, independent detection path: a text block in a turn whose
	// stopReason is "aborted" AND that has no thinking block anywhere in the
	// same turn. Verified against a real 483-turn session: every genuinely
	// completed turn with visible text ALSO has a thinking block alongside it
	// (stop -> {text, thinking}, 17/17); a text-only shape with no thinking
	// occurs exclusively on aborted turns (2/2), regardless of whether the
	// text happens to look like bold-header notes or plain prose - both are
	// just whatever content had streamed in before Pi received a proper
	// thinking-type marker, cut off by the abort. This is a structural
	// signal, not a text-content guess, and is independent of the bold-phrase
	// pattern match (which catches a different, non-aborted case: a fully
	// completed turn where M3 still emits some of its reasoning as bold-header
	// text alongside a real thinking block).
	const abortedWithNoThinking = isAbortedWithNoThinking(message.stopReason, content);

	if (!options.noUnflatten) {
		const newContent: Array<Record<string, unknown>> = [];
		let convertedThisTurn = false;

		for (const block of content) {
			if (shouldUnflattenBlock(block, abortedWithNoThinking)) {
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

	// Foreign-provider turns that never had a thinking block to begin with are
	// a separate, independent gap from the unflatten cases above: those only
	// touch M3's OWN leaked/aborted content. A turn genuinely produced by a
	// different model (e.g. a text-only "stop" reply from a provider that
	// doesn't emit anthropic-style thinking blocks) is not a leak to repair -
	// it's a legitimate reply from that model. But once relabeled and replayed
	// to M3 on a later call, it is serialized as a bare {role: assistant,
	// content: [text]} turn, structurally identical to M3's own broken shape.
	// Verified directly in a real repro: right after such a foreign turn sat
	// in context, M3's very next reply copied that exact text-only-no-thinking
	// shape for the first time in the whole session - direct evidence M3
	// pattern-matches on the shape of its own immediately-preceding context,
	// not just its own actual behaviour. The fix is not to touch the real
	// reply (it's genuine content, not a leak) but to insert a synthetic
	// thinking block before it, so the shape M3 sees is always
	// "thinking -> reply", never "reply" alone. Wording can't be genuine (a
	// foreign model's real reasoning isn't recoverable, and it "thinks
	// different" from M3 anyway), so this only closes the structural gap.
	if (!options.noSyntheticThinking) {
		const currentContent = Array.isArray(message.content)
			? (message.content as Array<Record<string, unknown>>)
			: [];
		// If a text block still matches the bold-phrase leak pattern here (e.g.
		// noUnflatten was explicitly set, so the leak was intentionally left
		// alone), don't ALSO insert a synthetic thinking block in front of it -
		// that text is a known leak, not a genuine reply, and belongs to
		// unflatten's job, not this one.
		const hasRemainingLeak = currentContent.some(
			(block) => block.type === "text" && typeof block.text === "string" && isReasoningLeak(block.text),
		);
		// Two ways to qualify:
		//  1. wasFromDifferentProvider (definitely foreign per the CURRENT
		//     provider label) - trust the full needsSyntheticThinking check,
		//     including text-only replies (the original, proven-correct case).
		//  2. --rewrite (opt-in): the provider label may have already been
		//     laundered to look native by an earlier repair pass (an older
		//     m3fix version, underp.py, or a previous run of this version
		//     before this feature existed) - permanently destroying the only
		//     signal that turn used to be foreign. Only the toolCall-bearing
		//     case is trusted here (structural, verified: M3 always thinks
		//     before any tool call, regardless of provenance) - text-only
		//     replies are left alone, since a laundered-foreign clean reply and
		//     a genuine M3 final summary are indistinguishable by content once
		//     the provider label is gone.
		const qualifies =
			(wasFromDifferentProvider && needsSyntheticThinking(currentContent)) ||
			(options.rewrite && needsSyntheticThinkingForToolCall(currentContent));
		if (!hasRemainingLeak && qualifies) {
			message.content = [
				{
					type: "thinking",
					thinking: pickSyntheticThinking(entry.id),
					thinkingSignature: "",
				},
				...currentContent,
			];
			stats.syntheticThinking++;
			changed = true;
		}
	}

	// Signing pass, last so it covers blocks created or blanked above as well
	// as pre-existing ones. Pi's anthropic-messages serialization replays a
	// thinking block as thinking only when its signature is non-empty
	// (empty-signature blocks are converted back to plain text at request
	// time), and natively produced thinking blocks always carry a signature -
	// so an empty signature left here would undo the repair on the wire.
	// Anthropic-messages targets only: under other APIs the signature field
	// holds provider-specific payloads that cannot be fabricated. Redacted
	// blocks and empty thinking text are skipped (different replay paths).
	// Seeded per entry+block index: deterministic, idempotent re-runs.
	if (!options.noSign && options.target.api === "anthropic-messages") {
		const finalContent = Array.isArray(message.content)
			? (message.content as Array<Record<string, unknown>>)
			: [];
		for (let i = 0; i < finalContent.length; i++) {
			const block = finalContent[i];
			if (block.type !== "thinking") continue;
			if (block.redacted === true) continue;
			if (typeof block.thinking !== "string" || block.thinking.trim().length === 0) continue;
			if (typeof block.thinkingSignature === "string" && block.thinkingSignature.length > 0) continue;
			block.thinkingSignature = syntheticSignature(`${entry.id}:${i}`);
			stats.signed++;
			changed = true;
		}
	}

	return changed;
}
