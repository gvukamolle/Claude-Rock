import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface CLIDetectionResult {
	found: boolean;
	path: string;
	method: "which" | "explicit" | "default";
}

export interface CLIStatusResult {
	installed: boolean;
	version?: string;
	error?: string;
}

/**
 * Returns candidate paths to check based on OS
 */
function getCandidatePaths(): string[] {
	const homeDir = os.homedir();
	const platform = process.platform;

	switch (platform) {
		case "darwin": // macOS
			return [
				"/usr/local/bin/claude",
				"/opt/homebrew/bin/claude",
				path.join(homeDir, ".npm/bin/claude"),
				path.join(homeDir, ".nvm/versions/node"),  // NVM - will check subdirs
			];
		case "win32": // Windows
			const appData = process.env.APPDATA || path.join(homeDir, "AppData/Roaming");
			return [
				path.join(appData, "npm/claude.cmd"),
				"C:\\Program Files\\nodejs\\claude.cmd",
			];
		case "linux":
			return [
				"/usr/local/bin/claude",
				"/usr/bin/claude",
				path.join(homeDir, ".npm/bin/claude"),
				path.join(homeDir, ".nvm/versions/node"),  // NVM - will check subdirs
			];
		default:
			return [];
	}
}

/**
 * Checks if file exists, with NVM directory support
 */
function findExecutable(candidatePath: string): string | null {
	// NVM directory - search for claude in subdirs
	if (candidatePath.includes(".nvm/versions/node") && !candidatePath.includes("bin/claude")) {
		try {
			if (fs.existsSync(candidatePath)) {
				const versions = fs.readdirSync(candidatePath);
				for (const version of versions.reverse()) {  // Check newer versions first
					const claudePath = path.join(candidatePath, version, "bin/claude");
					if (fs.existsSync(claudePath)) {
						return claudePath;
					}
				}
			}
		} catch {
			return null;
		}
		return null;
	}

	return fs.existsSync(candidatePath) ? candidatePath : null;
}

/**
 * Tries to find CLI via which/where command
 */
function findViaWhich(): string | null {
	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const result = execSync(`${cmd} claude`, {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"]
		}).trim();
		const firstLine = result.split("\n")[0];
		return firstLine || null;
	} catch {
		return null;
	}
}

/**
 * Auto-detects path to Claude CLI
 */
export function detectCLIPath(): CLIDetectionResult {
	// 1. Try which/where first
	const whichPath = findViaWhich();
	if (whichPath) {
		return {
			found: true,
			path: whichPath,
			method: "which"
		};
	}

	// 2. Check known paths
	for (const candidatePath of getCandidatePaths()) {
		const resolvedPath = findExecutable(candidatePath);
		if (resolvedPath) {
			return {
				found: true,
				path: resolvedPath,
				method: "explicit"
			};
		}
	}

	// 3. Return default
	return {
		found: false,
		path: "claude",
		method: "default"
	};
}

/**
 * Checks if CLI is installed and returns version (async)
 */
export async function checkCLIInstalled(cliPath: string): Promise<CLIStatusResult> {
	return new Promise((resolve) => {
		// Extend PATH for spawn like ClaudeService does
		const pathAdditions = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
		const homeDir = process.env.HOME || os.homedir();
		const env = {
			...process.env,
			PATH: pathAdditions.join(":") + ":" + (process.env.PATH || ""),
			HOME: homeDir,
		};

		const proc = spawn(cliPath, ["--version"], {
			timeout: 10000,
			stdio: ["pipe", "pipe", "pipe"],
			env
		});

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (code === 0 && stdout.trim()) {
				// Extract version from output (e.g., "claude-code 2.1.1")
				const versionMatch = stdout.trim().match(/(\d+\.\d+\.\d+)/);
				resolve({
					installed: true,
					version: versionMatch ? versionMatch[1] : stdout.trim().split("\n")[0]
				});
			} else {
				resolve({
					installed: false,
					error: stderr.trim() || "CLI not found or not executable"
				});
			}
		});

		proc.on("error", (err) => {
			resolve({
				installed: false,
				error: err.message
			});
		});
	});
}
