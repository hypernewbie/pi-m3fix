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

	it("parses --no-unflatten and --allow-empty-signature", () => {
		const result = parseCommandArgs("--no-unflatten --allow-empty-signature");
		expect(result.noUnflatten).toBe(true);
		expect(result.allowEmptySignature).toBe(true);
	});

	it("parses --no-synthetic-thinking and --rewrite", () => {
		const result = parseCommandArgs("--no-synthetic-thinking --rewrite");
		expect(result.noSyntheticThinking).toBe(true);
		expect(result.rewrite).toBe(true);
	});

	it("parses --no-sign", () => {
		const result = parseCommandArgs("--no-sign");
		expect(result.noSign).toBe(true);
	});

	it("defaults --rewrite, --no-synthetic-thinking, and --no-sign to false", () => {
		const result = parseCommandArgs("");
		expect(result.rewrite).toBe(false);
		expect(result.noSyntheticThinking).toBe(false);
		expect(result.noSign).toBe(false);
	});

	it("parses target overrides individually", () => {
		expect(parseCommandArgs("--provider m3").target).toEqual({ provider: "m3" });
		expect(parseCommandArgs("--api anthropic-messages").target).toEqual({ api: "anthropic-messages" });
		expect(parseCommandArgs("--model MiniMax-M3").target).toEqual({ model: "MiniMax-M3" });
	});

	it("rejects a target flag with a missing value", () => {
		expect(() => parseCommandArgs("--provider")).toThrow("Missing value for --provider");
		expect(() => parseCommandArgs("--api")).toThrow("Missing value for --api");
		expect(() => parseCommandArgs("--model")).toThrow("Missing value for --model");
	});

	it("rejects more than one positional argument", () => {
		expect(() => parseCommandArgs("abc123 def456")).toThrow(
			"Expected at most one positional argument (session UUID or path)",
		);
	});

	it("handles no positional argument at all", () => {
		const result = parseCommandArgs("--dry-run");
		expect(result.query).toBeUndefined();
	});

	it("parses double-quoted and single-quoted tokens, including embedded spaces", () => {
		const result = parseCommandArgs(`--provider "my custom provider" --model 'my custom model'`);
		expect(result.target).toEqual({
			provider: "my custom provider",
			model: "my custom model",
		});
	});

	it("handles empty input", () => {
		const result = parseCommandArgs("");
		expect(result.query).toBeUndefined();
		expect(result.target).toBeUndefined();
	});

	it("handles extra whitespace between tokens", () => {
		const result = parseCommandArgs("  --dry-run    abc123  ");
		expect(result.dryRun).toBe(true);
		expect(result.query).toBe("abc123");
	});
});
