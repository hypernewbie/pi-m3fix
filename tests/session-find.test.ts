import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSessionFile, findSessionFiles } from "../src/session-find.ts";

let root: string;
let sessionA: string;
let sessionB: string;
let sessionNamed: string;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "m3fix-session-find-"));

	sessionA = join(root, "2026-01-01T00-00-00-000Z_aaaaaaaa-1111-2222-3333-444444444444.jsonl");
	await writeFile(
		sessionA,
		'{"type":"session","version":3,"id":"aaaaaaaa-1111-2222-3333-444444444444","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp/project-a"}\n',
		"utf8",
	);

	sessionB = join(root, "2026-01-02T00-00-00-000Z_bbbbbbbb-1111-2222-3333-444444444444.jsonl");
	await writeFile(
		sessionB,
		'{"type":"session","version":3,"id":"bbbbbbbb-1111-2222-3333-444444444444","timestamp":"2026-01-02T00:00:00.000Z","cwd":"/tmp/project-b"}\n',
		"utf8",
	);

	sessionNamed = join(root, "2026-01-03T00-00-00-000Z_cccccccc-1111-2222-3333-444444444444.jsonl");
	await writeFile(
		sessionNamed,
		[
			'{"type":"session","version":3,"id":"cccccccc-1111-2222-3333-444444444444","timestamp":"2026-01-03T00:00:00.000Z","cwd":"/tmp/project-c"}',
			'{"type":"session_info","id":"info1","parentId":null,"timestamp":"2026-01-03T00:00:01.000Z","name":"Refactor auth module"}',
		].join("\n") + "\n",
		"utf8",
	);
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("findSessionFiles", () => {
	it("returns the current session file when no query is given", async () => {
		const results = await findSessionFiles({ currentSessionFile: "/some/current.jsonl" });
		expect(results).toEqual([{ file: "/some/current.jsonl", matchedBy: "current" }]);
	});

	it("returns nothing when there's no query and no current session", async () => {
		const results = await findSessionFiles({});
		expect(results).toEqual([]);
	});

	it("matches an absolute path that exists on disk", async () => {
		const results = await findSessionFiles({ query: sessionA });
		expect(results).toEqual([{ file: sessionA, matchedBy: "path" }]);
	});

	it("matches by partial session id across the sessions root", async () => {
		const results = await findSessionFiles({ query: "aaaaaaaa", sessionsRoot: root });
		expect(results).toEqual([{ file: sessionA, matchedBy: "search" }]);
	});

	it("matches multiple sessions when the query is ambiguous", async () => {
		const results = await findSessionFiles({ query: "1111-2222-3333-444444444444", sessionsRoot: root });
		const files = results.map((r) => r.file).sort();
		expect(files).toEqual([sessionA, sessionB, sessionNamed].sort());
		expect(results.every((r) => r.matchedBy === "search")).toBe(true);
	});

	it("matches by filename substring (case-insensitive)", async () => {
		const results = await findSessionFiles({ query: "2026-01-02", sessionsRoot: root });
		expect(results).toEqual([{ file: sessionB, matchedBy: "search" }]);
	});

	it("returns nothing when the query matches no session and no path", async () => {
		const results = await findSessionFiles({ query: "totally-unrelated-query", sessionsRoot: root });
		expect(results).toEqual([]);
	});

	it("matches by user-defined session name (session_info entry), case-insensitively", async () => {
		const results = await findSessionFiles({ query: "REFACTOR AUTH", sessionsRoot: root });
		expect(results).toEqual([{ file: sessionNamed, matchedBy: "search" }]);
	});
});

describe("findSessionFile", () => {
	it("returns the first match", async () => {
		const result = await findSessionFile({ query: "aaaaaaaa", sessionsRoot: root });
		expect(result).toEqual({ file: sessionA, matchedBy: "search" });
	});

	it("returns undefined when nothing matches", async () => {
		const result = await findSessionFile({ query: "nope", sessionsRoot: root });
		expect(result).toBeUndefined();
	});
});
