import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export interface SessionFindOptions {
	query?: string;
	currentSessionFile?: string;
	/** Override the sessions root directory searched for partial-match queries. Test-only hook; defaults to Pi's real sessions directory. */
	sessionsRoot?: string;
}

export interface SessionFindResult {
	file: string;
	matchedBy: "current" | "path" | "search";
}

export async function findSessionFile(options: SessionFindOptions): Promise<SessionFindResult | undefined> {
	const results = await findSessionFiles(options);
	return results[0];
}

export async function findSessionFiles(options: SessionFindOptions): Promise<SessionFindResult[]> {
	// No query -> current session file
	if (!options.query) {
		if (!options.currentSessionFile) {
			return [];
		}
		return [{ file: options.currentSessionFile, matchedBy: "current" }];
	}

	// Absolute path
	const resolved = resolve(options.query);
	if (existsSync(resolved)) {
		return [{ file: resolved, matchedBy: "path" }];
	}

	// Search by partial UUID / filename across all sessions
	const sessions = await SessionManager.listAll(options.sessionsRoot);
	const query = options.query.toLowerCase();

	return sessions
		.filter((session) => {
			const file = session.path.toLowerCase();
			const id = session.id?.toLowerCase() ?? "";
			const name = session.name?.toLowerCase() ?? "";
			return file.includes(query) || id.includes(query) || name.includes(query);
		})
		.map((session) => ({ file: session.path, matchedBy: "search" as const }));
}
