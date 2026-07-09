import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repairSessionFile } from "../src/repair.ts";

const FIXTURE = resolve(import.meta.dirname, "fixture.jsonl");
const WORK = resolve(import.meta.dirname, "work.jsonl");

async function loadLines(path: string) {
	const raw = await readFile(path, "utf8");
	return raw.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
}

async function resetWork() {
	await copyFile(FIXTURE, WORK);
	const backup = `${WORK}.bak2`;
	if (existsSync(backup)) {
		await rm(backup);
	}
}

describe("repairSessionFile", () => {
	beforeEach(async () => {
		await resetWork();
	});

	afterEach(async () => {
		if (existsSync(WORK)) await rm(WORK);
		if (existsSync(`${WORK}.bak2`)) await rm(`${WORK}.bak2`);
	});

	it("relables, blanks signatures, and unflattens active text blocks", async () => {
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
			allowEmptySignature: true,
		});

		expect(result.changed).toBe(true);
		expect(result.stats.relabeled).toBe(4);
		expect(result.stats.unflattened).toBe(2);

		const lines = await loadLines(WORK);

		// Pre-compaction turns are relabeled but not unflattened
		const preAssistant = lines.find((e) => e.id === "00000002");
		expect(preAssistant.message.provider).toBe("m3");
		expect(preAssistant.message.content[0].type).toBe("text");

		// Last active assistant turn (post-compaction) is relabeled but not unflattened
		const lastActive = lines.find((e) => e.id === "00000008");
		expect(lastActive.message.provider).toBe("m3");
		expect(lastActive.message.content[0].type).toBe("text");

		// Non-last active assistant turns are unflattened
		const activeReasoning = lines.find((e) => e.id === "00000007");
		expect(activeReasoning.message.provider).toBe("m3");
		expect(activeReasoning.message.content[0].type).toBe("thinking");
		expect(activeReasoning.message.content[0].thinkingSignature).toBe("");

		const keptReasoning = lines.find((e) => e.id === "00000004");
		expect(keptReasoning.message.provider).toBe("m3");
		expect(keptReasoning.message.content[0].type).toBe("thinking");
		expect(keptReasoning.message.content[0].thinkingSignature).toBe("");

		// Backup created
		expect(existsSync(`${WORK}.bak2`)).toBe(true);
	});

	it("does not unflatten when allowEmptySignature is false", async () => {
		const result = await repairSessionFile(WORK, {
			target: { provider: "anthropic", api: "anthropic-messages", model: "claude-sonnet-4" },
			allowEmptySignature: false,
		});

		expect(result.changed).toBe(true);
		expect(result.stats.relabeled).toBe(4);
		expect(result.stats.unflattened).toBe(0);
	});

	it("dry-run does not write", async () => {
		const before = await readFile(WORK, "utf8");
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
			allowEmptySignature: true,
			dryRun: true,
		});

		expect(result.changed).toBe(true);
		const after = await readFile(WORK, "utf8");
		expect(after).toBe(before);
		expect(existsSync(`${WORK}.bak2`)).toBe(false);
	});
});
