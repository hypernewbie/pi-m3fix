import type { Model } from "@earendil-works/pi-ai";

export interface TargetModel {
	provider: string;
	api: string;
	model: string;
}

export interface CompatibilityResult {
	compatible: boolean;
	reason: string;
}

export function resolveTargetModel(options: {
	currentModel?: Model<any>;
	explicit?: { provider?: string; api?: string; model?: string };
	forceAllowEmptySignature?: boolean;
}): { target: TargetModel; source: "current" | "explicit"; compat: CompatibilityResult } | undefined {
	if (options.forceAllowEmptySignature) {
		const target = resolveTarget(options);
		if (!target) return undefined;
		return {
			target: target.value,
			source: target.source,
			compat: {
				compatible: true,
				reason: "--allow-empty-signature forced the repair regardless of compat metadata.",
			},
		};
	}

	// Explicit overrides take precedence. If the caller explicitly names a target,
	// trust them the same way underp.py does: don't gate on registry metadata that
	// may not exist for custom/proxy providers.
	if (options.explicit && (options.explicit.provider || options.explicit.api || options.explicit.model)) {
		const target: TargetModel = {
			provider: options.explicit.provider ?? options.currentModel?.provider ?? "",
			api: options.explicit.api ?? options.currentModel?.api ?? "",
			model: options.explicit.model ?? options.currentModel?.id ?? "",
		};

		if (!target.provider || !target.api || !target.model) {
			return undefined;
		}

		return {
			target,
			source: "explicit",
			compat: checkExplicitCompat(target),
		};
	}

	// Fall back to current model, and require registry-confirmed compat since we
	// have no explicit instruction from the caller.
	const model = options.currentModel;
	if (!model) {
		return undefined;
	}

	const target: TargetModel = {
		provider: model.provider,
		api: model.api,
		model: model.id,
	};

	return {
		target,
		source: "current",
		compat: checkModelCompat(model),
	};
}

function resolveTarget(options: {
	currentModel?: Model<any>;
	explicit?: { provider?: string; api?: string; model?: string };
}): { value: TargetModel; source: "current" | "explicit" } | undefined {
	if (options.explicit && (options.explicit.provider || options.explicit.api || options.explicit.model)) {
		const target: TargetModel = {
			provider: options.explicit.provider ?? options.currentModel?.provider ?? "",
			api: options.explicit.api ?? options.currentModel?.api ?? "",
			model: options.explicit.model ?? options.currentModel?.id ?? "",
		};
		if (!target.provider || !target.api || !target.model) return undefined;
		return { value: target, source: "explicit" };
	}

	const model = options.currentModel;
	if (!model) return undefined;
	return {
		value: { provider: model.provider, api: model.api, model: model.id },
		source: "current",
	};
}

function checkExplicitCompat(target: TargetModel): CompatibilityResult {
	// We only know the API string here; empty-signature repair is only defined for
	// anthropic-messages. Registry compat metadata is not consulted for explicit
	// targets because custom/proxy providers frequently omit it even when the
	// backend tolerates empty signatures. Use --no-unflatten to opt out.
	if (target.api !== "anthropic-messages") {
		return {
			compatible: false,
			reason: `Target API is "${target.api}". The signature/unflatten repair only applies to anthropic-messages models.`,
		};
	}

	return {
		compatible: true,
		reason: "Target API is anthropic-messages. Explicit target trusted; pass --no-unflatten to skip signature/unflatten repair.",
	};
}

function checkModelCompat(model: Model<any>): CompatibilityResult {
	if (model.api !== "anthropic-messages") {
		return {
			compatible: false,
			reason: `Current model API is "${model.api}". The signature/unflatten repair only applies to anthropic-messages models.`,
		};
	}

	const compat = (model.compat ?? {}) as { allowEmptySignature?: boolean };
	if (compat.allowEmptySignature !== true) {
		return {
			compatible: false,
			reason: `Current model ${model.provider}/${model.id} does not have compat.allowEmptySignature=true. Pass --allow-empty-signature to force the repair anyway.`,
		};
	}

	return {
		compatible: true,
		reason: `Current model ${model.provider}/${model.id} supports empty thinking signatures.`,
	};
}
