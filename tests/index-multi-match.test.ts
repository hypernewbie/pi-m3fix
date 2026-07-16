import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURE = resolve(import.meta.dirname, "fixture.jsonl");
const WORK_A = resolve(import.meta.dirname, "multi-match-a.jsonl");
const WORK_B = resolve(import.meta.dirname, "multi-match-b.jsonl");

// Mock session-find so the "multiple sessions matched" branch in index.ts is
// reachable deterministically, without touching the real ~/.pi/agent/sessions
// directory (which is what a genuinely ambiguous search query would hit).
vi.mock("../src/session-find.ts", () => ({
	findSessionFiles: vi.fn(async () => [
		{ file: WORK_A, matchedBy: "search" as const },
		{ file: WORK_B, matchedBy: "search" as const },
	]),
}));

const piM3FixExtension = (await import("../src/index.ts")).default;

function makeCtx(options: { hasUI: boolean; selectReturn?: string | undefined }) {
	const notifications: Array<{ message: string; level: string }> = [];
	const ctx: any = {
		sessionManager: { getSessionFile: () => undefined },
		model: { provider: "minimax", api: "anthropic-messages", id: "MiniMax-M3" },
		hasUI: options.hasUI,
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
			select: async () => options.selectReturn,
		},
		switchSession: vi.fn(),
	};
	return { ctx, notifications };
}

function getHandler() {
	const commands: Array<{ name: string; handler: (args: string, ctx: any) => Promise<void> }> = [];
	const mockApi: any = {
		registerCommand: (name: string, options: any) => commands.push({ name, ...options }),
	};
	piM3FixExtension(mockApi);
	return commands[0].handler;
}

describe("m3fix command handler - multiple session matches", () => {
	beforeEach(async () => {
		await copyFile(FIXTURE, WORK_A);
		await copyFile(FIXTURE, WORK_B);
	});

	afterEach(async () => {
		for (const f of [WORK_A, WORK_B, `${WORK_A}.bak2`, `${WORK_B}.bak2`]) {
			if (existsSync(f)) await rm(f);
		}
	});

	it("shows a selector when hasUI is true, and repairs the chosen file", async () => {
		const handler = getHandler();
		const { ctx, notifications } = makeCtx({ hasUI: true, selectReturn: WORK_B });

		await handler("ambiguous-query --dry-run", ctx);

		expect(notifications.some((n) => n.message.startsWith("Would relabel"))).toBe(true);
	});

	it("warns and stops when hasUI is true but the user cancels the selector", async () => {
		const handler = getHandler();
		const { ctx, notifications } = makeCtx({ hasUI: true, selectReturn: undefined });

		await handler("ambiguous-query", ctx);

		expect(notifications).toContainEqual({ message: "No session selected.", level: "warning" });
	});

	it("errors listing all matches when hasUI is false (no selector available)", async () => {
		// hasUI=false routes through console.log/console.error, not ctx.ui.notify.
		const handler = getHandler();
		const { ctx } = makeCtx({ hasUI: false });
		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => logs.push(msg);

		try {
			await handler("ambiguous-query", ctx);
		} finally {
			console.log = originalLog;
		}

		const match = logs.find((l) => l.includes("Multiple sessions matched:"));
		expect(match).toBeDefined();
		expect(match).toContain(WORK_A);
		expect(match).toContain(WORK_B);
	});
});
