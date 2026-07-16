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

		// Last active assistant turn is relabeled; its real response text is
		// left as text (not because it's last - because it doesn't match the
		// leak pattern; see the dedicated last-turn-leak test below).
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

	it("unflattens leaked reasoning even when it's the LAST active turn (regression: previously always skipped)", async () => {
		// This is the exact bug behind "ran /m3fix, 0 changes reported, still
		// broken": the last active turn used to be unconditionally excluded from
		// unflatten to "preserve the final answer", a rule from before pattern
		// matching existed. Once every OLDER leaked turn is fixed, the only thing
		// left broken is always the newest turn - which was always skipped, on
		// every single run, forever. Pattern matching alone must now be trusted
		// to protect real answers, so the last turn gets the same treatment as
		// every other turn.
		await writeFile(
			WORK,
			[
				'{"type":"session","version":3,"id":"last-turn-leak-test","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}',
				'{"type":"message","id":"1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"do the thing"}],"timestamp":1}}',
				'{"type":"message","id":"2","parentId":"1","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"**Checking the most recent leaked turn**"}],"provider":"old-provider","api":"old-api","model":"old-model","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":2}}',
			].join("\n") + "\n",
			"utf8",
		);

		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.stats.unflattened).toBe(1);

		const lines = await loadLines(WORK);
		const entry = lines.find((e) => e.id === "2");
		expect(entry.message.content[0].type).toBe("thinking");
		expect(entry.message.content[0].thinking).toBe("**Checking the most recent leaked turn**");
		expect(entry.message.content[0].thinkingSignature).toBe("");
	});

	it("unflattens text from an aborted turn with no thinking block, regardless of content style", async () => {
		// Root cause found by inspecting a real, live-broken session (structural
		// finding only - fixture content below is entirely synthetic, not the
		// original private data): a completed/genuine turn NEVER has text
		// without an accompanying thinking block (verified across 483 real
		// assistant turns: every stop-reason "stop" turn with text also has
		// thinking, 17/17). A text-only shape with no thinking occurs
		// exclusively when stopReason is "aborted" - the stream was cut off
		// before Pi received a proper thinking-type marker, so whatever had
		// streamed in got stored as plain text. This must be caught regardless
		// of whether the text happens to look like bold-header notes or plain
		// unformatted prose - both are the same underlying bug.
		await writeFile(
			WORK,
			[
				'{"type":"session","version":3,"id":"aborted-test","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}',
				'{"type":"message","id":"1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"do it"}],"timestamp":1}}',
				'{"type":"message","id":"2","parentId":"1","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Placeholder unformatted internal-monologue text with no bold markers at all."}],"provider":"minimax","api":"anthropic-messages","model":"MiniMax-M3","stopReason":"aborted","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"timestamp":2}}',
				'{"type":"message","id":"3","parentId":"2","timestamp":"2026-01-01T00:00:03.000Z","message":{"role":"user","content":[{"type":"text","text":"go"}],"timestamp":3}}',
				'{"type":"message","id":"4","parentId":"3","timestamp":"2026-01-01T00:00:04.000Z","message":{"role":"assistant","content":[{"type":"text","text":"**Placeholder step one**\\n\\n**Placeholder step two**"}],"provider":"minimax","api":"anthropic-messages","model":"MiniMax-M3","stopReason":"aborted","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"timestamp":4}}',
			].join("\n") + "\n",
			"utf8",
		);

		const result = await repairSessionFile(WORK, {
			target: { provider: "minimax", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.stats.unflattened).toBe(2);
		expect(result.stats.relabeled).toBe(0); // already native, nothing to relabel

		const lines = await loadLines(WORK);
		const plainProseLeak = lines.find((e) => e.id === "2");
		expect(plainProseLeak.message.content[0].type).toBe("thinking");
		expect(plainProseLeak.message.content[0].thinking).toBe(
			"Placeholder unformatted internal-monologue text with no bold markers at all.",
		);

		const boldHeaderLeak = lines.find((e) => e.id === "4");
		expect(boldHeaderLeak.message.content[0].type).toBe("thinking");
	});

	it("does NOT unflatten aborted-turn text when a thinking block is already present (genuine partial content)", async () => {
		// Verified against real data (fixture content below is synthetic): an
		// aborted turn CAN have a real thinking block plus genuine, substantive
		// response text and a real tool call all together (the abort happened
		// later in the stream, after the thinking-type marker was already
		// established). That's not a leak - it's a normal turn that got cut
		// short after doing real work, and must be left alone.
		await writeFile(
			WORK,
			[
				'{"type":"session","version":3,"id":"aborted-genuine-test","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}',
				'{"type":"message","id":"1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"fix it"}],"timestamp":1}}',
				'{"type":"message","id":"2","parentId":"1","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Placeholder reasoning about the fix","thinkingSignature":""},{"type":"text","text":"Placeholder genuine response text explaining the fix."},{"type":"toolCall","id":"tc1","name":"edit","arguments":{}}],"provider":"minimax","api":"anthropic-messages","model":"MiniMax-M3","stopReason":"aborted","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"timestamp":2}}',
			].join("\n") + "\n",
			"utf8",
		);

		const result = await repairSessionFile(WORK, {
			target: { provider: "minimax", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.stats.unflattened).toBe(0);

		const lines = await loadLines(WORK);
		const entry = lines.find((e) => e.id === "2");
		expect(entry.message.content[1].type).toBe("text");
		expect(entry.message.content[1].text).toBe("Placeholder genuine response text explaining the fix.");
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

	it("handles an empty (header-only) session file without crashing", async () => {
		// No message entries at all - the line-by-line repair loop must simply
		// produce zero stats instead of crashing.
		await writeFile(
			WORK,
			'{"type":"session","version":3,"id":"empty-test","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}\n',
			"utf8",
		);

		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.changed).toBe(false);
		expect(result.stats).toEqual({
			relabeled: 0,
			blanked: 0,
			unflattened: 0,
			neutralizedRedacted: 0,
			activeAssistantTurns: 0,
		});
	});

	it("preserves a pre-existing .bak2 instead of overwriting it", async () => {
		// The FIRST repair creates the backup. A subsequent repair (e.g. after
		// more leaked turns accumulate) must not clobber that original backup.
		await writeFile(`${WORK}.bak2`, "original untouched backup content\n", "utf8");

		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.changed).toBe(true);
		const backupContent = await readFile(`${WORK}.bak2`, "utf8");
		expect(backupContent).toBe("original untouched backup content\n");
	});

	it("handles an assistant message with missing/non-array content without crashing", async () => {
		await writeFile(
			WORK,
			[
				'{"type":"session","version":3,"id":"no-content-test","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}',
				'{"type":"message","id":"1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}],"timestamp":1}}',
				'{"type":"message","id":"2","parentId":"1","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"assistant","provider":"old","api":"old","model":"old","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":2}}',
			].join("\n") + "\n",
			"utf8",
		);

		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});

		expect(result.changed).toBe(true); // still relabeled
		expect(result.stats.relabeled).toBe(1);
		expect(result.stats.unflattened).toBe(0);

		const lines = await loadLines(WORK);
		const entry = lines.find((e) => e.id === "2");
		expect(entry.message.provider).toBe("m3");
	});

	it("skips unflatten entirely when noUnflatten is set", async () => {
		const result = await repairSessionFile(WORK, {
			target: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
			noUnflatten: true,
		});

		expect(result.stats.unflattened).toBe(0);
		expect(result.stats.relabeled).toBe(4); // relabel still happens

		const lines = await loadLines(WORK);
		const leaked = lines.find((e) => e.id === "00000004");
		expect(leaked.message.content[0].type).toBe("text"); // left as leaked text
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
