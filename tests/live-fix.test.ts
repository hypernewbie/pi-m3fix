import { describe, it, expect, beforeEach } from "vitest";
import { registerLiveFix } from "../src/live-fix.ts";

type Handler = (event: any) => Promise<{ message: any } | void>;

function makeMockApi() {
	const flags = new Map<string, boolean>();
	let messageEndHandler: Handler | undefined;

	const api = {
		registerFlag: (name: string, options: { default?: boolean }) => {
			flags.set(name, options.default ?? false);
		},
		getFlag: (name: string) => flags.get(name) ?? false,
		on: (event: string, handler: Handler) => {
			if (event === "message_end") messageEndHandler = handler;
		},
		setFlag: (name: string, value: boolean) => flags.set(name, value),
	};

	return { api, getHandler: () => messageEndHandler! };
}

function assistantMessage(content: any[], overrides: Partial<Record<string, unknown>> = {}) {
	return {
		role: "assistant" as const,
		api: "anthropic-messages",
		provider: "minimax",
		model: "MiniMax-M3",
		content,
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

describe("registerLiveFix", () => {
	let ctx: ReturnType<typeof makeMockApi>;

	beforeEach(() => {
		ctx = makeMockApi();
		registerLiveFix(ctx.api as any);
	});

	it("converts a pure bold-phrase leak text block to thinking", async () => {
		const message = assistantMessage([
			{ type: "text", text: "**Checking license metadata and release files**" },
			{ type: "toolCall", id: "1", name: "read", arguments: {} },
		]);

		const result = await ctx.getHandler()({ message });

		expect(result).toBeDefined();
		expect(result!.message.content[0].type).toBe("thinking");
		expect(result!.message.content[0].thinking).toBe("**Checking license metadata and release files**");
		expect(result!.message.content[0].thinkingSignature).toBe("");
		expect(result!.message.content[1].type).toBe("toolCall");
	});

	it("leaves real response text untouched", async () => {
		const message = assistantMessage([
			{ type: "text", text: "Yes — there's a file in /path that handles this." },
		]);

		const result = await ctx.getHandler()({ message });
		expect(result).toBeUndefined();
	});

	it("preserves a real response that starts with bold emphasis", async () => {
		const message = assistantMessage([
			{ type: "text", text: "**Vibe: hard.** This is not a shallow port — it's a reimplementation." },
		]);

		const result = await ctx.getHandler()({ message });
		expect(result).toBeUndefined();
	});

	it("fixes leaked text even when a real thinking block already exists (mixed turn)", async () => {
		const message = assistantMessage([
			{ type: "thinking", thinking: "real chain of thought", thinkingSignature: "valid-sig" },
			{ type: "text", text: "**Executing the repair step**" },
			{ type: "toolCall", id: "1", name: "bash", arguments: {} },
		]);

		const result = await ctx.getHandler()({ message });

		expect(result).toBeDefined();
		expect(result!.message.content[0].thinkingSignature).toBe("valid-sig"); // untouched
		expect(result!.message.content[1].type).toBe("thinking"); // leaked text converted
		expect(result!.message.content[1].thinking).toBe("**Executing the repair step**");
	});

	it("ignores non-assistant messages", async () => {
		const result = await ctx.getHandler()({ message: { role: "user", content: [{ type: "text", text: "**Fake leak**" }] } });
		expect(result).toBeUndefined();
	});

	it("ignores non-anthropic-messages API", async () => {
		const message = assistantMessage([{ type: "text", text: "**Checking license metadata**" }], {
			api: "openai-completions",
		});
		const result = await ctx.getHandler()({ message });
		expect(result).toBeUndefined();
	});

	it("respects the --m3fix-no-live opt-out flag", async () => {
		(ctx.api as any).setFlag("m3fix-no-live", true);
		const message = assistantMessage([{ type: "text", text: "**Checking license metadata**" }]);
		const result = await ctx.getHandler()({ message });
		expect(result).toBeUndefined();
	});
});
