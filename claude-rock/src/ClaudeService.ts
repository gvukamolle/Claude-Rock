import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import type { CLIMessage, InitMessage, ResultMessage, ConversationMessage, CompactBoundaryMessage, ContentBlock, TextBlock, ToolUseBlock, ClaudePermissions, PendingMessage } from "./types";

export class ClaudeService extends EventEmitter {
	// Map of sessionId -> ChildProcess for parallel session support
	private processes: Map<string, ChildProcess> = new Map();
	// Map of sessionId -> CLI session ID (for --resume)
	private cliSessionIds: Map<string, string> = new Map();
	// Map of sessionId -> pending message (for background sessions)
	private pendingMessages: Map<string, PendingMessage> = new Map();
	private cliPath: string;
	private workingDir: string;
	private permissions: ClaudePermissions;
	private debug = true; // DEBUG MODE: Check DevTools for usage data

	// Rate limit detection patterns
	private readonly rateLimitPatterns = [
		/rate_limit_error/i,
		/would exceed your account's rate limit/i,
		/exceeded.*rate limit/i,
		/5-hour limit reached/i,
		/weekly limit reached/i,
		/limit reached.*resets/i,
		/usage limit reached/i
	];

	// Authentication error patterns
	private readonly authErrorPatterns = [
		/authenticate/i,
		/login/i,
		/unauthorized/i,
		/not logged in/i,
		/authentication required/i,
		/sign in/i
	];

	constructor(cliPath: string = "claude", workingDir: string = process.cwd()) {
		super();
		this.cliPath = cliPath;
		this.workingDir = workingDir;
		this.permissions = { webSearch: false, webFetch: false, task: false };
	}

	private log(...args: unknown[]): void {
		if (this.debug) {
			console.log("[ClaudeService]", ...args);
		}
	}

	setCliPath(path: string): void {
		this.cliPath = path;
	}

	setWorkingDir(dir: string): void {
		this.workingDir = dir;
	}

	setPermissions(permissions: ClaudePermissions): void {
		this.permissions = permissions;
		this.writePermissionsConfig();
	}

	private writePermissionsConfig(): void {
		const claudeDir = path.join(this.workingDir, ".claude");
		const configPath = path.join(claudeDir, "settings.json");

		// Build permissions config
		const allowRules: string[] = [
			// Always allow reading/editing Obsidian file types
			"Read(./**/*.md)",
			"Read(./**/*.canvas)",
			"Read(./**/*.base)",
			"Edit(./**/*.md)",
			"Edit(./**/*.canvas)",
			"Edit(./**/*.base)",
			"Write(./**/*.md)",
			"Write(./**/*.canvas)",
			"Write(./**/*.base)",
			"Delete(./**/*.md)",
			"Delete(./**/*.canvas)",
			"Delete(./**/*.base)"
		];

		// Optional permissions
		if (this.permissions.webSearch) {
			allowRules.push("WebSearch");
		}
		if (this.permissions.webFetch) {
			allowRules.push("WebFetch");
		}
		if (this.permissions.task) {
			allowRules.push("Task");
		}

		const denyRules: string[] = [
			// Always block dangerous operations
			"Bash",
			"Read(./.obsidian/**)",
			"Edit(./.obsidian/**)",
			"Write(./.obsidian/**)",
			"Delete(./.obsidian/**)",
			"Read(./.trash/**)",
			"Edit(./.trash/**)",
			"Write(./.trash/**)",
			"Delete(./.trash/**)"
		];

		const config = {
			permissions: {
				allow: allowRules,
				deny: denyRules
			}
		};

		try {
			// Create .claude directory if it doesn't exist
			if (!fs.existsSync(claudeDir)) {
				fs.mkdirSync(claudeDir, { recursive: true });
			}

			// Write config file
			fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
			this.log("Wrote permissions config to", configPath);
		} catch (err) {
			this.log("Failed to write permissions config:", err);
		}
	}

	async sendMessage(prompt: string, sessionId: string, cliSessionId?: string, model?: string): Promise<void> {
		// Abort existing process for this sessionId if any
		const existingProcess = this.processes.get(sessionId);
		if (existingProcess) {
			this.log(`Aborting existing process for session ${sessionId}`);
			this.abort(sessionId);
		}

		// Initialize pending message for this session
		this.pendingMessages.set(sessionId, { text: "", tools: [] });

		// Build args
		// Note: Extended thinking is activated via "ultrathink:" prompt prefix
		const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
		if (model) {
			args.push("--model", model);
		}
		if (cliSessionId) {
			args.push("--resume", cliSessionId);
		}

		this.log("Spawning:", this.cliPath, args, "for sessionId:", sessionId);

		// Set up environment for Electron
		const pathAdditions = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
		const homeDir = process.env.HOME || os.homedir();
		const env = {
			...process.env,
			PATH: pathAdditions.join(":") + ":" + (process.env.PATH || ""),
			HOME: homeDir,
			USER: process.env.USER || os.userInfo().username
		};

		const childProcess = spawn(this.cliPath, args, {
			cwd: this.workingDir,
			env,
			stdio: ["pipe", "pipe", "pipe"]
		});

		// Store process in map
		this.processes.set(sessionId, childProcess);

		// Close stdin immediately - this was the key fix!
		childProcess.stdin?.end();

		this.log("Process spawned, PID:", childProcess.pid, "for sessionId:", sessionId);

		let buffer = "";
		let accumulatedText = ""; // For streaming text accumulation

		// Handle stdout stream
		childProcess.stdout?.on("data", (chunk: Buffer) => {
			const chunkStr = chunk.toString();
			this.log("stdout chunk:", chunkStr.length, "bytes");
			buffer += chunkStr;

			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (line.trim()) {
					const result = this.parseLine(line, sessionId);
					if (result?.type === "text") {
						accumulatedText = result.text;
						// Update pending message
						const pending = this.pendingMessages.get(sessionId);
						if (pending) {
							pending.text = accumulatedText;
						}
						// Emit streaming text update with sessionId
						this.emit("streaming", { sessionId, text: accumulatedText });
					}
				}
			}
		});

		// Handle stderr
		childProcess.stderr?.on("data", (data: Buffer) => {
			const errorText = data.toString();
			this.log("stderr:", errorText);
			if (this.isAuthError(errorText)) {
				this.emit("error", { sessionId, error: "Authentication required. Run 'claude' in terminal to login." });
			}
		});

		// Handle errors
		childProcess.on("error", (err: Error) => {
			this.log("Process error:", err.message);
			this.emit("error", { sessionId, error: `Failed to start CLI: ${err.message}` });
			this.processes.delete(sessionId);
		});

		// Handle close
		childProcess.on("close", (code: number | null) => {
			this.log("Process closed with code:", code, "for sessionId:", sessionId);
			// Process remaining buffer
			if (buffer.trim()) {
				this.parseLine(buffer, sessionId);
			}
			this.emit("complete", { sessionId, code });
			this.processes.delete(sessionId);
		});
	}

	private parseLine(line: string, sessionId: string): { type: "text"; text: string } | null {
		this.log("Parsing:", line.substring(0, 80) + "...");
		try {
			const parsed = JSON.parse(line);

			// Check for direct API error (type: "error")
			if (parsed.type === "error" && parsed.error) {
				const errorType = parsed.error.type || "";
				const errorMsg = parsed.error.message || "";

				if (this.isRateLimitError(errorType) || this.isRateLimitError(errorMsg)) {
					const resetTime = this.parseResetTime(errorMsg);
					this.emit("rateLimitError", { sessionId, resetTime, message: errorMsg });
					return null;
				}

				this.emit("error", { sessionId, error: errorMsg });
				return null;
			}

			const msg = parsed as CLIMessage;
			return this.handleMessage(msg, sessionId);
		} catch {
			this.log("JSON parse error");
			return null;
		}
	}

	private isRateLimitError(text: string): boolean {
		return this.rateLimitPatterns.some(pattern => pattern.test(text));
	}

	private isAuthError(text: string): boolean {
		return this.authErrorPatterns.some(pattern => pattern.test(text));
	}

	private parseResetTime(message: string): string | null {
		const match = message.match(/resets?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*\([^)]+\))?)/i);
		return match?.[1]?.trim() || null;
	}

	private handleMessage(msg: CLIMessage, sessionId: string): { type: "text"; text: string } | null {
		switch (msg.type) {
			case "system": {
				const sysMsg = msg as InitMessage | CompactBoundaryMessage;
				if (sysMsg.subtype === "init") {
					this.cliSessionIds.set(sessionId, sysMsg.session_id);
					this.log("Init, cliSession:", sysMsg.session_id, "for sessionId:", sessionId);
					this.emit("init", { sessionId, cliSessionId: sysMsg.session_id });
				} else if (sysMsg.subtype === "compact_boundary") {
					const compactMsg = sysMsg as CompactBoundaryMessage;
					this.log("Compact boundary:", compactMsg.compact_metadata);
					this.emit("compact", {
						sessionId,
						trigger: compactMsg.compact_metadata.trigger,
						preTokens: compactMsg.compact_metadata.pre_tokens
					});
				}
				break;
			}

			case "assistant": {
				const convMsg = msg as ConversationMessage;

				// Emit tool_use events for each tool use block and store in pending
				const pending = this.pendingMessages.get(sessionId);
				for (const block of convMsg.message.content) {
					if (block.type === "tool_use") {
						this.log("Tool use:", block.name);
						const toolBlock = block as ToolUseBlock;
						if (pending) {
							pending.tools.push(toolBlock);
						}
						this.emit("toolUse", { sessionId, tool: toolBlock });
					}
				}

				const text = this.extractText(convMsg.message.content);
				this.log("Assistant text:", text.substring(0, 50));
				if (text) {
					this.emit("assistant", { sessionId, message: convMsg });
					return { type: "text", text };
				}
				break;
			}

			case "result": {
				const resultMsg = msg as ResultMessage;
				this.log("Result, is_error:", resultMsg.is_error);
				this.log("Result raw usage:", JSON.stringify(resultMsg.usage));

				// Check for rate limit in result message
				if (resultMsg.is_error && resultMsg.result && this.isRateLimitError(resultMsg.result)) {
					const resetTime = this.parseResetTime(resultMsg.result);
					this.emit("rateLimitError", { sessionId, resetTime, message: resultMsg.result });
					return null;
				}

				if (resultMsg.is_error) {
					this.emit("error", { sessionId, error: resultMsg.result });
				}
				this.emit("result", { sessionId, result: resultMsg });

				// Always emit context update (with defaults if no usage data)
				const usage = resultMsg.usage ?? {
					input_tokens: 0,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0
				};
				this.log("Usage (with defaults):", usage);
				this.emit("contextUpdate", { sessionId, usage });
				break;
			}
		}
		return null;
	}

	private extractText(content: ContentBlock[]): string {
		return content
			.filter((block): block is TextBlock => block.type === "text")
			.map(block => block.text)
			.join("");
	}

	abort(sessionId: string): void {
		const process = this.processes.get(sessionId);
		if (process) {
			process.kill("SIGTERM");
			this.processes.delete(sessionId);
			this.emit("complete", { sessionId, code: null });
		}
	}

	abortAll(): void {
		for (const [sessionId, process] of this.processes) {
			process.kill("SIGTERM");
			this.emit("complete", { sessionId, code: null });
		}
		this.processes.clear();
		this.cliSessionIds.clear();
		this.pendingMessages.clear();
	}

	getCliSessionId(sessionId: string): string | null {
		return this.cliSessionIds.get(sessionId) || null;
	}

	isRunning(sessionId: string): boolean {
		return this.processes.has(sessionId);
	}

	hasAnyRunning(): boolean {
		return this.processes.size > 0;
	}

	clearSession(sessionId: string): void {
		this.cliSessionIds.delete(sessionId);
		this.pendingMessages.delete(sessionId);
	}

	getPendingMessage(sessionId: string): PendingMessage | null {
		return this.pendingMessages.get(sessionId) || null;
	}

	clearPendingMessage(sessionId: string): void {
		this.pendingMessages.delete(sessionId);
	}
}
