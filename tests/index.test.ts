import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import piM3FixExtension from "../src/index.ts";

const FIXTURE = resolve(import.meta.dirname, "fixture.jsonl");
const WORK = resolve(import.meta.dirname, "index-work.jsonl");

interface MockCtxOptions {
	sessionFile?: string;
	model?: { provider: string; api: string; id: string };
	hasUI?: boolean;
	selectReturn?: string | undefined;
	switchSessionResult?: { cancelled: boolean };
}

function makeCtx(options: MockCtxOptions = {}) {
	const notifications: Array<{ message: string; level: string }> = [];
	const logs: string[] = [];
	const errors: string[] = [];

	const originalLog = console.log;
	const originalError = console.error;
	console.log = (msg: string) => logs.push(msg);
	console.error = (msg: string) => errors.push(msg);

	let switchSessionArgs: any;
	const ctx: any = {
		sessionManager: {
			getSessionFile: () => options.sessionFile,
		},
		model: options.model,
		hasUI: options.hasUI ?? true,
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
			select: async () => options.selectReturn,
		},
		switchSession: vi.fn(async (path: string, opts: any) => {
			switchSessionArgs = { path, opts };
			const result = options.switchSessionResult ?? { cancelled: false };
			if (!result.cancelled && opts?.withSession) {
				await opts.withSession(ctx);
			}
			return result;
		}),
	};

	return {
		ctx,
		notifications,
		logs,
		errors,
		getSwitchSessionArgs: () => switchSessionArgs,
		restoreConsole: () => {
			console.log = originalLog;
			console.error = originalError;
		},
	};
}

function getHandler() {
	const commands: Array<{ name: string; handler: (args: string, ctx: any) => Promise<void> }> = [];
	const mockApi: any = {
		registerCommand: (name: string, options: any) => commands.push({ name, ...options }),
	};
	piM3FixExtension(mockApi);
	return commands[0].handler;
}

async function loadLines(path: string) {
	const raw = await readFile(path, "utf8");
	return raw.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
}

describe("m3fix command handler", () => {
	beforeEach(async () => {
		await copyFile(FIXTURE, WORK);
		if (existsSync(`${WORK}.bak2`)) await rm(`${WORK}.bak2`);
	});

	afterEach(async () => {
		if (existsSync(WORK)) await rm(WORK);
		if (existsSync(`${WORK}.bak2`)) await rm(`${WORK}.bak2`);
	});

	it("errors when no session file matches the query", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: undefined });
		await handler("/nonexistent/absolute/path.jsonl", ctx);
		restoreConsole();

		expect(notifications).toContainEqual({
			message: "No persisted session file matched the query.",
			level: "error",
		});
	});

	it("errors when the target model can't be resolved (no current model, no explicit target)", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: undefined, model: undefined });
		await handler(WORK, ctx);
		restoreConsole();

		expect(notifications).toContainEqual({
			message: "Could not resolve target model. Use --provider/--api/--model.",
			level: "error",
		});
	});

	it("refuses to modify the currently loaded session without --force-live", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: WORK });
		await handler(`${WORK} --provider m3 --api anthropic-messages --model MiniMax-M3`, ctx);
		restoreConsole();

		expect(notifications).toContainEqual({
			message: "Refusing to modify the currently loaded session file. Use --force-live, or /quit and run again.",
			level: "error",
		});
		// File must be untouched
		const after = await readFile(WORK, "utf8");
		const before = await readFile(FIXTURE, "utf8");
		expect(after).toBe(before);
	});

	it("repairs a non-live session file and reports stats", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: "/some/other/current.jsonl" });
		await handler(`${WORK} --provider m3 --api anthropic-messages --model MiniMax-M3`, ctx);
		restoreConsole();

		const summary = notifications.find((n) => n.message.startsWith("Did relabel"));
		expect(summary).toBeDefined();
		expect(summary!.level).toBe("info");

		const backupMsg = notifications.find((n) => n.message.startsWith("Backup:"));
		expect(backupMsg).toBeDefined();
		expect(existsSync(`${WORK}.bak2`)).toBe(true);

		// switchSession must never be called for a non-live file
		expect(ctx.switchSession).not.toHaveBeenCalled();
	});

	it("dry-run reports 'Would' and does not write", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: "/some/other/current.jsonl" });
		const before = await readFile(WORK, "utf8");

		await handler(`${WORK} --dry-run --provider m3 --api anthropic-messages --model MiniMax-M3`, ctx);
		restoreConsole();

		expect(notifications.some((n) => n.message.startsWith("Would relabel"))).toBe(true);
		const after = await readFile(WORK, "utf8");
		expect(after).toBe(before);
		expect(existsSync(`${WORK}.bak2`)).toBe(false);
	});

	it("reports 'warning' level when nothing needed to change", async () => {
		const handler = getHandler();
		// Target that exactly matches what's already on every entry -> no-op.
		await writeFile(
			WORK,
			[
				'{"type":"session","version":3,"id":"native","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}',
				'{"type":"message","id":"1","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}],"timestamp":1}}',
				'{"type":"message","id":"2","parentId":"1","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Native answer"}],"provider":"m3","api":"anthropic-messages","model":"MiniMax-M3","usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":2}}',
			].join("\n") + "\n",
			"utf8",
		);
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: "/some/other/current.jsonl" });
		await handler(`${WORK} --provider m3 --api anthropic-messages --model MiniMax-M3`, ctx);
		restoreConsole();

		const summary = notifications.find((n) => n.message.includes("relabel"));
		expect(summary?.level).toBe("warning");
	});

	it("reloads via switchSession when repairing the live session with --force-live", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: WORK });
		await handler(`${WORK} --force-live --provider m3 --api anthropic-messages --model MiniMax-M3`, ctx);
		restoreConsole();

		expect(ctx.switchSession).toHaveBeenCalledWith(WORK, expect.objectContaining({ withSession: expect.any(Function) }));
		expect(notifications.some((n) => n.message === "Session file repaired. Reloading from disk...")).toBe(true);
		expect(notifications.some((n) => n.message === "Repaired session reloaded.")).toBe(true);
	});

	it("warns when the session reload is cancelled", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({
			sessionFile: WORK,
			switchSessionResult: { cancelled: true },
		});
		await handler(`${WORK} --force-live --provider m3 --api anthropic-messages --model MiniMax-M3`, ctx);
		restoreConsole();

		expect(
			notifications.some((n) =>
				n.message.startsWith("Session reload was cancelled."),
			),
		).toBe(true);
	});

	it("uses ctx.model when no explicit target is given", async () => {
		const handler = getHandler();
		const { ctx, restoreConsole } = makeCtx({
			sessionFile: "/some/other/current.jsonl",
			model: { provider: "minimax", api: "anthropic-messages", id: "MiniMax-M3" },
		});
		await handler(WORK, ctx);
		restoreConsole();

		const lines = await loadLines(WORK);
		const entry = lines.find((e: any) => e.id === "00000004");
		expect(entry.message.provider).toBe("minimax");
	});

	it("falls back to console.log/console.error when hasUI is false", async () => {
		const handler = getHandler();
		const { ctx, logs, restoreConsole } = makeCtx({ sessionFile: undefined, hasUI: false });
		await handler("/nonexistent/absolute/path.jsonl", ctx);
		restoreConsole();

		expect(logs.some((l) => l.includes("No persisted session file matched the query."))).toBe(true);
	});

	it("catches thrown errors from bad args and notifies instead of crashing", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: WORK });
		await handler("--provider", ctx); // missing value -> parseCommandArgs throws
		restoreConsole();

		expect(notifications.some((n) => n.level === "error" && n.message.includes("m3fix failed"))).toBe(true);
	});

	it("catches thrown errors and logs via console.error when hasUI is false", async () => {
		const handler = getHandler();
		const { ctx, errors, restoreConsole } = makeCtx({ sessionFile: WORK, hasUI: false });
		await handler("--provider", ctx);
		restoreConsole();

		expect(errors.some((e) => e.includes("m3fix failed"))).toBe(true);
	});

	it("handles a non-Error throw (e.g. a plain string) via String(error)", async () => {
		const handler = getHandler();
		const { ctx, notifications, restoreConsole } = makeCtx({ sessionFile: WORK });
		ctx.sessionManager.getSessionFile = () => {
			// biome-ignore lint/style/noThrowNonException: deliberately testing the non-Error catch path
			throw "a plain string thrown, not an Error";
		};

		await handler("", ctx);
		restoreConsole();

		expect(
			notifications.some((n) => n.message === "m3fix failed: a plain string thrown, not an Error"),
		).toBe(true);
	});
});
