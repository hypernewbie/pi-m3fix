import type { Model } from "@earendil-works/pi-ai";

export interface TargetModel {
	provider: string;
	api: string;
	model: string;
}

/**
 * Resolve the relabel/repair target. No API-based compatibility gate: M3 (and
 * any model that leaks flattened reasoning) can be proxied through any of
 * Pi's supported APIs (anthropic-messages, openai-completions,
 * openai-responses, etc.) - `thinkingSignature` is a generic concept across
 * all of them (Pi's own schema notes it doubles as an OpenAI Responses
 * reasoning-item id), and the leak-pattern detection in repair.ts is pure
 * text matching, unaffected by API. Gating this on api === "anthropic-messages"
 * was the reason /m3fix did nothing at all for a session where the M3 traffic
 * runs over an OpenAI-compatible endpoint.
 */
export function resolveTargetModel(options: {
	currentModel?: Model<any>;
	explicit?: { provider?: string; api?: string; model?: string };
}): { target: TargetModel; source: "current" | "explicit" } | undefined {
	if (options.explicit && (options.explicit.provider || options.explicit.api || options.explicit.model)) {
		const target: TargetModel = {
			provider: options.explicit.provider ?? options.currentModel?.provider ?? "",
			api: options.explicit.api ?? options.currentModel?.api ?? "",
			model: options.explicit.model ?? options.currentModel?.id ?? "",
		};

		if (!target.provider || !target.api || !target.model) {
			return undefined;
		}

		return { target, source: "explicit" };
	}

	const model = options.currentModel;
	if (!model) {
		return undefined;
	}

	return {
		target: { provider: model.provider, api: model.api, model: model.id },
		source: "current",
	};
}
