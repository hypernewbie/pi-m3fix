import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

const EXTENSION_PATH = resolve(import.meta.dirname, "../src/index.ts");

describe("extension entry point", () => {
	it("exports a default factory function", async () => {
		const mod = await import(EXTENSION_PATH);
		expect(typeof mod.default).toBe("function");
	});

	it("registers the m3fix command", async () => {
		const mod = await import(EXTENSION_PATH);
		const commands: Array<{ name: string; description?: string; handler: unknown }> = [];
		const mockApi = {
			registerCommand: (name: string, options: { description?: string; handler: unknown }) => {
				commands.push({ name, ...options });
			},
			registerFlag: () => {},
			getFlag: () => false,
			on: () => {},
		};
		mod.default(mockApi as any);

		expect(commands).toHaveLength(1);
		expect(commands[0].name).toBe("m3fix");
		expect(commands[0].description).toContain("Repair flattened reasoning");
		expect(typeof commands[0].handler).toBe("function");
	});

	it("registers the live auto-fix flag and message_end handler", async () => {
		const mod = await import(EXTENSION_PATH);
		const flags: string[] = [];
		const events: string[] = [];
		const mockApi = {
			registerCommand: () => {},
			registerFlag: (name: string) => flags.push(name),
			getFlag: () => false,
			on: (event: string) => events.push(event),
		};
		mod.default(mockApi as any);

		expect(flags).toContain("m3fix-no-live");
		expect(events).toContain("message_end");
	});
});
