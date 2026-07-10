import { describe, it, expect } from "vitest";
import { resolveTargetModel } from "../src/target-model.ts";

function model(overrides: Partial<{ provider: string; api: string; id: string; compat: any }> = {}) {
	return {
		provider: "m3",
		api: "anthropic-messages",
		id: "MiniMax-M3",
		compat: undefined,
		...overrides,
	} as any;
}

describe("resolveTargetModel", () => {
	it("trusts an explicit target even when compat metadata is unknown (underp.py parity)", () => {
		const result = resolveTargetModel({
			currentModel: undefined,
			explicit: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});
		expect(result?.compat.compatible).toBe(true);
	});

	it("trusts an explicit target that exactly matches the current model even without compat metadata", () => {
		const result = resolveTargetModel({
			currentModel: model({ compat: undefined }),
			explicit: { provider: "m3", api: "anthropic-messages", model: "MiniMax-M3" },
		});
		expect(result?.compat.compatible).toBe(true);
	});

	it("refuses an explicit non-anthropic-messages target", () => {
		const result = resolveTargetModel({
			explicit: { provider: "openai", api: "openai-completions", model: "gpt-5" },
		});
		expect(result?.compat.compatible).toBe(false);
	});

	it("requires proven compat.allowEmptySignature when relying on the current model with no explicit target", () => {
		const result = resolveTargetModel({
			currentModel: model({ compat: undefined }),
		});
		expect(result?.compat.compatible).toBe(false);
	});

	it("allows the current model when compat.allowEmptySignature is explicitly true", () => {
		const result = resolveTargetModel({
			currentModel: model({ compat: { allowEmptySignature: true } }),
		});
		expect(result?.compat.compatible).toBe(true);
	});

	it("--allow-empty-signature forces compatibility regardless of registry metadata", () => {
		const result = resolveTargetModel({
			currentModel: model({ compat: undefined }),
			forceAllowEmptySignature: true,
		});
		expect(result?.compat.compatible).toBe(true);
	});
});
