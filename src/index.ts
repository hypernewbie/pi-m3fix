import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseCommandArgs } from "./args.ts";
import { findSessionFiles } from "./session-find.ts";
import { resolveTargetModel } from "./target-model.ts";
import { repairSessionFile } from "./repair.ts";

export default function piM3FixExtension(pi: ExtensionAPI) {
	pi.registerCommand("m3fix", {
		description: "Repair flattened reasoning blocks in a Pi session JSONL file",
		handler: async (args, ctx) => {
			try {
				await runM3Fix(args, ctx);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) {
					ctx.ui.notify(`m3fix failed: ${message}`, "error");
				} else {
					console.error(`m3fix failed: ${message}`);
				}
			}
		},
	});
}

async function runM3Fix(args: string, ctx: ExtensionCommandContext) {
	const options = parseCommandArgs(args);
	const currentSessionFile = ctx.sessionManager.getSessionFile();

	const matches = await findSessionFiles({
		query: options.query,
		currentSessionFile,
	});

	if (matches.length === 0) {
		notify(ctx, "No persisted session file matched the query.", "error");
		return;
	}

	let selectedFile: string;
	if (matches.length === 1) {
		selectedFile = matches[0].file;
	} else if (ctx.hasUI) {
		const choice = await ctx.ui.select(
			"Multiple sessions matched. Pick one:",
			matches.map((m) => m.file),
		);
		if (!choice) {
			notify(ctx, "No session selected.", "warning");
			return;
		}
		selectedFile = choice;
	} else {
		notify(ctx, `Multiple sessions matched: ${matches.map((m) => m.file).join(", ")}`, "error");
		return;
	}

	const resolved = resolveTargetModel({
		currentModel: ctx.model,
		explicit: options.target,
	});

	if (!resolved) {
		notify(ctx, "Could not resolve target model. Use --provider/--api/--model.", "error");
		return;
	}

	const { target } = resolved;

	// Safety: refuse to modify the currently loaded session unless forced
	if (selectedFile === currentSessionFile && !options.forceLive) {
		notify(
			ctx,
			"Refusing to modify the currently loaded session file. Use --force-live, or /quit and run again.",
			"error",
		);
		return;
	}

	const result = await repairSessionFile(selectedFile, {
		target,
		dryRun: options.dryRun,
		noRelabel: options.noRelabel,
		noUnflatten: options.noUnflatten,
		noSyntheticThinking: options.noSyntheticThinking,
		rewrite: options.rewrite,
		noSign: options.noSign,
	});

	const mode = options.dryRun ? "Would" : "Did";
	notify(
		ctx,
		`${mode} relabel ${result.stats.relabeled}, blank ${result.stats.blanked}, unflatten ${result.stats.unflattened} blocks, neutralize ${result.stats.neutralizedRedacted} foreign-redacted blocks, insert ${result.stats.syntheticThinking} synthetic thinking blocks, sign ${result.stats.signed} blocks (${result.stats.activeAssistantTurns} turns).`,
		result.changed ? "info" : "warning",
	);

	if (result.backupPath) {
		notify(ctx, `Backup: ${result.backupPath}`, "info");
	}

	if (!options.dryRun && result.changed && selectedFile === currentSessionFile) {
		notify(ctx, "Session file repaired. Reloading from disk...", "info");
		const switchResult = await ctx.switchSession(selectedFile, {
			withSession: async (newCtx) => {
				notify(newCtx, "Repaired session reloaded.", "info");
			},
		});
		if (switchResult.cancelled) {
			notify(ctx, "Session reload was cancelled. /quit and re-run pi, or /resume to load the repaired file.", "warning");
		}
	}
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error") {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	} else {
		console.log(`[${level}] ${message}`);
	}
}
