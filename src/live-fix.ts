import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isReasoningLeak } from "./leak-pattern.ts";

/**
 * Live auto-fix: intercepts every assistant message as it's finalized
 * (message_end) and converts flattened M3 reasoning (bold-phrase text
 * blocks) into thinking blocks BEFORE the message is ever persisted to the
 * session file.
 *
 * This is the difference between "clean up the mess after the fact" (the
 * /m3fix command, and underp.py before it) and "the mess never happens."
 * Manual repair still matters for sessions started before this extension
 * was installed, or ones repaired retroactively, but for any session where
 * pi-m3fix is loaded, leaked reasoning is fixed the instant it's produced.
 *
 * Scope: any assistant message on the anthropic-messages API. No provider
 * allowlist — the leak pattern (isReasoningLeak) is narrow enough (a text
 * block must be *entirely* bold-phrase segments with no prose) that it will
 * not misfire on normal model output, regardless of provider. Disable with
 * --m3fix-no-live if you ever need to opt out for a specific run.
 */
export function registerLiveFix(pi: ExtensionAPI) {
	pi.registerFlag("m3fix-no-live", {
		description: "Disable pi-m3fix's live auto-fix of flattened reasoning (message_end hook)",
		type: "boolean",
		default: false,
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		if (pi.getFlag("m3fix-no-live")) return;

		const message = event.message;
		if (message.api !== "anthropic-messages") return;

		let changed = false;
		const newContent = message.content.map((block) => {
			if (block.type === "text" && block.text.trim().length > 0 && isReasoningLeak(block.text)) {
				changed = true;
				return {
					type: "thinking" as const,
					thinking: block.text,
					thinkingSignature: "",
				};
			}
			return block;
		});

		if (!changed) return;

		return { message: { ...message, content: newContent } };
	});
}
