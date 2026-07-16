import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repairSessionFile } from "../src/repair.ts";

const FIXTURE = resolve(import.meta.dirname, "redacted.jsonl");
const WORK = resolve(import.meta.dirname, "redacted-work.jsonl");

async function loadLines(path: string) {
	const raw = await readFile(path, "utf8");
	return raw.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
}

describe("repairSessionFile redacted handling", () => {
	beforeEach(async () => {
		await copyFile(FIXTURE, WORK);
		if (existsSync(`${WORK}.bak2`)) await rm(`${WORK}.bak2`);
	});

	afterEach(async () => {
		if (existsSync(WORK)) await rm(WORK);
		if (existsSync(`${WORK}.bak2`)) await rm(`${WORK}.bak2`);
	});

	it("neutralizes a foreign redacted thinking block when relabeling from a different provider", async () => {
		// This redacted block's opaque payload belonged to "old" provider.
		// Replaying it verbatim to the target (m3/anthropic-messages) risks a
		// hard API rejection since m3 has no way to interpret someone else's
		// safety-redacted content. It must be neutralized, not forwarded as-is.
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.stats.neutralizedRedacted).toBe(1);
		expect(result.stats.blanked).toBe(0); // redacted blocks never go through the normal blank path

		const lines = await loadLines(WORK);
		const foreign = lines.find((e) => e.id === "00000002");
		expect(foreign.message.content[0].redacted).toBeUndefined();
		expect(foreign.message.content[0].thinkingSignature).toBe("");
		expect(foreign.message.content[0].thinking).toBe("");
	});

	it("leaves an already-native redacted thinking block untouched", async () => {
		// This message already belongs to the target provider - its redacted
		// block is presumed native and is left exactly as-is.
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.stats.neutralizedRedacted).toBe(1); // only the foreign one (00000002)

		const lines = await loadLines(WORK);
		const native = lines.find((e) => e.id === "00000004");
		expect(native.message.content[0].redacted).toBe(true);
		expect(native.message.content[0].thinkingSignature).toBe("native-opaque-blob");
		expect(native.message.content[0].thinking).toBe("opaque-native");
	});

	it("does not neutralize redacted blocks when --no-relabel is passed", async () => {
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
			noRelabel: true,
		});

		expect(result.stats.neutralizedRedacted).toBe(0);
		const lines = await loadLines(WORK);
		const foreign = lines.find((e) => e.id === "00000002");
		expect(foreign.message.content[0].redacted).toBe(true);
		expect(foreign.message.content[0].thinkingSignature).toBe("stale-signature");
	});
});
