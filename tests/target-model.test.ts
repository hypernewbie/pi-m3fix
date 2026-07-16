import { describe, it, expect } from "vitest";
import { resolveTargetModel } from "../src/target-model.ts";

function model(overrides: Partial<{ provider: string; api: string; id: string }> = {}) {
	return {
		provider: "minimax",
		api: "anthropic-messages",
		id: "MiniMax-M3",
		...overrides,
	} as any;
}

describe("resolveTargetModel", () => {
	it("resolves an explicit target with no current model", () => {
		const result = resolveTargetModel({
			currentModel: undefined,
			explicit: { provider: "minimax", api: "anthropic-messages", model: "MiniMax-M3" },
		});
		expect(result?.source).toBe("explicit");
		expect(result?.target).toEqual({ provider: "minimax", api: "anthropic-messages", model: "MiniMax-M3" });
	});

	it("resolves an explicit target on a non-anthropic-messages API (openai-completions, openai-responses, etc.)", () => {
		// No API gate: M3 can be proxied through any API. The leak-pattern
		// unflatten and signature blanking are API-agnostic (see repair.ts).
		const result = resolveTargetModel({
			explicit: { provider: "minimax", api: "openai-completions", model: "MiniMax-M3" },
		});
		expect(result?.target.api).toBe("openai-completions");
	});

	it("fills in unspecified explicit fields from the current model", () => {
		const result = resolveTargetModel({
			currentModel: model(),
			explicit: { provider: "minimax" },
		});
		expect(result?.target).toEqual({ provider: "minimax", api: "anthropic-messages", model: "MiniMax-M3" });
	});

	it("resolves the current model when no explicit target is given", () => {
		const result = resolveTargetModel({ currentModel: model({ api: "openai-responses" }) });
		expect(result?.source).toBe("current");
		expect(result?.target).toEqual({ provider: "minimax", api: "openai-responses", model: "MiniMax-M3" });
	});

	it("returns undefined when nothing can be resolved", () => {
		const result = resolveTargetModel({});
		expect(result).toBeUndefined();
	});

	it("returns undefined when explicit target is missing required fields and there's no current model to fill them in", () => {
		const result = resolveTargetModel({ explicit: { provider: "minimax" } });
		expect(result).toBeUndefined();
	});

	it("fills in provider and model from the current model when only api is given explicitly", () => {
		const result = resolveTargetModel({
			currentModel: model({ provider: "minimax", model: undefined as any }),
			explicit: { api: "openai-completions" },
		});
		expect(result?.target).toEqual({ provider: "minimax", api: "openai-completions", model: "MiniMax-M3" });
	});

	it("fills in provider and api from the current model when only model is given explicitly", () => {
		const result = resolveTargetModel({
			currentModel: model(),
			explicit: { model: "MiniMax-M3-turbo" },
		});
		expect(result?.target).toEqual({ provider: "minimax", api: "anthropic-messages", model: "MiniMax-M3-turbo" });
	});

	it("returns undefined when an explicit field is given but the current model can't fill the rest", () => {
		const result = resolveTargetModel({ explicit: { api: "anthropic-messages" } });
		expect(result).toBeUndefined();
	});
});
