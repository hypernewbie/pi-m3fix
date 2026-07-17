/**
 * Synthetic thinking insertion: closes the gap where a genuinely
 * different-provider assistant turn (not M3's own leaked content) sits in
 * history with a visible reply and zero thinking block.
 *
 * Verified mechanism (real session data + pi-ai's own request-serialization
 * code): when Pi builds the next API request, every prior assistant turn is
 * replayed as plain role+content, with no provenance attached - the model
 * receiving the request has no way to know a given turn "wasn't really its
 * own". A foreign-provider turn with only a text reply and no thinking
 * block gets serialized as a bare text-only assistant turn, structurally
 * identical to what M3 itself produces when something's gone wrong. In a
 * real repro, M3's very next turn after such a foreign turn copied that
 * exact shape (text-only, no thinking) for the first time in the whole
 * session - direct evidence M3 pattern-matches on the shape of its own
 * immediately-preceding context, not just its own actual behaviour.
 *
 * The fix inserts a synthetic thinking block before the existing reply -
 * never replacing or hiding it - so the shape M3 sees is always
 * "thinking -> reply", never "reply" alone. The wording can't be genuine
 * (a foreign model's real reasoning isn't recoverable, and it "thinks
 * different" from M3 anyway per direct comparison), so this only targets
 * closing the STRUCTURAL gap, not faithfully reconstructing content.
 *
 * Selection is deterministic (hash of a stable per-message seed, e.g. the
 * entry id), not random: repeated /m3fix runs on an already-repaired file
 * must produce byte-identical output, matching the existing "safe to
 * re-run" guarantee. A single repeated placeholder was avoided in favour of
 * a small rotating pool, so as not to teach M3 a new, equally-repetitive
 * "thinking" pattern to imitate in place of the original missing-thinking
 * one.
 */

const PLACEHOLDERS = [
	"Let me think about how to respond to this.",
	"Considering the best way to answer this.",
	"Taking a moment to work out the right response.",
	"Let me put this together before replying.",
	"Thinking through the context here.",
	"Working out the right response to this.",
	"Let me consider what's being asked.",
	"Pulling together a response to this.",
] as const;

/** Stable djb2-style string hash. Deterministic across runs and platforms. */
function stableHash(input: string): number {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = (hash * 33) ^ input.charCodeAt(i);
	}
	return hash >>> 0;
}

/** Pick a placeholder deterministically from a stable per-message seed. */
export function pickSyntheticThinking(seed: string): string {
	const index = stableHash(seed) % PLACEHOLDERS.length;
	return PLACEHOLDERS[index];
}

export interface SyntheticThinkingContentBlock {
	type?: unknown;
	text?: unknown;
	[key: string]: unknown;
}

/**
 * Whether this turn's content needs a synthetic thinking block inserted:
 * has a visible reply (non-empty text, or a tool call) but no thinking
 * block anywhere. Caller is responsible for only applying this to turns
 * that actually came from a different provider - a text/toolCall-only turn
 * that's genuinely M3's own (not a leak, not aborted) is a legitimate
 * completed reply and must be left alone.
 */
export function needsSyntheticThinking(content: SyntheticThinkingContentBlock[]): boolean {
	const hasThinking = content.some((block) => block.type === "thinking");
	if (hasThinking) return false;

	return content.some(
		(block) =>
			block.type === "toolCall" ||
			(block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0),
	);
}

/**
 * Weaker-signal variant for --rewrite: once a foreign turn has been
 * relabeled to the target provider by ANY prior pass (an older m3fix
 * version, underp.py, or even a previous run of the current version before
 * this feature existed), `provider` permanently reads as native and
 * `needsSyntheticThinking`'s caller can never again prove the turn used to
 * be foreign. Verified against a real stuck case: a turn confirmed foreign
 * in an older pre-repair backup (openai-codex, toolCall-only, no thinking)
 * had already been relabeled to the target provider by an earlier repair
 * pass that predated synthetic-thinking entirely, permanently hiding it from
 * every subsequent run.
 *
 * This only fires on a toolCall-bearing turn (matches the verified
 * invariant that M3 always thinks before any tool call, regardless of
 * provenance) and deliberately excludes text-only turns: a text-only reply
 * with no thinking might genuinely be one of M3's own legitimate final
 * summaries (verified real: 46/46 samples of stop-reason, text-only, no
 * tool call turns in real sessions were substantive genuine answers, not
 * leaks). Once a turn's original provider is lost to relabeling, there is no
 * way to tell a laundered-foreign clean reply apart from a genuine M3
 * summary by content alone, so text-only turns are left alone here - only
 * the structural, unambiguous toolCall signal is trusted.
 */
export function needsSyntheticThinkingForToolCall(content: SyntheticThinkingContentBlock[]): boolean {
	const hasThinking = content.some((block) => block.type === "thinking");
	if (hasThinking) return false;

	return content.some((block) => block.type === "toolCall");
}
