import { describe, it, expect } from "vitest";
import {
	needsSyntheticThinking,
	needsSyntheticThinkingForToolCall,
	pickSyntheticThinking,
	syntheticSignature,
} from "../src/synthetic-thinking.ts";

describe("syntheticSignature", () => {
	it("produces a 64-char lowercase hex string", () => {
		expect(syntheticSignature("entry-1:0")).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is deterministic for the same seed", () => {
		expect(syntheticSignature("entry-1:0")).toBe(syntheticSignature("entry-1:0"));
	});

	it("differs across different seeds", () => {
		expect(syntheticSignature("entry-1:0")).not.toBe(syntheticSignature("entry-1:1"));
		expect(syntheticSignature("entry-1:0")).not.toBe(syntheticSignature("entry-2:0"));
	});
});

describe("pickSyntheticThinking", () => {
	it("is deterministic for the same seed", () => {
		const a = pickSyntheticThinking("entry-id-123");
		const b = pickSyntheticThinking("entry-id-123");
		expect(a).toBe(b);
	});

	it("returns a non-empty string", () => {
		const result = pickSyntheticThinking("some-seed");
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("varies across different seeds (not always the same placeholder)", () => {
		const seeds = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
		const results = new Set(seeds.map((s) => pickSyntheticThinking(s)));
		// With 8 placeholders and 12 varied seeds, expect more than one distinct value
		expect(results.size).toBeGreaterThan(1);
	});
});

describe("needsSyntheticThinking", () => {
	it("is true for a text-only reply with no thinking block", () => {
		expect(needsSyntheticThinking([{ type: "text", text: "Sounds good, all set." }])).toBe(true);
	});

	it("is true for a toolCall-only turn with no thinking block", () => {
		expect(needsSyntheticThinking([{ type: "toolCall", id: "1", name: "read", arguments: {} }])).toBe(true);
	});

	it("is false when a thinking block is already present", () => {
		expect(
			needsSyntheticThinking([
				{ type: "thinking", thinking: "already thought", thinkingSignature: "" },
				{ type: "text", text: "Sounds good, all set." },
			]),
		).toBe(false);
	});

	it("is false for empty content", () => {
		expect(needsSyntheticThinking([])).toBe(false);
	});

	it("is false when the only text block is blank", () => {
		expect(needsSyntheticThinking([{ type: "text", text: "   " }])).toBe(false);
	});
});

describe("needsSyntheticThinkingForToolCall", () => {
	it("is true for a toolCall-only turn with no thinking, even if already labeled native", () => {
		expect(needsSyntheticThinkingForToolCall([{ type: "toolCall", id: "1", name: "read", arguments: {} }])).toBe(
			true,
		);
	});

	it("is false for a text-only turn with no toolCall (protects genuine M3 summaries)", () => {
		expect(needsSyntheticThinkingForToolCall([{ type: "text", text: "Done. Committed as abc123." }])).toBe(false);
	});

	it("is false when a thinking block is already present", () => {
		expect(
			needsSyntheticThinkingForToolCall([
				{ type: "thinking", thinking: "already thought", thinkingSignature: "" },
				{ type: "toolCall", id: "1", name: "read", arguments: {} },
			]),
		).toBe(false);
	});

	it("is false for empty content", () => {
		expect(needsSyntheticThinkingForToolCall([])).toBe(false);
	});
});
