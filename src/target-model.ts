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
}): { target: TargetModel; source: "current" | "explicit"; compat: CompatibilityResult } | undefined {
	// Explicit overrides take precedence
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
			compat: checkExplicitCompat(target, options.currentModel),
		};
	}

	// Fall back to current model
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

function checkExplicitCompat(target: TargetModel, currentModel?: Model<any>): CompatibilityResult {
	// If the explicit target matches the current model, we can use its compat info
	if (
		currentModel &&
		currentModel.provider === target.provider &&
		currentModel.api === target.api &&
		currentModel.id === target.model
	) {
		return checkModelCompat(currentModel);
	}

	// Otherwise we only know the API; empty-signature repair is only defined for anthropic-messages
	if (target.api !== "anthropic-messages") {
		return {
			compatible: false,
			reason: `Target API is "${target.api}". The signature/unflatten repair only applies to anthropic-messages models with allowEmptySignature.`,
		};
	}

	return {
		compatible: true,
		reason: "Target API is anthropic-messages, but compat.allowEmptySignature could not be verified because the model was specified explicitly.",
	};
}

function checkModelCompat(model: Model<any>): CompatibilityResult {
	if (model.api !== "anthropic-messages") {
		return {
			compatible: false,
			reason: `Current model API is "${model.api}". The signature/unflatten repair only applies to anthropic-messages models with allowEmptySignature.`,
		};
	}

	const compat = (model.compat ?? {}) as { allowEmptySignature?: boolean };
	if (compat.allowEmptySignature !== true) {
		return {
			compatible: false,
			reason: `Current model ${model.provider}/${model.id} does not have compat.allowEmptySignature=true.`,
		};
	}

	return {
		compatible: true,
		reason: `Current model ${model.provider}/${model.id} supports empty thinking signatures.`,
	};
}
