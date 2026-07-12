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
 *
 * Shared by the historical-session repair (src/repair.ts) and the live
 * message_end auto-fix (src/live-fix.ts) so both use identical detection.
 */
export function isReasoningLeak(text: string): boolean {
	const stripped = text.replace(/\*\*.+?\*\*/g, "").trim();
	return stripped.length === 0;
}
