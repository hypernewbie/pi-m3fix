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

	it("does not blank thinkingSignature on redacted thinking blocks", async () => {
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
			allowEmptySignature: true,
		});

		expect(result.stats.blanked).toBe(0);

		const lines = await loadLines(WORK);
		const assistant = lines.find((e) => e.id === "00000002");
		expect(assistant.message.content[0].thinkingSignature).toBe("stale-signature");
	});
});
