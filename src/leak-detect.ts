/**
 * Shared leak-detection logic used by the /m3fix file repair (repair.ts).
 * A text block
 * in an assistant message is considered leaked reasoning - should be a
 * thinking block, not text - when either:
 *
 * 1. Pattern match: the text consists entirely of **bold phrase** segments
 *    with no prose content. Matches M3's flattened-reasoning output for
 *    fully completed turns, while never matching a genuine response (a real
 *    response that starts with bold emphasis, e.g.
 *    "**Vibe: hard.** This is not a shallow port...", is never all-bold).
 *
 * 2. Aborted-with-no-thinking: the turn's stopReason is "aborted" and the
 *    turn has no thinking block anywhere. Verified against a real 483-turn
 *    session: a genuinely completed turn NEVER has text without an
 *    accompanying thinking block (17/17 stop-reason turns with text also
 *    have thinking, zero exceptions). A text-only shape with no thinking
 *    occurred exclusively on aborted turns (2/2) - the stream was cut off
 *    before a proper thinking-type marker arrived, so whatever had streamed
 *    in got stored as plain text instead.
 *
 * Explicitly NOT included: "text + toolCall + no thinking, regardless of
 * stopReason" was proposed and rejected. Sampling real local M3 sessions
 * showed those cases are overwhelmingly short, intentional, user-facing
 * transition narration before an edit (e.g. "Now update the sort
 * comparator...", "Now wire it in gfx.cpp..."), not leaked internal
 * monologue - nothing like the verified leaks above, which read as
 * multi-sentence private planning ("The user wants me to implement the
 * plan. Let me re-read the notes first..."). The fact that most tool-call
 * turns use thinking first (verified from real data) does not make every
 * turn that skips it a bug; treating it as one would hide real, useful
 * commentary as invisible thinking. Only apply the rule when the evidence
 * is structural and 100% consistent (aborted stream cutting off before a
 * marker arrives), not a frequency-based guess.
 */

export function isReasoningLeak(text: string): boolean {
	const stripped = text.replace(/\*\*.+?\*\*/g, "").trim();
	return stripped.length === 0;
}

export interface LeakContentBlock {
	type?: unknown;
	text?: unknown;
	[key: string]: unknown;
}

/** Whether the whole turn has no thinking block anywhere in its content. */
export function isAbortedWithNoThinking(stopReason: unknown, content: LeakContentBlock[]): boolean {
	return stopReason === "aborted" && !content.some((block) => block.type === "thinking");
}

/** Whether a single text block should be converted to a thinking block. */
export function shouldUnflattenBlock(block: LeakContentBlock, abortedWithNoThinking: boolean): boolean {
	return (
		block.type === "text" &&
		typeof block.text === "string" &&
		block.text.trim().length > 0 &&
		(isReasoningLeak(block.text) || abortedWithNoThinking)
	);
}
