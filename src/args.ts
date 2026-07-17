export interface M3FixOptions {
	query?: string;
	dryRun: boolean;
	forceLive: boolean;
	noRelabel: boolean;
	noUnflatten: boolean;
	noSyntheticThinking: boolean;
	rewrite: boolean;
	noSign: boolean;
	allowEmptySignature: boolean;
	target?: {
		provider?: string;
		api?: string;
		model?: string;
	};
}

const TARGET_FLAGS = new Set(["--provider", "--api", "--model"]);

export function parseCommandArgs(input: string): M3FixOptions {
	const options: M3FixOptions = {
		dryRun: false,
		forceLive: false,
		noRelabel: false,
		noUnflatten: false,
		noSyntheticThinking: false,
		rewrite: false,
		noSign: false,
		allowEmptySignature: false,
	};

	const positional: string[] = [];
	const tokens = tokenize(input);

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "--dry-run" || token === "-n") {
			options.dryRun = true;
		} else if (token === "--force-live") {
			options.forceLive = true;
		} else if (token === "--no-relabel") {
			options.noRelabel = true;
		} else if (token === "--no-unflatten") {
			options.noUnflatten = true;
		} else if (token === "--no-synthetic-thinking") {
			options.noSyntheticThinking = true;
		} else if (token === "--rewrite") {
			options.rewrite = true;
		} else if (token === "--no-sign") {
			options.noSign = true;
		} else if (token === "--allow-empty-signature") {
			options.allowEmptySignature = true;
		} else if (TARGET_FLAGS.has(token)) {
			const value = tokens[++i];
			if (value === undefined) {
				throw new Error(`Missing value for ${token}`);
			}
			options.target ??= {};
			if (token === "--provider") options.target.provider = value;
			if (token === "--api") options.target.api = value;
			if (token === "--model") options.target.model = value;
		} else if (token.startsWith("-")) {
			throw new Error(`Unknown flag: ${token}`);
		} else {
			positional.push(token);
		}
	}

	if (positional.length > 1) {
		throw new Error("Expected at most one positional argument (session UUID or path)");
	}
	options.query = positional[0];

	return options;
}

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuotes = false;
	let quoteChar = "";

	for (const char of input) {
		if (inQuotes) {
			if (char === quoteChar) {
				inQuotes = false;
				tokens.push(current);
				current = "";
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			inQuotes = true;
			quoteChar = char;
		} else if (/\s/.test(char)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}

	if (current.length > 0) {
		tokens.push(current);
	}

	return tokens;
}
