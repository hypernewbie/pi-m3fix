import { describe, it, expect } from "vitest";
import { parseCommandArgs } from "../src/args.ts";

describe("parseCommandArgs", () => {
	it("parses a session query", () => {
		const result = parseCommandArgs("abc123");
		expect(result.query).toBe("abc123");
		expect(result.dryRun).toBe(false);
	});

	it("parses flags", () => {
		const result = parseCommandArgs("-n --force-live --no-relabel");
		expect(result.dryRun).toBe(true);
		expect(result.forceLive).toBe(true);
		expect(result.noRelabel).toBe(true);
	});

	it("parses target overrides", () => {
		const result = parseCommandArgs("--provider m3 --api anthropic-messages --model MiniMax-M3");
		expect(result.target).toEqual({
			provider: "m3",
			api: "anthropic-messages",
			model: "MiniMax-M3",
		});
	});

	it("rejects unknown flags", () => {
		expect(() => parseCommandArgs("--wat")).toThrow("Unknown flag");
	});
});
