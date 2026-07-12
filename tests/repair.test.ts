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

	it("relables, blanks signatures, and unflattens active leaked-reasoning blocks", async () => {
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.changed).toBe(true);
		expect(result.stats.relabeled).toBe(4);
		expect(result.stats.blanked).toBe(1);
		expect(result.stats.unflattened).toBe(3);

		const lines = await loadLines(WORK);

		// Pre-compaction turns are relabeled AND unflattened (they display in the TUI)
		const preAssistant = lines.find((e) => e.id === "00000002");
		expect(preAssistant.message.provider).toBe("m3");
		expect(preAssistant.message.content[0].type).toBe("thinking");

		// Last active assistant turn is relabeled but not unflattened
		const lastActive = lines.find((e) => e.id === "00000008");
		expect(lastActive.message.provider).toBe("m3");
		expect(lastActive.message.content[0].type).toBe("text");
		expect(lastActive.message.content[0].text).toBe("Here is the real final answer");

		// Non-last active assistant turn with bold-phrase leak → unflattened
		const activeReasoning = lines.find((e) => e.id === "00000004");
		expect(activeReasoning.message.provider).toBe("m3");
		expect(activeReasoning.message.content[0].type).toBe("thinking");
		expect(activeReasoning.message.content[0].thinkingSignature).toBe("");

		// Mixed turn: already has thinking + leaked bold text → leaked text still unflattened
		const mixedTurn = lines.find((e) => e.id === "00000007");
		expect(mixedTurn.message.content[0].type).toBe("thinking");
		expect(mixedTurn.message.content[0].thinkingSignature).toBe(""); // blanked
		expect(mixedTurn.message.content[1].type).toBe("thinking"); // leaked text → thinking
		expect(mixedTurn.message.content[1].thinking).toBe("**Executing the repair step**");

		// Backup created
		expect(existsSync(`${WORK}.bak2`)).toBe(true);
	});

	it("does not unflatten real-response text (pattern detection protects responses)", async () => {
		// The fixture's last active turn (00000008) has real response text.
		// Even if it weren't the last turn, the text doesn't match the leak pattern.
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		// Only the three bold-phrase leaks (00000002, 00000004, 00000007) are unflattened,
		// not the real response in 00000008.
		expect(result.stats.unflattened).toBe(3);

		const lines = await loadLines(WORK);
		const lastActive = lines.find((e) => e.id === "00000008");
		expect(lastActive.message.content[0].type).toBe("text");
		expect(lastActive.message.content[0].text).toBe("Here is the real final answer");
	});

	it("dry-run does not write", async () => {
		const before = await readFile(WORK, "utf8");
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
			dryRun: true,
		});

		expect(result.changed).toBe(true);
		const after = await readFile(WORK, "utf8");
		expect(after).toBe(before);
		expect(existsSync(`${WORK}.bak2`)).toBe(false);
	});
});
