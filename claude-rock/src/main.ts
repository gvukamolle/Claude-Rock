import { Plugin, FileSystemAdapter, Menu, Editor, MarkdownView } from "obsidian";
import { ClaudeChatView, CLAUDE_VIEW_TYPE } from "./ChatView";
import { ClaudeService } from "./ClaudeService";
import { ClaudeRockSettingTab } from "./settings";
import type { ClaudeRockSettings, ChatSession, PluginData } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { SYSTEM_PROMPTS, type LanguageCode } from "./systemPrompts";
import { detectCLIPath } from "./cliDetector";

const MAX_SESSIONS = 20;

export default class ClaudeRockPlugin extends Plugin {
	settings: ClaudeRockSettings;
	claudeService: ClaudeService;
	sessions: ChatSession[] = [];
	currentSessionId: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Initialize Claude service with vault path as working directory
		const vaultPath = this.app.vault.adapter instanceof FileSystemAdapter
			? this.app.vault.adapter.getBasePath()
			: process.cwd();
		this.claudeService = new ClaudeService(this.settings.cliPath, vaultPath);
		this.claudeService.setPermissions(this.settings.permissions);

		// Ensure CLAUDE.md exists in vault root
		await this.ensureClaudeMd();

		// Register the chat view (check if already registered for hot reload)
		// @ts-ignore - viewRegistry is not in public API but exists
		const viewRegistry = this.app.viewRegistry;
		if (!viewRegistry?.typeByExtension?.[CLAUDE_VIEW_TYPE] && !viewRegistry?.viewByType?.[CLAUDE_VIEW_TYPE]) {
			this.registerView(
				CLAUDE_VIEW_TYPE,
				(leaf) => new ClaudeChatView(leaf, this)
			);
		} else {
			console.log("Claude Rock: View type already registered (hot reload)");
		}

		// Add ribbon icon to open chat
		this.addRibbonIcon("mountain", "Open Claude Rock", () => {
			this.activateView();
		});

		// Add command to open chat
		this.addCommand({
			id: "open-claude-rock-chat",
			name: "Open chat",
			callback: () => this.activateView()
		});

		// Add command to start new chat
		this.addCommand({
			id: "new-claude-rock-chat",
			name: "New chat",
			callback: async () => {
				await this.activateView();
			}
		});

		// Add settings tab
		this.addSettingTab(new ClaudeRockSettingTab(this.app, this));

		// Add context menu item to mention selected text in chat
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (selection && selection.trim().length > 0) {
					menu.addItem((item) => {
						item.setTitle("Claude Rock: Упомянуть при запросе")
							.setIcon("text-cursor")
							.onClick(() => {
								// Get cursor positions for precise replacement later
								const from = editor.getCursor("from");
								const to = editor.getCursor("to");
								const filePath = view.file?.path || "";

								this.mentionSelectedText(selection, view.file?.basename || "Editor", {
									filePath,
									startLine: from.line,
									startCh: from.ch,
									endLine: to.line,
									endCh: to.ch
								});
							});
					});
				}
			})
		);

		console.log("Claude Rock plugin loaded");
	}

	// Add selected text to chat context with position info
	async mentionSelectedText(
		text: string,
		source: string,
		position?: {
			filePath: string;
			startLine: number;
			startCh: number;
			endLine: number;
			endCh: number;
		}
	): Promise<void> {
		await this.activateView();

		const leaves = this.app.workspace.getLeavesOfType(CLAUDE_VIEW_TYPE);
		if (leaves.length === 0) return;

		const chatView = leaves[0]?.view as ClaudeChatView;
		if (chatView && typeof chatView.addSelectedText === "function") {
			chatView.addSelectedText(text, source, position);
		}
	}

	onunload(): void {
		// Abort all running processes
		this.claudeService.abortAll();
		// Detach all leaves of this view type to avoid "existing view type" error on reload
		this.app.workspace.detachLeavesOfType(CLAUDE_VIEW_TYPE);
		console.log("Claude Rock plugin unloaded");
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		// Check if view already exists
		let leaf = workspace.getLeavesOfType(CLAUDE_VIEW_TYPE)[0];

		if (!leaf) {
			// Create new leaf in right sidebar
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: CLAUDE_VIEW_TYPE,
					active: true
				});
				leaf = rightLeaf;
			}
		}

		// Reveal and focus the leaf
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() as PluginData | null;
		if (data) {
			this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
			this.sessions = data.sessions || [];
			this.currentSessionId = data.currentSessionId;
		} else {
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
			this.sessions = [];
			this.currentSessionId = null;

			// Auto-detect CLI path on first launch
			const detected = detectCLIPath();
			if (detected.found) {
				this.settings.cliPath = detected.path;
				console.log(`Claude Rock: Auto-detected CLI at ${detected.path}`);
			}
		}
	}

	async saveSettings(): Promise<void> {
		const data: PluginData = {
			settings: this.settings,
			sessions: this.sessions.slice(0, MAX_SESSIONS),
			currentSessionId: this.currentSessionId
		};
		await this.saveData(data);
		// Update service with new settings
		this.claudeService.setCliPath(this.settings.cliPath);
		this.claudeService.setPermissions(this.settings.permissions);
	}

	// Session management
	createNewSession(): ChatSession {
		const session: ChatSession = {
			id: crypto.randomUUID(),
			cliSessionId: null,
			messages: [],
			createdAt: Date.now()
		};
		this.sessions.unshift(session);
		this.currentSessionId = session.id;
		this.saveSettings();
		return session;
	}

	getCurrentSession(): ChatSession | null {
		if (!this.currentSessionId) return null;
		return this.sessions.find(s => s.id === this.currentSessionId) || null;
	}

	getAllSessions(): ChatSession[] {
		return this.sessions;
	}

	switchToSession(sessionId: string): ChatSession | null {
		const session = this.sessions.find(s => s.id === sessionId);
		if (session) {
			this.currentSessionId = sessionId;
			this.saveSettings();
		}
		return session || null;
	}

	updateCurrentSession(
		messages: import("./types").ChatMessage[],
		cliSessionId: string | null,
		tokenStats?: import("./types").SessionTokenStats
	): void {
		const session = this.getCurrentSession();
		if (session) {
			session.messages = messages;
			session.cliSessionId = cliSessionId;
			if (tokenStats) {
				session.tokenStats = tokenStats;
			}
			// Auto-generate title from first user message
			if (!session.title && messages.length > 0) {
				const firstUserMsg = messages.find(m => m.role === "user");
				if (firstUserMsg) {
					session.title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? "..." : "");
				}
			}
			this.saveSettings();
		}
	}

	deleteSession(sessionId: string): void {
		this.sessions = this.sessions.filter(s => s.id !== sessionId);
		if (this.currentSessionId === sessionId) {
			this.currentSessionId = this.sessions[0]?.id || null;
		}
		this.saveSettings();
	}

	addTokensToHistory(tokens: number): void {
		if (tokens <= 0) return;

		const today = new Date().toISOString().split("T")[0] as string;
		if (!this.settings.tokenHistory) {
			this.settings.tokenHistory = {};
		}
		this.settings.tokenHistory[today] = (this.settings.tokenHistory[today] || 0) + tokens;
		this.saveSettings();
	}

	getTokenHistory(): Record<string, number> {
		return this.settings.tokenHistory || {};
	}

	// CLAUDE.md management
	getVaultPath(): string {
		return this.app.vault.adapter instanceof FileSystemAdapter
			? this.app.vault.adapter.getBasePath()
			: process.cwd();
	}

	getClaudeMdPath(): string {
		return `${this.getVaultPath()}/CLAUDE.md`;
	}

	async readClaudeMd(): Promise<string | null> {
		try {
			const file = this.app.vault.getAbstractFileByPath("CLAUDE.md");
			if (file && "extension" in file) {
				return await this.app.vault.read(file as import("obsidian").TFile);
			}
			return null;
		} catch {
			return null;
		}
	}

	async writeClaudeMd(content: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath("CLAUDE.md");
		if (file && "extension" in file) {
			await this.app.vault.modify(file as import("obsidian").TFile, content);
		} else {
			await this.app.vault.create("CLAUDE.md", content);
		}
	}

	getDefaultClaudeMdContent(): string {
		const lang = this.settings.language as LanguageCode;
		return SYSTEM_PROMPTS[lang] || SYSTEM_PROMPTS.en;
	}

	async ensureClaudeMd(): Promise<void> {
		const existing = await this.readClaudeMd();
		if (!existing) {
			await this.writeClaudeMd(this.getDefaultClaudeMdContent());
		}
	}

	async resetClaudeMd(): Promise<void> {
		await this.writeClaudeMd(this.getDefaultClaudeMdContent());
	}
}
