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

	it("repairs a session targeting an openai-completions API (M3 behind an OpenAI-compatible proxy, not just anthropic-messages)", async () => {
		// Before the API gate was removed, /m3fix refused to do anything at all
		// unless the target's api was exactly "anthropic-messages" - a session
		// where M3 is proxied over openai-completions (or any other API) got a
		// complete no-op. The leak pattern is pure text matching and
		// thinkingSignature is a generic concept across APIs, so this must work
		// identically regardless of API.
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "openai-completions", model: "MiniMax-M3" },
		});

		expect(result.changed).toBe(true);
		expect(result.stats.relabeled).toBe(4);
		expect(result.stats.unflattened).toBe(3);

		const lines = await loadLines(WORK);
		const activeReasoning = lines.find((e) => e.id === "00000004");
		expect(activeReasoning.message.api).toBe("openai-completions");
		expect(activeReasoning.message.content[0].type).toBe("thinking");
	});

	it("does not blank an already-native signature (message already belongs to the target provider)", async () => {
		// Regression guard: blanking a signature on a message that ALREADY
		// belongs to the target provider is not neutral - for openai-responses,
		// thinkingSignature holds a real JSON reasoning-item payload, and an
		// empty/falsy signature makes Pi silently drop the entire thinking block
		// from context on the next call (no text fallback, it just vanishes).
		// Running /m3fix on an already-correct, native M3 session must be a
		// no-op for that session's own valid signatures.
		await writeFile(
			WORK,
			[
				'{"type":"session","version":3,"id":"native-test","timestamp":"2026-07-09T00:00:00.000Z","cwd":"/tmp"}',
				'{"type":"message","id":"n1","parentId":null,"timestamp":"2026-07-09T00:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}],"timestamp":1720000001000}}',
				'{"type":"message","id":"n2","parentId":"n1","timestamp":"2026-07-09T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"native reasoning","thinkingSignature":"{\\"id\\":\\"rs_native_123\\"}"},{"type":"text","text":"Native answer"}],"provider":"m3","api":"openai-responses","model":"MiniMax-M3","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1720000002000}}',
				'{"type":"message","id":"n3","parentId":"n2","timestamp":"2026-07-09T00:00:03.000Z","message":{"role":"user","content":[{"type":"text","text":"more"}],"timestamp":1720000003000}}',
				'{"type":"message","id":"n4","parentId":"n3","timestamp":"2026-07-09T00:00:04.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Another native answer"}],"provider":"m3","api":"openai-responses","model":"MiniMax-M3","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1720000004000}}',
			].join("\n") + "\n",
			"utf8",
		);

		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "openai-responses", model: "MiniMax-M3" },
		});

		expect(result.stats.relabeled).toBe(0); // already native, nothing to relabel
		expect(result.stats.blanked).toBe(0); // signature must survive untouched
		expect(result.changed).toBe(false);

		const lines = await loadLines(WORK);
		const native = lines.find((e) => e.id === "n2");
		expect(native.message.content[0].thinkingSignature).toBe('{"id":"rs_native_123"}');
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
