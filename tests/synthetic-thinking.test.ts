import { describe, it, expect } from "vitest";
import { needsSyntheticThinking, pickSyntheticThinking } from "../src/synthetic-thinking.ts";

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
