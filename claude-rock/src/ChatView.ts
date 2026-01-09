import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon, TFile, Modal, TextComponent } from "obsidian";
import type ClaudeRockPlugin from "./main";
import type { ChatMessage, SlashCommand, StreamingEvent, CompleteEvent, ResultEvent, ErrorEvent, AssistantEvent, ClaudeModel, SessionTokenStats, ContextUsage, CompactEvent, ResultMessage, ToolUseEvent, ToolUseBlock, SelectionContext } from "./types";
import { CLAUDE_MODELS } from "./types";
import { getAvailableCommands, filterCommands, parseCommand, buildCommandPrompt } from "./commands";
import { getButtonLocale, type ButtonLocale } from "./buttonLocales";

export const CLAUDE_VIEW_TYPE = "claude-rock-chat-view";

export class ClaudeChatView extends ItemView {
	private plugin: ClaudeRockPlugin;
	private messagesContainer: HTMLElement;
	private inputEl: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private statusEl: HTMLElement;
	private contextIndicatorEl: HTMLElement;
	private messages: ChatMessage[] = [];
	private currentAssistantMessage: HTMLElement | null = null;
	private currentAssistantContent: string = "";
	private isGenerating: boolean = false;
	private activeSessionId: string | null = null;  // ID of currently active session
	private contextDisabled: boolean = false;  // User manually removed context
	private modelIndicatorEl: HTMLElement;
	private currentModel: ClaudeModel;
	private sessionStarted: boolean = false;  // Track if first message was sent
	private modelAutocompleteVisible: boolean = false;
	private thinkingEnabled: boolean = false;  // Extended thinking mode
	private difficultyAutocompleteVisible: boolean = false;

	// Custom session dropdown
	private sessionDropdownContainer: HTMLElement;
	private sessionTriggerEl: HTMLElement;
	private sessionListEl: HTMLElement;
	private isSessionDropdownOpen: boolean = false;

	// Slash command autocomplete
	private autocompleteEl: HTMLElement | null = null;
	private autocompleteVisible: boolean = false;
	private filteredCommands: SlashCommand[] = [];
	private selectedCommandIndex: number = 0;

	// @ mentions
	private mentionedFiles: TFile[] = [];
	private attachedFiles: { name: string; content: string; type: string }[] = [];
	private selectedText: SelectionContext | null = null;
	private lastSelectionContext: SelectionContext | null = null;  // Preserved for response buttons
	private mentionAutocompleteEl: HTMLElement | null = null;
	private mentionAutocompleteVisible: boolean = false;
	private filteredFiles: TFile[] = [];
	private selectedFileIndex: number = 0;
	private mentionStartIndex: number = -1;
	private highlightOverlayEl: HTMLElement | null = null;

	// Context indicator & popup
	private contextIndicatorBtnEl: HTMLElement;
	private contextRingEl: SVGSVGElement;
	private contextPercentEl: HTMLElement;
	private contextPopupEl: HTMLElement;
	private contextPopupInfoEl: HTMLElement;
	private isContextPopupOpen: boolean = false;

	// Context tracking (per session)
	private static readonly CONTEXT_LIMIT = 80000;  // Fixed limit for 100%
	private static readonly AUTO_COMPACT_THRESHOLD = 0.85;  // 85% triggers auto-compact
	private tokenStats: SessionTokenStats = this.initialTokenStats();
	private pendingAutoCompact: boolean = false;

	// Compact feature
	private compactOverlayEl: HTMLElement | null = null;
	private compactSummary: string | null = null;

	// Tool steps display - new architecture
	private currentThinkingBlock: HTMLElement | null = null;  // Current "Thinking..." block with steps
	private currentThinkingSteps: HTMLElement | null = null;  // Steps container inside thinking block
	private hasReceivedText: boolean = false;  // Track if we received any text in current response
	private currentMessageThinkingSteps: ToolUseBlock[] = [];  // Accumulated steps for saving to message history

	// Token tracking for history
	private lastRecordedTokens: number = 0;  // Track previously recorded total tokens

	private initialTokenStats(): SessionTokenStats {
		return {
			inputTokens: 0,
			outputTokens: 0,
			contextWindow: 200000,
			cacheReadTokens: 0,
			compactCount: 0,
			lastCompactPreTokens: null
		};
	}

	private calculateContextUsage(stats: SessionTokenStats): ContextUsage {
		const effectiveLimit = ClaudeChatView.CONTEXT_LIMIT;
		const usedTokens = stats.inputTokens + stats.outputTokens;
		const percentage = Math.min((usedTokens / effectiveLimit) * 100, 100);

		return {
			used: usedTokens,
			limit: effectiveLimit,
			nominal: stats.contextWindow,
			percentage: Math.round(percentage)
		};
	}

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeRockPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CLAUDE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Claude Rock";
	}

	getIcon(): string {
		return "message-square";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("claude-rock-container");

		// Header with session dropdown and actions
		const header = container.createDiv({ cls: "claude-rock-header" });

		// Custom session dropdown
		this.sessionDropdownContainer = header.createDiv({ cls: "claude-rock-session-dropdown-custom" });

		this.sessionTriggerEl = this.sessionDropdownContainer.createDiv({ cls: "claude-rock-session-trigger" });
		this.sessionTriggerEl.addEventListener("click", () => this.toggleSessionDropdown());

		this.sessionListEl = this.sessionDropdownContainer.createDiv({ cls: "claude-rock-session-list" });

		// Close dropdown when clicking outside
		document.addEventListener("click", (e) => {
			if (!this.sessionDropdownContainer.contains(e.target as Node)) {
				this.closeSessionDropdown();
			}
		});

		const actions = header.createDiv({ cls: "claude-rock-actions" });
		const newChatBtn = actions.createEl("button", {
			cls: "claude-rock-action-btn",
			attr: { "aria-label": "New chat" }
		});
		setIcon(newChatBtn, "plus");
		newChatBtn.addEventListener("click", () => this.startNewChat());

		// Messages area
		this.messagesContainer = container.createDiv({ cls: "claude-rock-messages" });

		// Status bar
		this.statusEl = container.createDiv({ cls: "claude-rock-status" });

		// Input area
		const inputArea = container.createDiv({ cls: "claude-rock-input-area" });

		// Context indicator (shows attached file)
		this.contextIndicatorEl = inputArea.createDiv({ cls: "claude-rock-context-indicator" });

		// Input wrapper for positioning autocomplete
		const inputWrapper = inputArea.createDiv({ cls: "claude-rock-input-wrapper" });

		this.inputEl = inputWrapper.createEl("textarea", {
			cls: "claude-rock-input",
			attr: {
				placeholder: "Ask Claude... (type / for commands)",
				rows: "1"
			}
		});

		// Autocomplete popup for slash commands
		this.autocompleteEl = inputWrapper.createDiv({ cls: "claude-rock-autocomplete" });

		// Autocomplete popup for @ mentions
		this.mentionAutocompleteEl = inputWrapper.createDiv({ cls: "claude-rock-mention-autocomplete" });

		const buttonContainer = inputArea.createDiv({ cls: "claude-rock-button-container" });

		// Left group: model + context indicator
		const leftGroup = buttonContainer.createDiv({ cls: "claude-rock-button-group" });

		// Model indicator (replaces dropdown)
		this.currentModel = this.plugin.settings.defaultModel;
		this.modelIndicatorEl = leftGroup.createDiv({ cls: "claude-rock-model-indicator" });
		const modelIcon = this.modelIndicatorEl.createSpan({ cls: "claude-rock-model-indicator-icon" });
		setIcon(modelIcon, "cpu");
		this.modelIndicatorEl.createSpan({
			cls: "claude-rock-model-indicator-name",
			text: this.getModelLabel(this.currentModel)
		});
		this.modelIndicatorEl.addEventListener("click", () => {
			this.showModelAutocomplete();
		});

		// Initialize thinking mode from settings
		this.thinkingEnabled = this.plugin.settings.thinkingEnabled;

		// Context indicator (right after model)
		this.contextIndicatorBtnEl = leftGroup.createDiv({ cls: "claude-rock-context-indicator-btn" });

		// SVG ring (starts at 0%)
		this.contextRingEl = this.createRingIndicator(0);
		this.contextIndicatorBtnEl.appendChild(this.contextRingEl);

		// Percentage text
		this.contextPercentEl = this.contextIndicatorBtnEl.createSpan({
			cls: "claude-rock-context-percent",
			text: "0%"
		});

		// Context popup (inside indicator for proper positioning)
		this.contextPopupEl = this.contextIndicatorBtnEl.createDiv({ cls: "claude-rock-context-popup" });
		this.setupContextPopup();

		// Click handler for popup (after popup is created)
		this.contextIndicatorBtnEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleContextPopup();
		});

		// Close popup on click outside
		document.addEventListener("click", (e) => {
			if (!this.contextIndicatorBtnEl.contains(e.target as Node)) {
				this.closeContextPopup();
			}
			// Close model autocomplete on click outside (but not if difficulty autocomplete is showing)
			if (!this.difficultyAutocompleteVisible &&
				!this.modelIndicatorEl.contains(e.target as Node) &&
				!this.autocompleteEl?.contains(e.target as Node)) {
				this.hideModelAutocomplete();
			}
		});

		// Right group: attach + send
		const rightGroup = buttonContainer.createDiv({ cls: "claude-rock-button-group" });

		// Add file attachment button (left of send button)
		const attachBtn = rightGroup.createEl("button", {
			cls: "claude-rock-attach-btn",
			attr: { "aria-label": "Attach file" }
		});
		setIcon(attachBtn, "plus");

		const fileInput = rightGroup.createEl("input", {
			type: "file",
			cls: "claude-rock-file-input-hidden",
			attr: {
				accept: ".md,.txt,.json,.yaml,.yml,.js,.ts,.tsx,.jsx,.py,.java,.cpp,.c,.h,.go,.rs,.rb,.php,.html,.css,.xml,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.docx"
			}
		});
		fileInput.style.display = "none";

		attachBtn.addEventListener("click", () => fileInput.click());
		fileInput.addEventListener("change", async (e: Event) => {
			const target = e.target as HTMLInputElement;
			if (target.files && target.files.length > 0 && target.files[0]) {
				await this.handleFileAttachment(target.files[0]);
				target.value = "";
			}
		});

		this.sendButton = rightGroup.createEl("button", {
			cls: "claude-rock-send-btn",
			attr: { "aria-label": "Send message" }
		});
		setIcon(this.sendButton, "arrow-up");

		// Event handlers
		this.sendButton.addEventListener("click", () => this.handleSendButtonClick());

		// Input event for autocomplete and auto-resize
		this.inputEl.addEventListener("input", () => {
			this.handleInputChange();
			this.autoResizeInput();
		});

		// Keydown for navigation and submission
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			// Handle mention autocomplete navigation
			if (this.mentionAutocompleteVisible) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					this.selectNextFile();
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					this.selectPrevFile();
					return;
				}
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					this.selectFile(this.selectedFileIndex);
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					this.hideMentionAutocomplete();
					return;
				}
				if (e.key === "Tab") {
					e.preventDefault();
					this.selectFile(this.selectedFileIndex);
					return;
				}
			}

			// Handle model autocomplete navigation
			if (this.modelAutocompleteVisible) {
				if (e.key === "Escape") {
					e.preventDefault();
					this.hideModelAutocomplete();
					return;
				}
				// Model selection is handled by click, just close on Escape
			}

			// Handle slash command autocomplete navigation
			if (this.autocompleteVisible) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					this.selectNextCommand();
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					this.selectPrevCommand();
					return;
				}
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					this.selectCommand(this.selectedCommandIndex);
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					this.hideAutocomplete();
					return;
				}
				if (e.key === "Tab") {
					e.preventDefault();
					this.selectCommand(this.selectedCommandIndex);
					return;
				}
			}

			// Normal send
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				if (!this.isGenerating) {
					this.sendMessage();
				}
			}
		});

		// Setup service event listeners
		this.setupServiceListeners();

		// Update context indicator and note action buttons when active file changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				// Reset context disabled flag when switching files
				this.contextDisabled = false;
				this.updateFileContextIndicator();
				this.updateAllNoteActionButtons();
			})
		);

		// Initial context update
		this.updateFileContextIndicator();

		// Load current session or create new one
		this.loadCurrentSession();
	}

	async onClose(): Promise<void> {
		// Cleanup
		this.plugin.claudeService.removeAllListeners();
	}

	private setupServiceListeners(): void {
		const service = this.plugin.claudeService;

		// Streaming updates - real-time text as it comes in (UI only for active session)
		service.on("streaming", (event: StreamingEvent) => {
			if (event.sessionId !== this.activeSessionId) return;
			this.updateAssistantMessage(event.text);
			this.setStatus("streaming");
		});

		service.on("assistant", (event: AssistantEvent) => {
			if (event.sessionId !== this.activeSessionId) return;
			// Final assistant message - update with complete text
			const textBlocks = event.message.message.content.filter(b => b.type === "text");
			const text = textBlocks.map(b => (b as { type: "text"; text: string }).text).join("");

			if (text) {
				this.updateAssistantMessage(text);
			}
		});

		// Result event - save to session (for any session, not just active)
		service.on("result", (event: ResultEvent) => {
			const isActiveSession = event.sessionId === this.activeSessionId;

			// Save result to the correct session (even if background)
			const session = this.plugin.sessions.find(s => s.id === event.sessionId);
			if (session) {
				const pending = this.plugin.claudeService.getPendingMessage(event.sessionId);
				if (pending && pending.text) {
					const assistantMessage: ChatMessage = {
						id: crypto.randomUUID(),
						role: "assistant",
						content: pending.text,
						timestamp: Date.now(),
						thinkingSteps: pending.tools.length > 0 ? pending.tools : undefined,
						selectionContext: this.lastSelectionContext || undefined
					};
					session.messages.push(assistantMessage);

					// Update cliSessionId
					const cliSessionId = this.plugin.claudeService.getCliSessionId(event.sessionId);
					if (cliSessionId) {
						session.cliSessionId = cliSessionId;
					}

					this.plugin.saveSettings();
					this.plugin.claudeService.clearPendingMessage(event.sessionId);
				}
			}

			// UI updates only for active session
			if (isActiveSession) {
				this.finalizeAssistantMessage();
				if (event.result.is_error) {
					this.setStatus("error", event.result.result);
				} else {
					this.setStatus("idle");
				}
			}

			// Update dropdown to refresh indicators
			this.updateSessionDropdown();
		});

		service.on("error", (event: ErrorEvent) => {
			if (event.sessionId !== this.activeSessionId) return;
			this.finalizeAssistantMessage();
			this.setStatus("error", event.error);
			this.addErrorMessage(event.error);
		});

		service.on("complete", (event: CompleteEvent) => {
			const isActiveSession = event.sessionId === this.activeSessionId;

			if (isActiveSession) {
				this.finalizeAssistantMessage();
				this.setInputEnabled(true);

				// Execute pending auto-compact after response is complete
				if (this.pendingAutoCompact) {
					this.pendingAutoCompact = false;
					this.runCompact();
				}
			}

			// Update dropdown to refresh indicators
			this.updateSessionDropdown();
		});

		// Context tracking events - update for any session
		service.on("contextUpdate", (event: { sessionId: string; usage: ResultMessage["usage"] }) => {
			const isActiveSession = event.sessionId === this.activeSessionId;
			const session = this.plugin.sessions.find(s => s.id === event.sessionId);

			if (event.usage && session) {
				// Update session token stats
				if (!session.tokenStats) {
					session.tokenStats = this.initialTokenStats();
				}
				session.tokenStats.inputTokens = event.usage.input_tokens ?? 0;
				session.tokenStats.outputTokens = event.usage.output_tokens ?? 0;
				session.tokenStats.contextWindow = 200000;
				session.tokenStats.cacheReadTokens = event.usage.cache_read_input_tokens ?? 0;

				// Record token delta to history
				const currentTotal = session.tokenStats.inputTokens + session.tokenStats.outputTokens;
				const delta = currentTotal - this.lastRecordedTokens;
				if (isActiveSession && delta > 0) {
					this.plugin.addTokensToHistory(delta);
					this.lastRecordedTokens = currentTotal;
				}

				this.plugin.saveSettings();

				// UI updates only for active session
				if (isActiveSession) {
					this.tokenStats = session.tokenStats;
					this.updateTokenIndicator();

					// Check if we need to trigger auto-compact
					const usage = this.calculateContextUsage(this.tokenStats);
					if (usage.percentage >= ClaudeChatView.AUTO_COMPACT_THRESHOLD * 100 && !this.pendingAutoCompact) {
						this.pendingAutoCompact = true;
					}
				}
			}
		});

		service.on("compact", (event: CompactEvent) => {
			const isActiveSession = event.sessionId === this.activeSessionId;
			const session = this.plugin.sessions.find(s => s.id === event.sessionId);

			if (session) {
				if (!session.tokenStats) {
					session.tokenStats = this.initialTokenStats();
				}
				session.tokenStats.compactCount++;
				session.tokenStats.lastCompactPreTokens = event.preTokens;
				this.plugin.saveSettings();
			}

			if (isActiveSession) {
				this.tokenStats.compactCount++;
				this.tokenStats.lastCompactPreTokens = event.preTokens;
				this.addSystemMessage(`🔄 Context compacted (was ~${this.formatTokens(event.preTokens)})`);
			}
		});

		// Tool use events for agent steps display (UI only for active session)
		service.on("toolUse", (event: ToolUseEvent) => {
			if (event.sessionId !== this.activeSessionId) return;
			this.addToolStep(event.tool);
		});

		// Rate limit error handling
		service.on("rateLimitError", (event: { sessionId: string; resetTime: string | null; message: string }) => {
			if (event.sessionId !== this.activeSessionId) return;
			this.handleRateLimitError(event.resetTime, event.message);
		});
	}

	private createRingIndicator(percentage: number): SVGSVGElement {
		const size = 18;
		const strokeWidth = 2.5;
		const radius = (size - strokeWidth) / 2;
		const circumference = 2 * Math.PI * radius;
		const offset = circumference - (percentage / 100) * circumference;

		// Determine color based on percentage (hardcoded colors for SVG compatibility)
		const color =
			percentage < 50 ? "#22c55e" :   // green
			percentage < 75 ? "#eab308" :   // yellow
			percentage < 95 ? "#f97316" :   // orange
			"#ef4444";                       // red

		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("width", String(size));
		svg.setAttribute("height", String(size));
		svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
		svg.classList.add("claude-rock-usage-ring");

		// Background ring (gray)
		const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		bgCircle.setAttribute("cx", String(size / 2));
		bgCircle.setAttribute("cy", String(size / 2));
		bgCircle.setAttribute("r", String(radius));
		bgCircle.setAttribute("fill", "none");
		bgCircle.setAttribute("stroke", "#4b5563");  // gray for background
		bgCircle.setAttribute("stroke-width", String(strokeWidth));
		svg.appendChild(bgCircle);

		// Progress ring
		const progressCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		progressCircle.setAttribute("cx", String(size / 2));
		progressCircle.setAttribute("cy", String(size / 2));
		progressCircle.setAttribute("r", String(radius));
		progressCircle.setAttribute("fill", "none");
		progressCircle.setAttribute("stroke", color);
		progressCircle.setAttribute("stroke-width", String(strokeWidth));
		progressCircle.setAttribute("stroke-dasharray", String(circumference));
		progressCircle.setAttribute("stroke-dashoffset", String(offset));
		progressCircle.setAttribute("stroke-linecap", "round");
		progressCircle.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
		progressCircle.classList.add("claude-rock-usage-progress");
		svg.appendChild(progressCircle);

		return svg;
	}

	private updateTokenIndicator(): void {
		const usage = this.calculateContextUsage(this.tokenStats);

		// Update percentage text
		this.contextPercentEl.setText(`${usage.percentage}%`);

		// Recreate ring with new percentage
		const newRing = this.createRingIndicator(usage.percentage);
		this.contextRingEl.replaceWith(newRing);
		this.contextRingEl = newRing;

		// Update popup info if open
		if (this.isContextPopupOpen) {
			this.updateContextPopupInfo();
		}
	}

	// Context popup methods
	private setupContextPopup(): void {
		const locale = getButtonLocale(this.plugin.settings.language);

		// Stop propagation on popup itself to prevent closing when clicking inside
		this.contextPopupEl.addEventListener("click", (e) => {
			e.stopPropagation();
		});

		// Context info section
		this.contextPopupInfoEl = this.contextPopupEl.createDiv({ cls: "claude-rock-context-popup-info" });

		// Summary button
		const summaryBtn = this.contextPopupEl.createEl("button", {
			cls: "claude-rock-summary-btn",
			text: locale.summary
		});
		summaryBtn.addEventListener("click", () => this.runCompact());
	}

	private toggleContextPopup(): void {
		if (this.isContextPopupOpen) {
			this.closeContextPopup();
		} else {
			this.openContextPopup();
		}
	}

	private openContextPopup(): void {
		this.isContextPopupOpen = true;
		this.contextPopupEl.addClass("claude-rock-context-popup-open");
		this.contextIndicatorBtnEl.addClass("claude-rock-context-indicator-btn-active");
		this.updateContextPopupInfo();
	}

	private closeContextPopup(): void {
		this.isContextPopupOpen = false;
		this.contextPopupEl.removeClass("claude-rock-context-popup-open");
		this.contextIndicatorBtnEl.removeClass("claude-rock-context-indicator-btn-active");
	}

	// Model indicator methods
	private getModelLabel(model: ClaudeModel): string {
		const found = CLAUDE_MODELS.find(m => m.value === model);
		return found?.label ?? model;
	}

	private updateModelIndicatorState(): void {
		const nameEl = this.modelIndicatorEl.querySelector(".claude-rock-model-indicator-name");
		if (nameEl) {
			nameEl.textContent = this.getModelLabel(this.currentModel);
		}
	}

	private showModelAutocomplete(): void {
		// Toggle: if already visible, hide it
		if (this.modelAutocompleteVisible) {
			this.hideModelAutocomplete();
			return;
		}

		// Hide other autocompletes
		this.hideAutocomplete();
		this.hideMentionAutocomplete();

		// Show model selection in the autocomplete popup
		if (!this.autocompleteEl) return;

		this.autocompleteEl.empty();
		this.modelAutocompleteVisible = true;

		// Model metadata: icons and descriptions
		const modelMeta: Record<string, { icon: string; desc: string }> = {
			"claude-haiku-4-5-20251001": { icon: "zap", desc: "Самая быстрая на диком западе" },
			"claude-sonnet-4-5-20250929": { icon: "sun", desc: "Для баланса сил во вселенной" },
			"claude-opus-4-5-20251101": { icon: "crown", desc: "Чтобы забивать кувалдой гвозди" }
		};

		for (const model of CLAUDE_MODELS) {
			const itemEl = this.autocompleteEl.createDiv({
				cls: `claude-rock-autocomplete-item${model.value === this.currentModel ? " claude-rock-autocomplete-item-selected" : ""}`
			});

			const meta = modelMeta[model.value] || { icon: "cpu", desc: model.value };
			const iconEl = itemEl.createDiv({ cls: "claude-rock-autocomplete-icon" });
			setIcon(iconEl, meta.icon);

			const textEl = itemEl.createDiv({ cls: "claude-rock-autocomplete-text" });
			textEl.createDiv({ cls: "claude-rock-autocomplete-name", text: model.label });
			textEl.createDiv({ cls: "claude-rock-autocomplete-desc", text: meta.desc });

			itemEl.addEventListener("click", () => {
				this.selectModel(model.value);
			});
		}

		// Separator
		this.autocompleteEl.createDiv({ cls: "claude-rock-autocomplete-separator" });

		// Thinking toggle item
		const locale = getButtonLocale(this.plugin.settings.language);
		const thinkingItemEl = this.autocompleteEl.createDiv({
			cls: "claude-rock-autocomplete-item claude-rock-thinking-item"
		});

		const thinkingIconEl = thinkingItemEl.createDiv({ cls: "claude-rock-autocomplete-icon" });
		setIcon(thinkingIconEl, "brain");

		const thinkingTextEl = thinkingItemEl.createDiv({ cls: "claude-rock-autocomplete-text" });
		thinkingTextEl.createDiv({ cls: "claude-rock-autocomplete-name", text: locale.thinkingDeeper || "Think deeper" });
		thinkingTextEl.createDiv({ cls: "claude-rock-autocomplete-desc", text: "Extended thinking mode" });

		// Toggle switch
		const toggleEl = thinkingItemEl.createDiv({ cls: "claude-rock-thinking-switch" });
		const toggleTrack = toggleEl.createDiv({ cls: "claude-rock-thinking-switch-track" });
		toggleTrack.createDiv({ cls: "claude-rock-thinking-switch-thumb" });
		if (this.thinkingEnabled) {
			toggleTrack.addClass("claude-rock-thinking-switch-on");
		}

		thinkingItemEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this.thinkingEnabled = !this.thinkingEnabled;
			toggleTrack.toggleClass("claude-rock-thinking-switch-on", this.thinkingEnabled);
		});

		this.autocompleteEl.addClass("claude-rock-autocomplete-visible");
	}

	private selectModel(model: ClaudeModel): void {
		this.currentModel = model;
		this.updateModelIndicatorState();
		this.hideModelAutocomplete();
		this.inputEl.value = "";
		this.inputEl.focus();
	}

	private hideModelAutocomplete(): void {
		this.modelAutocompleteVisible = false;
		if (this.autocompleteEl) {
			this.autocompleteEl.removeClass("claude-rock-autocomplete-visible");
			this.autocompleteEl.empty();
		}
	}

	// Difficulty autocomplete methods
	private showDifficultyAutocomplete(): void {
		// Hide other autocompletes
		this.hideAutocomplete();
		this.hideMentionAutocomplete();
		this.hideModelAutocomplete();

		if (!this.autocompleteEl) return;

		this.autocompleteEl.empty();
		this.difficultyAutocompleteVisible = true;

		const locale = getButtonLocale(this.plugin.settings.language);

		// Difficulty levels with icons and descriptions
		const difficultyLevels = [
			{
				id: "kids",
				icon: "baby",
				name: locale.difficultyKids || "For kids",
				desc: locale.difficultyKidsDesc || "Simple words and fun analogies"
			},
			{
				id: "student",
				icon: "graduation-cap",
				name: locale.difficultyStudent || "For student",
				desc: locale.difficultyStudentDesc || "Clear explanations with examples"
			},
			{
				id: "phd",
				icon: "award",
				name: locale.difficultyPhd || "For expert",
				desc: locale.difficultyPhdDesc || "Professional terminology"
			}
		];

		for (const level of difficultyLevels) {
			const itemEl = this.autocompleteEl.createDiv({
				cls: "claude-rock-autocomplete-item"
			});

			const iconEl = itemEl.createDiv({ cls: "claude-rock-autocomplete-icon" });
			setIcon(iconEl, level.icon);

			const textEl = itemEl.createDiv({ cls: "claude-rock-autocomplete-text" });
			textEl.createDiv({ cls: "claude-rock-autocomplete-name", text: level.name });
			textEl.createDiv({ cls: "claude-rock-autocomplete-desc", text: level.desc });

			itemEl.addEventListener("click", () => {
				this.selectDifficulty(level.id);
			});
		}

		this.autocompleteEl.addClass("claude-rock-autocomplete-visible");
	}

	private selectDifficulty(level: string): void {
		this.hideDifficultyAutocomplete();

		const locale = getButtonLocale(this.plugin.settings.language);

		// Localized prompts for each difficulty level with detailed rules
		const prompts: Record<string, Record<string, string>> = {
			kids: {
				en: "Rewrite this text so a 10-12 year old child would understand it.\n\nRules:\n- Replace complex terms with simple words or short explanations\n- Use everyday analogies (games, school, family)\n- Short sentences, simple grammar\n- Keep the original length, all topics, and overall structure\n- Do not add new information or remove existing content",
				ru: "Перепиши текст так, чтобы его понял ребёнок 10-12 лет.\n\nПравила:\n- Заменяй сложные термины на простые слова или короткие объяснения\n- Используй бытовые аналогии и сравнения с понятными вещами (игры, школа, семья)\n- Короткие предложения, простая грамматика\n- Сохраняй исходный объём, все темы и общую структуру\n- Не добавляй новую информацию и не удаляй существующую",
				fr: "Réécris ce texte pour qu'un enfant de 10-12 ans puisse le comprendre.\n\nRègles:\n- Remplace les termes complexes par des mots simples ou de courtes explications\n- Utilise des analogies du quotidien (jeux, école, famille)\n- Phrases courtes, grammaire simple\n- Garde la longueur originale, tous les sujets et la structure générale\n- N'ajoute pas de nouvelles informations et ne supprime pas le contenu existant",
				de: "Schreibe diesen Text so um, dass ein 10-12-jähriges Kind ihn verstehen würde.\n\nRegeln:\n- Ersetze komplexe Begriffe durch einfache Wörter oder kurze Erklärungen\n- Verwende alltägliche Analogien (Spiele, Schule, Familie)\n- Kurze Sätze, einfache Grammatik\n- Behalte die ursprüngliche Länge, alle Themen und die Gesamtstruktur bei\n- Füge keine neuen Informationen hinzu und entferne keine vorhandenen Inhalte",
				es: "Reescribe este texto para que un niño de 10-12 años lo entienda.\n\nReglas:\n- Reemplaza términos complejos con palabras simples o explicaciones cortas\n- Usa analogías cotidianas (juegos, escuela, familia)\n- Oraciones cortas, gramática simple\n- Mantén la extensión original, todos los temas y la estructura general\n- No agregues información nueva ni elimines contenido existente",
				hi: "इस टेक्स्ट को ऐसे लिखो कि 10-12 साल का बच्चा समझ सके।\n\nनियम:\n- जटिल शब्दों को सरल शब्दों या छोटी व्याख्याओं से बदलो\n- रोजमर्रा की उपमाओं का उपयोग करो (खेल, स्कूल, परिवार)\n- छोटे वाक्य, सरल व्याकरण\n- मूल लंबाई, सभी विषय और समग्र संरचना बनाए रखो\n- नई जानकारी न जोड़ो और मौजूदा सामग्री न हटाओ",
				zh: "重写这段文字，让10-12岁的孩子能够理解。\n\n规则：\n- 用简单的词语或简短的解释替换复杂术语\n- 使用日常类比（游戏、学校、家庭）\n- 短句，简单语法\n- 保持原始长度、所有主题和整体结构\n- 不要添加新信息或删除现有内容",
				ja: "10〜12歳の子供が理解できるようにこのテキストを書き直してください。\n\nルール：\n- 複雑な用語を簡単な言葉や短い説明に置き換える\n- 日常的な例え（ゲーム、学校、家族）を使う\n- 短い文、簡単な文法\n- 元の長さ、すべてのトピック、全体的な構造を維持する\n- 新しい情報を追加したり、既存の内容を削除したりしない"
			},
			student: {
				en: "Rewrite this text at undergraduate student level.\n\nRules:\n- Use standard terminology, but avoid highly specialized jargon\n- Moderately complex constructions and common professional terms are acceptable\n- Analogies can be from textbooks and popular science\n- Keep the original length, all topics, and overall structure\n- Do not add new information or remove existing content",
				ru: "Перепиши текст на уровне студента бакалавриата.\n\nПравила:\n- Используй стандартную терминологию, но избегай узкоспециализированного жаргона\n- Допустимы умеренно сложные конструкции и общепринятые профессиональные термины\n- Аналогии могут быть из учебников и популярной науки\n- Сохраняй исходный объём, все темы и общую структуру\n- Не добавляй новую информацию и не удаляй существующую",
				fr: "Réécris ce texte au niveau d'un étudiant de licence.\n\nRègles:\n- Utilise une terminologie standard, mais évite le jargon très spécialisé\n- Les constructions modérément complexes et les termes professionnels courants sont acceptables\n- Les analogies peuvent provenir de manuels et de vulgarisation scientifique\n- Garde la longueur originale, tous les sujets et la structure générale\n- N'ajoute pas de nouvelles informations et ne supprime pas le contenu existant",
				de: "Schreibe diesen Text auf Bachelor-Studenten-Niveau um.\n\nRegeln:\n- Verwende Standardterminologie, aber vermeide hochspezialisiertes Fachvokabular\n- Mäßig komplexe Konstruktionen und gängige Fachbegriffe sind akzeptabel\n- Analogien können aus Lehrbüchern und populärwissenschaftlichen Quellen stammen\n- Behalte die ursprüngliche Länge, alle Themen und die Gesamtstruktur bei\n- Füge keine neuen Informationen hinzu und entferne keine vorhandenen Inhalte",
				es: "Reescribe este texto a nivel de estudiante universitario.\n\nReglas:\n- Usa terminología estándar, pero evita jerga muy especializada\n- Son aceptables construcciones moderadamente complejas y términos profesionales comunes\n- Las analogías pueden ser de libros de texto y divulgación científica\n- Mantén la extensión original, todos los temas y la estructura general\n- No agregues información nueva ni elimines contenido existente",
				hi: "इस टेक्स्ट को स्नातक छात्र स्तर पर लिखो।\n\nनियम:\n- मानक शब्दावली का उपयोग करो, लेकिन अत्यधिक विशेष शब्दजाल से बचो\n- मध्यम जटिल संरचनाएं और सामान्य पेशेवर शब्द स्वीकार्य हैं\n- उपमाएं पाठ्यपुस्तकों और लोकप्रिय विज्ञान से हो सकती हैं\n- मूल लंबाई, सभी विषय और समग्र संरचना बनाए रखो\n- नई जानकारी न जोड़ो और मौजूदा सामग्री न हटाओ",
				zh: "将这段文字重写为本科生水平。\n\n规则：\n- 使用标准术语，但避免高度专业化的行话\n- 可以使用中等复杂的结构和常见的专业术语\n- 类比可以来自教科书和科普读物\n- 保持原始长度、所有主题和整体结构\n- 不要添加新信息或删除现有内容",
				ja: "このテキストを学部生レベルで書き直してください。\n\nルール：\n- 標準的な用語を使用し、高度に専門的な専門用語は避ける\n- 適度に複雑な構文と一般的な専門用語は許容される\n- 例えは教科書や一般向け科学書から引用可能\n- 元の長さ、すべてのトピック、全体的な構造を維持する\n- 新しい情報を追加したり、既存の内容を削除したりしない"
			},
			phd: {
				en: "Rewrite this text at specialist/researcher level.\n\nRules:\n- Use precise professional terminology without simplification\n- Complex grammatical constructions and academic style are acceptable\n- Analogies can draw from related scientific fields\n- Keep the original length, all topics, and overall structure\n- Do not add new information or remove existing content",
				ru: "Перепиши текст на уровне специалиста/исследователя.\n\nПравила:\n- Используй точную профессиональную терминологию без упрощений\n- Допустимы сложные грамматические конструкции и академический стиль\n- Аналогии могут опираться на смежные научные области\n- Сохраняй исходный объём, все темы и общую структуру\n- Не добавляй новую информацию и не удаляй существующую",
				fr: "Réécris ce texte au niveau spécialiste/chercheur.\n\nRègles:\n- Utilise une terminologie professionnelle précise sans simplification\n- Les constructions grammaticales complexes et le style académique sont acceptables\n- Les analogies peuvent s'appuyer sur des domaines scientifiques connexes\n- Garde la longueur originale, tous les sujets et la structure générale\n- N'ajoute pas de nouvelles informations et ne supprime pas le contenu existant",
				de: "Schreibe diesen Text auf Spezialisten-/Forscherniveau um.\n\nRegeln:\n- Verwende präzise Fachterminologie ohne Vereinfachung\n- Komplexe grammatische Konstruktionen und akademischer Stil sind akzeptabel\n- Analogien können sich auf verwandte Wissenschaftsbereiche stützen\n- Behalte die ursprüngliche Länge, alle Themen und die Gesamtstruktur bei\n- Füge keine neuen Informationen hinzu und entferne keine vorhandenen Inhalte",
				es: "Reescribe este texto a nivel de especialista/investigador.\n\nReglas:\n- Usa terminología profesional precisa sin simplificación\n- Son aceptables construcciones gramaticales complejas y estilo académico\n- Las analogías pueden basarse en campos científicos relacionados\n- Mantén la extensión original, todos los temas y la estructura general\n- No agregues información nueva ni elimines contenido existente",
				hi: "इस टेक्स्ट को विशेषज्ञ/शोधकर्ता स्तर पर लिखो।\n\nनियम:\n- सटीक पेशेवर शब्दावली का उपयोग करो बिना सरलीकरण के\n- जटिल व्याकरणिक संरचनाएं और अकादमिक शैली स्वीकार्य हैं\n- उपमाएं संबंधित वैज्ञानिक क्षेत्रों पर आधारित हो सकती हैं\n- मूल लंबाई, सभी विषय और समग्र संरचना बनाए रखो\n- नई जानकारी न जोड़ो और मौजूदा सामग्री न हटाओ",
				zh: "将这段文字重写为专家/研究人员水平。\n\n规则：\n- 使用精确的专业术语，不做简化\n- 可以使用复杂的语法结构和学术风格\n- 类比可以借鉴相关科学领域\n- 保持原始长度、所有主题和整体结构\n- 不要添加新信息或删除现有内容",
				ja: "このテキストを専門家/研究者レベルで書き直してください。\n\nルール：\n- 簡略化せずに正確な専門用語を使用する\n- 複雑な文法構造とアカデミックなスタイルは許容される\n- 例えは関連する科学分野から引用可能\n- 元の長さ、すべてのトピック、全体的な構造を維持する\n- 新しい情報を追加したり、既存の内容を削除したりしない"
			}
		};

		const lang = this.plugin.settings.language;
		const prompt = prompts[level]?.[lang] || prompts[level]?.en || "";

		this.inputEl.value = prompt;
		this.sendMessage();
	}

	private hideDifficultyAutocomplete(): void {
		this.difficultyAutocompleteVisible = false;
		if (this.autocompleteEl) {
			this.autocompleteEl.removeClass("claude-rock-autocomplete-visible");
			this.autocompleteEl.empty();
		}
	}

	// Public method for context menu - send with command prompt
	public sendWithCommand(text: string, prompt: string): void {
		const fullMessage = `${prompt}\n\n${text}`;
		this.inputEl.value = fullMessage;
		this.sendMessage();
	}

	// Public method for context menu - send with difficulty level
	public sendWithDifficulty(text: string, level: "kids" | "student" | "phd"): void {
		const lang = this.plugin.settings.language;

		// Localized prompts for each difficulty level with detailed rules
		const prompts: Record<string, Record<string, string>> = {
			kids: {
				en: "Rewrite this text so a 10-12 year old child would understand it.\n\nRules:\n- Replace complex terms with simple words or short explanations\n- Use everyday analogies (games, school, family)\n- Short sentences, simple grammar\n- Keep the original length, all topics, and overall structure\n- Do not add new information or remove existing content\n\nText:",
				ru: "Перепиши текст так, чтобы его понял ребёнок 10-12 лет.\n\nПравила:\n- Заменяй сложные термины на простые слова или короткие объяснения\n- Используй бытовые аналогии (игры, школа, семья)\n- Короткие предложения, простая грамматика\n- Сохраняй исходный объём, все темы и общую структуру\n- Не добавляй новую информацию и не удаляй существующую\n\nТекст:",
				fr: "Réécris ce texte pour qu'un enfant de 10-12 ans puisse le comprendre.\n\nRègles:\n- Remplace les termes complexes par des mots simples\n- Utilise des analogies du quotidien (jeux, école, famille)\n- Phrases courtes, grammaire simple\n- Garde la longueur originale et la structure\n- N'ajoute pas de nouvelles informations\n\nTexte:",
				de: "Schreibe diesen Text so um, dass ein 10-12-jähriges Kind ihn verstehen würde.\n\nRegeln:\n- Ersetze komplexe Begriffe durch einfache Wörter\n- Verwende alltägliche Analogien (Spiele, Schule, Familie)\n- Kurze Sätze, einfache Grammatik\n- Behalte die ursprüngliche Länge und Struktur bei\n- Füge keine neuen Informationen hinzu\n\nText:",
				es: "Reescribe este texto para que un niño de 10-12 años lo entienda.\n\nReglas:\n- Reemplaza términos complejos con palabras simples\n- Usa analogías cotidianas (juegos, escuela, familia)\n- Oraciones cortas, gramática simple\n- Mantén la extensión original y la estructura\n- No agregues información nueva\n\nTexto:",
				hi: "इस टेक्स्ट को ऐसे लिखो कि 10-12 साल का बच्चा समझ सके।\n\nनियम:\n- जटिल शब्दों को सरल शब्दों से बदलो\n- रोजमर्रा की उपमाओं का उपयोग करो\n- छोटे वाक्य, सरल व्याकरण\n- मूल लंबाई और संरचना बनाए रखो\n- नई जानकारी न जोड़ो\n\nटेक्स्ट:",
				zh: "重写这段文字，让10-12岁的孩子能够理解。\n\n规则：\n- 用简单的词语替换复杂术语\n- 使用日常类比（游戏、学校、家庭）\n- 短句，简单语法\n- 保持原始长度和结构\n- 不要添加新信息\n\n文字：",
				ja: "10〜12歳の子供が理解できるように書き直してください。\n\nルール：\n- 複雑な用語を簡単な言葉に置き換える\n- 日常的な例え（ゲーム、学校、家族）を使う\n- 短い文、簡単な文法\n- 元の長さと構造を維持する\n- 新しい情報を追加しない\n\nテキスト："
			},
			student: {
				en: "Rewrite this text at undergraduate student level.\n\nRules:\n- Use standard terminology, avoid highly specialized jargon\n- Moderately complex constructions are acceptable\n- Analogies can be from textbooks and popular science\n- Keep the original length, all topics, and overall structure\n- Do not add new information or remove existing content\n\nText:",
				ru: "Перепиши текст на уровне студента бакалавриата.\n\nПравила:\n- Используй стандартную терминологию, избегай узкоспециализированного жаргона\n- Допустимы умеренно сложные конструкции\n- Аналогии могут быть из учебников и популярной науки\n- Сохраняй исходный объём, все темы и общую структуру\n- Не добавляй новую информацию и не удаляй существующую\n\nТекст:",
				fr: "Réécris ce texte au niveau d'un étudiant de licence.\n\nRègles:\n- Utilise une terminologie standard, évite le jargon spécialisé\n- Les constructions modérément complexes sont acceptables\n- Les analogies peuvent provenir de manuels\n- Garde la longueur originale et la structure\n- N'ajoute pas de nouvelles informations\n\nTexte:",
				de: "Schreibe diesen Text auf Bachelor-Studenten-Niveau um.\n\nRegeln:\n- Verwende Standardterminologie, vermeide Fachvokabular\n- Mäßig komplexe Konstruktionen sind akzeptabel\n- Analogien können aus Lehrbüchern stammen\n- Behalte die ursprüngliche Länge und Struktur bei\n- Füge keine neuen Informationen hinzu\n\nText:",
				es: "Reescribe este texto a nivel de estudiante universitario.\n\nReglas:\n- Usa terminología estándar, evita jerga especializada\n- Son aceptables construcciones moderadamente complejas\n- Las analogías pueden ser de libros de texto\n- Mantén la extensión original y la estructura\n- No agregues información nueva\n\nTexto:",
				hi: "इस टेक्स्ट को स्नातक छात्र स्तर पर लिखो।\n\nनियम:\n- मानक शब्दावली का उपयोग करो, विशेष शब्दजाल से बचो\n- मध्यम जटिल संरचनाएं स्वीकार्य हैं\n- उपमाएं पाठ्यपुस्तकों से हो सकती हैं\n- मूल लंबाई और संरचना बनाए रखो\n- नई जानकारी न जोड़ो\n\nटेक्स्ट:",
				zh: "将这段文字重写为本科生水平。\n\n规则：\n- 使用标准术语，避免专业行话\n- 可以使用中等复杂的结构\n- 类比可以来自教科书\n- 保持原始长度和结构\n- 不要添加新信息\n\n文字：",
				ja: "このテキストを学部生レベルで書き直してください。\n\nルール：\n- 標準的な用語を使用し、専門用語は避ける\n- 適度に複雑な構文は許容される\n- 例えは教科書から引用可能\n- 元の長さと構造を維持する\n- 新しい情報を追加しない\n\nテキスト："
			},
			phd: {
				en: "Rewrite this text at specialist/researcher level.\n\nRules:\n- Use precise professional terminology without simplification\n- Complex grammatical constructions and academic style are acceptable\n- Analogies can draw from related scientific fields\n- Keep the original length, all topics, and overall structure\n- Do not add new information or remove existing content\n\nText:",
				ru: "Перепиши текст на уровне специалиста/исследователя.\n\nПравила:\n- Используй точную профессиональную терминологию без упрощений\n- Допустимы сложные грамматические конструкции и академический стиль\n- Аналогии могут опираться на смежные научные области\n- Сохраняй исходный объём, все темы и общую структуру\n- Не добавляй новую информацию и не удаляй существующую\n\nТекст:",
				fr: "Réécris ce texte au niveau spécialiste/chercheur.\n\nRègles:\n- Utilise une terminologie précise sans simplification\n- Les constructions complexes et le style académique sont acceptables\n- Les analogies peuvent s'appuyer sur des domaines connexes\n- Garde la longueur originale et la structure\n- N'ajoute pas de nouvelles informations\n\nTexte:",
				de: "Schreibe diesen Text auf Spezialisten-/Forscherniveau um.\n\nRegeln:\n- Verwende präzise Fachterminologie ohne Vereinfachung\n- Komplexe Konstruktionen und akademischer Stil sind akzeptabel\n- Analogien können sich auf verwandte Bereiche stützen\n- Behalte die ursprüngliche Länge und Struktur bei\n- Füge keine neuen Informationen hinzu\n\nText:",
				es: "Reescribe este texto a nivel de especialista/investigador.\n\nReglas:\n- Usa terminología precisa sin simplificación\n- Son aceptables construcciones complejas y estilo académico\n- Las analogías pueden basarse en campos relacionados\n- Mantén la extensión original y la estructura\n- No agregues información nueva\n\nTexto:",
				hi: "इस टेक्स्ट को विशेषज्ञ/शोधकर्ता स्तर पर लिखो।\n\nनियम:\n- सटीक पेशेवर शब्दावली का उपयोग करो बिना सरलीकरण के\n- जटिल संरचनाएं और अकादमिक शैली स्वीकार्य हैं\n- उपमाएं संबंधित क्षेत्रों से हो सकती हैं\n- मूल लंबाई और संरचना बनाए रखो\n- नई जानकारी न जोड़ो\n\nटेक्स्ट:",
				zh: "将这段文字重写为专家/研究人员水平。\n\n规则：\n- 使用精确的专业术语，不做简化\n- 可以使用复杂的结构和学术风格\n- 类比可以借鉴相关领域\n- 保持原始长度和结构\n- 不要添加新信息\n\n文字：",
				ja: "このテキストを専門家/研究者レベルで書き直してください。\n\nルール：\n- 簡略化せずに正確な専門用語を使用する\n- 複雑な構造とアカデミックなスタイルは許容される\n- 例えは関連分野から引用可能\n- 元の長さと構造を維持する\n- 新しい情報を追加しない\n\nテキスト："
			}
		};

		const prompt = prompts[level]?.[lang] || prompts[level]?.en || "";
		const fullMessage = `${prompt}\n\n${text}`;

		this.inputEl.value = fullMessage;
		this.sendMessage();
	}

	private updateContextPopupInfo(): void {
		const locale = getButtonLocale(this.plugin.settings.language);
		const usage = this.calculateContextUsage(this.tokenStats);

		this.contextPopupInfoEl.empty();

		// Main usage line
		this.contextPopupInfoEl.createDiv({
			cls: "claude-rock-context-row claude-rock-context-row-main",
			text: `${this.formatTokens(usage.used)} / ${this.formatTokens(usage.limit)}`
		});

		// Details
		this.contextPopupInfoEl.createDiv({
			cls: "claude-rock-context-row",
			text: `${locale.inputTokens || "Input"}: ${this.formatTokens(this.tokenStats.inputTokens)}`
		});
		this.contextPopupInfoEl.createDiv({
			cls: "claude-rock-context-row",
			text: `${locale.outputTokens || "Output"}: ${this.formatTokens(this.tokenStats.outputTokens)}`
		});

		if (this.tokenStats.cacheReadTokens > 0) {
			this.contextPopupInfoEl.createDiv({
				cls: "claude-rock-context-row",
				text: `${locale.cacheTokens || "Cache"}: ${this.formatTokens(this.tokenStats.cacheReadTokens)}`
			});
		}

		// Info about context limit and auto-compact
		this.contextPopupInfoEl.createDiv({
			cls: "claude-rock-context-row claude-rock-context-row-info",
			text: `${locale.contextLimit || "Limit"}: ${this.formatTokens(ClaudeChatView.CONTEXT_LIMIT)}`
		});
		this.contextPopupInfoEl.createDiv({
			cls: "claude-rock-context-row claude-rock-context-row-info",
			text: `${locale.autoCompactAt || "Auto-compact at"} 85%`
		});

		if (this.tokenStats.compactCount > 0) {
			this.contextPopupInfoEl.createDiv({
				cls: "claude-rock-context-row claude-rock-context-row-info",
				text: `${locale.compactions || "Compactions"}: ${this.tokenStats.compactCount}`
			});
		}
	}

	private formatTokens(n: number): string {
		if (n === undefined || n === null || isNaN(n)) return "0";
		if (n < 1000) return `${n}`;
		if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
		return `${Math.round(n / 1000)}k`;
	}

	// Compact feature methods
	private async runCompact(): Promise<void> {
		// Close popup
		this.closeContextPopup();

		// Check if there are messages to summarize
		if (this.messages.length === 0) {
			return;
		}

		// Show animation
		this.showCompactAnimation();

		try {
			// 1. Collect current messages for summary
			const messagesToSummarize = this.messages.map(m =>
				`${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
			).join("\n\n");

			// 2. Request summary from Claude
			const summaryPrompt = `Please provide a concise summary of this conversation that captures the key context, decisions made, and current state. This summary will be used to continue the conversation in a new session.

Conversation:
${messagesToSummarize}

Provide only the summary, no additional commentary.`;

			// Create temporary sessionId for summary request
			const summarySessionId = `summary-${crypto.randomUUID()}`;
			let summary = "";

			// Subscribe to streaming
			const onStreaming = (event: StreamingEvent) => {
				if (event.sessionId === summarySessionId) {
					summary += event.text;
				}
			};

			const onComplete = (event: CompleteEvent) => {
				if (event.sessionId === summarySessionId) {
					// Remove listeners
					this.plugin.claudeService.off("streaming", onStreaming);
					// Finish compact process
					this.finishCompact(summary);
				}
			};

			this.plugin.claudeService.on("streaming", onStreaming);
			this.plugin.claudeService.on("complete", onComplete);

			// Send summary request (new session, no resume)
			await this.plugin.claudeService.sendMessage(
				summaryPrompt,
				summarySessionId,
				undefined, // New session
				this.currentModel
			);

		} catch (error) {
			console.error("Compact error:", error);
			this.hideCompactAnimation();
		}
	}

	private finishCompact(summary: string): void {
		// Hide animation
		this.hideCompactAnimation();

		// Keep visual messages but reset CLI session
		const currentSession = this.plugin.getCurrentSession();
		if (currentSession) {
			// Reset CLI session ID - next message will start new session
			currentSession.cliSessionId = null;
			this.plugin.claudeService.clearSession(currentSession.id);

			// Save summary for next message
			this.compactSummary = summary;

			// Unlock model selector
			this.sessionStarted = false;
			this.updateModelIndicatorState();

			this.plugin.saveSettings();
		}

		// Reset token stats (keep compactCount incremented)
		const prevCompactCount = this.tokenStats.compactCount + 1;
		this.tokenStats = this.initialTokenStats();
		this.tokenStats.compactCount = prevCompactCount;
		this.updateTokenIndicator();

		// Add system message about compact
		this.addSystemMessage("--- Context compacted ---");
	}

	private showCompactAnimation(): void {
		const locale = getButtonLocale(this.plugin.settings.language);

		this.compactOverlayEl = this.messagesContainer.createDiv({
			cls: "claude-rock-compact-overlay"
		});

		this.compactOverlayEl.createDiv({ cls: "claude-rock-compact-spinner" });
		this.compactOverlayEl.createDiv({
			cls: "claude-rock-compact-text",
			text: locale.creatingSummary
		});

		// Disable input
		this.setInputEnabled(false);
	}

	private hideCompactAnimation(): void {
		if (this.compactOverlayEl) {
			this.compactOverlayEl.remove();
			this.compactOverlayEl = null;
		}
		this.setInputEnabled(true);
	}

	private addSystemMessage(text: string): void {
		const msgEl = this.messagesContainer.createDiv({
			cls: "claude-rock-message claude-rock-message-system"
		});
		msgEl.createDiv({ cls: "claude-rock-message-content", text });
		this.scrollToBottom();
	}

	private handleSendButtonClick(): void {
		if (this.isGenerating) {
			// Stop generation for current session
			const currentSession = this.plugin.getCurrentSession();
			if (currentSession) {
				this.plugin.claudeService.abort(currentSession.id);
			}
		} else {
			this.sendMessage();
		}
	}

	// Session management
	private loadCurrentSession(): void {
		let session = this.plugin.getCurrentSession();
		if (!session) {
			session = this.plugin.createNewSession();
		}
		this.loadSession(session);
		this.updateSessionDropdown();
	}

	private loadSession(session: import("./types").ChatSession): void {
		// Set active session ID for event filtering
		this.activeSessionId = session.id;

		this.messages = [...session.messages];
		this.messagesContainer.empty();

		// Load token stats from session (or reset if not available)
		this.tokenStats = session.tokenStats || this.initialTokenStats();
		// Initialize lastRecordedTokens to avoid double-counting on session reload
		this.lastRecordedTokens = this.tokenStats.inputTokens + this.tokenStats.outputTokens;
		this.updateTokenIndicator();

		if (this.messages.length === 0) {
			this.showWelcome();
		} else {
			// Render existing messages
			for (const msg of this.messages) {
				if (msg.role === "user") {
					this.renderUserMessage(msg.content, msg.id);
				} else {
					this.renderAssistantMessage(msg.content, msg.id, msg.thinkingSteps, msg.selectionContext);
				}
			}
		}

		// Restore model state
		this.sessionStarted = session.messages.length > 0;
		if (session.model) {
			this.currentModel = session.model;
		} else {
			this.currentModel = this.plugin.settings.defaultModel;
		}
		this.updateModelIndicatorState();

		this.setStatus("idle");
	}

	private renderUserMessage(content: string, id: string): void {
		const msgEl = this.messagesContainer.createDiv({
			cls: "claude-rock-message claude-rock-message-user"
		});
		msgEl.dataset.id = id;
		const contentEl = msgEl.createDiv({ cls: "claude-rock-message-content" });
		contentEl.setText(content);
	}

	private renderAssistantMessage(content: string, id: string, thinkingSteps?: ToolUseBlock[], selectionContext?: SelectionContext): void {
		// Render thinking block if we have saved steps
		if (thinkingSteps && thinkingSteps.length > 0) {
			this.renderThinkingBlock(thinkingSteps);
		}

		const msgEl = this.messagesContainer.createDiv({
			cls: "claude-rock-message claude-rock-message-assistant"
		});
		msgEl.dataset.id = id;
		const contentEl = msgEl.createDiv({ cls: "claude-rock-message-content" });
		MarkdownRenderer.render(this.app, content, contentEl, "", this);
		this.removeEditableAttributes(contentEl);
		this.addCopyButton(msgEl, content, selectionContext);
	}

	private renderThinkingBlock(steps: ToolUseBlock[]): void {
		const locale = getButtonLocale(this.plugin.settings.language);

		const thinkingBlock = this.messagesContainer.createDiv({
			cls: "claude-rock-thinking-block claude-rock-thinking-done"
		});

		const header = thinkingBlock.createDiv({ cls: "claude-rock-thinking-header" });
		const iconEl = header.createSpan({ cls: "claude-rock-thinking-icon" });
		setIcon(iconEl, "brain");
		header.createSpan({ cls: "claude-rock-thinking-text", text: locale.thinking });

		const stepsContainer = thinkingBlock.createDiv({ cls: "claude-rock-thinking-steps" });

		for (const tool of steps) {
			const stepEl = stepsContainer.createDiv({ cls: "claude-rock-tool-step" });
			const stepIconEl = stepEl.createSpan({ cls: "claude-rock-tool-step-icon" });
			setIcon(stepIconEl, this.getToolIcon(tool.name));
			const textEl = stepEl.createSpan({ cls: "claude-rock-tool-step-text" });
			textEl.setText(this.formatToolStep(tool, locale));
		}
	}

	private updateSessionDropdown(): void {
		const sessions = this.plugin.sessions;
		const currentId = this.plugin.currentSessionId;

		// Update trigger text
		const currentSession = sessions.find(s => s.id === currentId);
		this.sessionTriggerEl.empty();

		// Show spinner if current session is running
		if (currentSession && this.plugin.claudeService.isRunning(currentSession.id)) {
			const spinnerEl = this.sessionTriggerEl.createSpan({ cls: "claude-rock-session-spinner" });
			setIcon(spinnerEl, "loader-2");
		}

		const triggerText = this.sessionTriggerEl.createSpan({ cls: "claude-rock-session-trigger-text" });
		triggerText.setText(currentSession ? this.getSessionLabel(currentSession) : "Select chat");
		const triggerIcon = this.sessionTriggerEl.createSpan({ cls: "claude-rock-session-trigger-icon" });
		setIcon(triggerIcon, "chevron-down");

		// Update list
		this.sessionListEl.empty();
		for (const session of sessions) {
			const isRunning = this.plugin.claudeService.isRunning(session.id);
			const item = this.sessionListEl.createDiv({
				cls: `claude-rock-session-item ${session.id === currentId ? "claude-rock-session-item-active" : ""} ${isRunning ? "claude-rock-session-item-running" : ""}`
			});
			item.dataset.id = session.id;

			// Show spinner for running sessions
			if (isRunning) {
				const spinnerEl = item.createSpan({ cls: "claude-rock-session-spinner" });
				setIcon(spinnerEl, "loader-2");
			}

			const titleEl = item.createSpan({ cls: "claude-rock-session-title" });
			titleEl.setText(this.getSessionLabel(session));

			const deleteBtn = item.createEl("button", {
				cls: "claude-rock-session-delete",
				attr: { "aria-label": "Delete session" }
			});
			setIcon(deleteBtn, "x");

			// Click on title to select session
			titleEl.addEventListener("click", (e) => {
				e.stopPropagation();
				this.selectSession(session.id);
			});

			// Click on delete to remove session
			deleteBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.deleteSessionWithConfirm(session.id);
			});
		}
	}

	private getSessionLabel(session: import("./types").ChatSession): string {
		if (session.title) {
			return session.title;
		}
		const date = new Date(session.createdAt);
		return `New chat - ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
	}

	private toggleSessionDropdown(): void {
		this.isSessionDropdownOpen = !this.isSessionDropdownOpen;
		if (this.isSessionDropdownOpen) {
			this.sessionListEl.addClass("claude-rock-session-list-open");
			this.sessionTriggerEl.addClass("claude-rock-session-trigger-open");
		} else {
			this.closeSessionDropdown();
		}
	}

	private closeSessionDropdown(): void {
		this.isSessionDropdownOpen = false;
		this.sessionListEl.removeClass("claude-rock-session-list-open");
		this.sessionTriggerEl.removeClass("claude-rock-session-trigger-open");
	}

	private selectSession(sessionId: string): void {
		const session = this.plugin.switchToSession(sessionId);
		if (session) {
			this.loadSession(session);
			this.updateSessionDropdown();
		}
		this.closeSessionDropdown();
	}

	private deleteSessionWithConfirm(sessionId: string): void {
		// If only one session, don't delete
		if (this.plugin.sessions.length <= 1) {
			return;
		}

		this.plugin.deleteSession(sessionId);
		this.updateSessionDropdown();

		// If deleted current session, load the new current one
		const currentSession = this.plugin.getCurrentSession();
		if (currentSession) {
			this.loadSession(currentSession);
		}
	}

	private startNewChat(): void {
		const session = this.plugin.createNewSession();
		// Reset token stats for new session
		this.tokenStats = this.initialTokenStats();
		this.updateTokenIndicator();
		this.loadSession(session);
		this.updateSessionDropdown();
		this.inputEl.focus();
	}

	private saveCurrentSession(): void {
		const currentSession = this.plugin.getCurrentSession();
		const cliSessionId = currentSession
			? this.plugin.claudeService.getCliSessionId(currentSession.id)
			: null;
		this.plugin.updateCurrentSession(
			this.messages,
			cliSessionId,
			this.tokenStats
		);
		this.updateSessionDropdown();
	}

	private updateFileContextIndicator(): void {
		this.contextIndicatorEl.empty();
		let hasContent = false;

		// 1. Selected text from editor (highest priority, icon: text-cursor)
		if (this.selectedText) {
			const label = this.selectedText.content.length > 30
				? this.selectedText.content.slice(0, 30) + "..."
				: this.selectedText.content;
			this.addContextChip("text-cursor", label, () => {
				this.selectedText = null;
				this.updateFileContextIndicator();
			});
			hasContent = true;
		}

		// 2. Mentioned pages via @ (icon: at-sign)
		for (const mention of this.mentionedFiles) {
			this.addContextChip("at-sign", mention.basename, () => {
				this.mentionedFiles = this.mentionedFiles.filter(f => f.path !== mention.path);
				this.updateFileContextIndicator();
			});
			hasContent = true;
		}

		// 3. Attached files (icon: file)
		for (const file of this.attachedFiles) {
			this.addContextChip("file", this.getFileBasename(file.name), () => {
				this.removeAttachedFile(file.name);
			});
			hasContent = true;
		}

		// Show/hide container
		if (hasContent) {
			this.contextIndicatorEl.addClass("claude-rock-context-active");
		} else {
			this.contextIndicatorEl.removeClass("claude-rock-context-active");
		}
	}

	private addContextChip(icon: string, label: string, onRemove: () => void): void {
		const chip = this.contextIndicatorEl.createDiv({ cls: "claude-rock-context-chip" });

		const iconEl = chip.createSpan({ cls: "claude-rock-context-icon" });
		setIcon(iconEl, icon);

		chip.createSpan({ cls: "claude-rock-context-name", text: label });

		const removeBtn = chip.createEl("button", {
			cls: "claude-rock-context-remove",
			attr: { "aria-label": "Remove" }
		});
		setIcon(removeBtn, "x");
		removeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			onRemove();
		});
	}

	// Public method to add selected text from context menu with position info
	public addSelectedText(
		text: string,
		source: string,
		position?: {
			filePath: string;
			startLine: number;
			startCh: number;
			endLine: number;
			endCh: number;
		}
	): void {
		this.selectedText = {
			content: text,
			source,
			filePath: position?.filePath || "",
			startLine: position?.startLine || 0,
			startCh: position?.startCh || 0,
			endLine: position?.endLine || 0,
			endCh: position?.endCh || 0
		};
		this.updateFileContextIndicator();
	}

	private async getActiveFileContext(): Promise<{ name: string; content: string } | null> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== "md") {
			return null;
		}

		try {
			const content = await this.app.vault.read(activeFile);
			return { name: activeFile.basename, content };
		} catch {
			return null;
		}
	}

	// Get localized instruction for selected text mode
	private getSelectionInstruction(): string {
		const lang = this.plugin.settings.language;

		const instructions: Record<string, string> = {
			en: "IMPORTANT: You are working with a SELECTED TEXT FRAGMENT only.\n" +
				"Rules:\n" +
				"- Work ONLY with the text between [Selected text] and [END OF SELECTED TEXT]\n" +
				"- Your response must contain ONLY the processed/modified text\n" +
				"- Do NOT add introductions, explanations, or conclusions outside the text\n" +
				"- Do NOT expand beyond the boundaries of the selected fragment\n" +
				"- Preserve the approximate length of the original text\n" +
				"- Return ONLY the result that can directly replace the selected text",

			ru: "ВАЖНО: Ты работаешь ТОЛЬКО с ВЫДЕЛЕННЫМ ФРАГМЕНТОМ текста.\n" +
				"Правила:\n" +
				"- Работай ТОЛЬКО с текстом между [Selected text] и [END OF SELECTED TEXT]\n" +
				"- Твой ответ должен содержать ТОЛЬКО обработанный/изменённый текст\n" +
				"- НЕ добавляй вступления, пояснения или заключения вне текста\n" +
				"- НЕ выходи за границы выделенного фрагмента\n" +
				"- Сохраняй примерный объём исходного текста\n" +
				"- Верни ТОЛЬКО результат, который можно напрямую заменить на место выделенного текста",

			fr: "IMPORTANT: Vous travaillez UNIQUEMENT avec un FRAGMENT DE TEXTE SÉLECTIONNÉ.\n" +
				"Règles:\n" +
				"- Travaillez UNIQUEMENT avec le texte entre [Selected text] et [END OF SELECTED TEXT]\n" +
				"- Votre réponse doit contenir UNIQUEMENT le texte traité/modifié\n" +
				"- N'ajoutez PAS d'introductions, d'explications ou de conclusions en dehors du texte\n" +
				"- Ne dépassez PAS les limites du fragment sélectionné\n" +
				"- Préservez la longueur approximative du texte original\n" +
				"- Retournez UNIQUEMENT le résultat qui peut remplacer directement le texte sélectionné",

			de: "WICHTIG: Sie arbeiten NUR mit einem AUSGEWÄHLTEN TEXTFRAGMENT.\n" +
				"Regeln:\n" +
				"- Arbeiten Sie NUR mit dem Text zwischen [Selected text] und [END OF SELECTED TEXT]\n" +
				"- Ihre Antwort muss NUR den verarbeiteten/geänderten Text enthalten\n" +
				"- Fügen Sie KEINE Einleitungen, Erklärungen oder Schlussfolgerungen außerhalb des Textes hinzu\n" +
				"- Überschreiten Sie NICHT die Grenzen des ausgewählten Fragments\n" +
				"- Behalten Sie die ungefähre Länge des Originaltextes bei\n" +
				"- Geben Sie NUR das Ergebnis zurück, das den ausgewählten Text direkt ersetzen kann",

			es: "IMPORTANTE: Estás trabajando SOLO con un FRAGMENTO DE TEXTO SELECCIONADO.\n" +
				"Reglas:\n" +
				"- Trabaja SOLO con el texto entre [Selected text] y [END OF SELECTED TEXT]\n" +
				"- Tu respuesta debe contener SOLO el texto procesado/modificado\n" +
				"- NO agregues introducciones, explicaciones o conclusiones fuera del texto\n" +
				"- NO te extiendas más allá de los límites del fragmento seleccionado\n" +
				"- Preserva la longitud aproximada del texto original\n" +
				"- Devuelve SOLO el resultado que puede reemplazar directamente el texto seleccionado",

			hi: "महत्वपूर्ण: आप केवल एक चयनित टेक्स्ट फ्रैगमेंट के साथ काम कर रहे हैं।\n" +
				"नियम:\n" +
				"- केवल [Selected text] और [END OF SELECTED TEXT] के बीच के टेक्स्ट के साथ काम करें\n" +
				"- आपके उत्तर में केवल संसाधित/संशोधित टेक्स्ट होना चाहिए\n" +
				"- टेक्स्ट के बाहर परिचय, स्पष्टीकरण या निष्कर्ष न जोड़ें\n" +
				"- चयनित फ्रैगमेंट की सीमाओं से बाहर न जाएं\n" +
				"- मूल टेक्स्ट की अनुमानित लंबाई बनाए रखें\n" +
				"- केवल वह परिणाम लौटाएं जो सीधे चयनित टेक्स्ट को बदल सकता है",

			zh: "重要：你只在处理一个选定的文本片段。\n" +
				"规则：\n" +
				"- 只处理 [Selected text] 和 [END OF SELECTED TEXT] 之间的文本\n" +
				"- 你的回复必须只包含处理/修改后的文本\n" +
				"- 不要在文本之外添加引言、解释或结论\n" +
				"- 不要超出选定片段的边界\n" +
				"- 保持原文的大致长度\n" +
				"- 只返回可以直接替换选定文本的结果",

			ja: "重要：選択されたテキストフラグメントのみで作業しています。\n" +
				"ルール：\n" +
				"- [Selected text] と [END OF SELECTED TEXT] の間のテキストのみで作業してください\n" +
				"- 回答には処理/変更されたテキストのみを含めてください\n" +
				"- テキスト外に序論、説明、結論を追加しないでください\n" +
				"- 選択されたフラグメントの境界を超えないでください\n" +
				"- 元のテキストのおおよその長さを保持してください\n" +
				"- 選択されたテキストを直接置き換えることができる結果のみを返してください"
		};

		return instructions[lang] ?? instructions["en"] ?? "Work only with the selected text fragment. Return only the result.";
	}

	private showWelcome(): void {
		if (this.messages.length === 0) {
			const locale = getButtonLocale(this.plugin.settings.language);
			const welcome = this.messagesContainer.createDiv({ cls: "claude-rock-welcome" });

			// Title
			welcome.createEl("h2", { cls: "claude-rock-welcome-title", text: locale.welcomeTitle });

			// Subtitle
			welcome.createEl("p", { cls: "claude-rock-welcome-subtitle", text: locale.welcomeSubtitle });

			// Features list
			const features = welcome.createDiv({ cls: "claude-rock-welcome-features" });
			const featureData = [
				{ icon: "message-circle", text: locale.welcomeFeature1 },
				{ icon: "paperclip", text: locale.welcomeFeature2 },
				{ icon: "at-sign", text: locale.welcomeFeature3 },
				{ icon: "globe", text: locale.welcomeFeature4 }
			];

			for (const feature of featureData) {
				const item = features.createDiv({ cls: "claude-rock-welcome-feature" });
				const icon = item.createSpan({ cls: "claude-rock-welcome-feature-icon" });
				setIcon(icon, feature.icon);
				item.createSpan({ text: feature.text });
			}

			// Tip
			welcome.createEl("p", { cls: "claude-rock-welcome-hint", text: locale.welcomeTip });

			// Joke
			welcome.createEl("p", { cls: "claude-rock-welcome-joke", text: locale.welcomeJoke });
		}
	}

	private clearWelcome(): void {
		const welcome = this.messagesContainer.querySelector(".claude-rock-welcome");
		if (welcome) {
			welcome.remove();
		}
	}

	private async sendMessage(): Promise<void> {
		const userInput = this.inputEl.value.trim();
		const currentSession = this.plugin.getCurrentSession();
		if (!userInput || !currentSession || this.plugin.claudeService.isRunning(currentSession.id)) {
			return;
		}

		// Hide autocomplete if visible
		this.hideAutocomplete();

		this.clearWelcome();
		this.inputEl.value = "";
		this.autoResizeInput();

		// Process slash command if present
		let userPrompt = userInput;
		let displayText = userInput;
		let expandedPrompt: string | null = null;

		if (userInput.startsWith("/")) {
			const commandPrompt = this.processSlashCommand(userInput);
			if (commandPrompt) {
				userPrompt = commandPrompt;
				expandedPrompt = commandPrompt;
				// Show the original command in chat
				displayText = userInput;
			}
		}

		// Check if this is the first message in session (for system prompt)
		const isFirstMessage = this.messages.length === 0;

		this.addUserMessage(displayText, expandedPrompt);
		this.setInputEnabled(false);
		this.setStatus("loading");

		// Prepare assistant message element
		this.prepareAssistantMessage();

		// Build prompt with file context (unless disabled by user)
		let fullPrompt = userPrompt;
		if (!this.contextDisabled) {
			const fileContext = await this.getActiveFileContext();
			if (fileContext) {
				fullPrompt = `[Context: ${fileContext.name}]\n${fileContext.content}\n\n---\n\n${userPrompt}`;
			}
		}

		// Add mentioned files context
		if (this.mentionedFiles.length > 0) {
			const mentionedContext = await this.getMentionedFilesContext();
			if (mentionedContext) {
				fullPrompt = `${mentionedContext}\n\n---\n\n${fullPrompt}`;
			}
			// Clear mentioned files after sending
			this.clearMentionedFiles();
		}

		// Add attached files context
		if (this.attachedFiles.length > 0) {
			const attachedContext = this.attachedFiles.map(file => {
				if (["png", "jpg", "jpeg", "gif", "webp"].includes(file.type)) {
					return `[Attached image: ${file.name}]\n${file.content}`;
				} else {
					return `[Attached file: ${file.name}]\n${file.content}`;
				}
			}).join("\n\n---\n\n");
			fullPrompt = `${attachedContext}\n\n---\n\n${fullPrompt}`;
			this.clearAttachedFiles();
		}

		// Add selected text from editor (highest priority)
		if (this.selectedText) {
			// Preserve selection context for response buttons (replace/append)
			this.lastSelectionContext = { ...this.selectedText };

			// Build selection context with strict instructions
			const selectionInstruction = this.getSelectionInstruction();
			fullPrompt = `[SELECTED TEXT MODE]\n${selectionInstruction}\n\n[Selected text from ${this.selectedText.source}]\n${this.selectedText.content}\n\n[END OF SELECTED TEXT]\n\n[User request]\n${fullPrompt}`;

			this.selectedText = null;
			this.updateFileContextIndicator();
		} else {
			// Clear last selection context if no selection was used
			this.lastSelectionContext = null;
		}

		// Add compact summary if exists (system prompt is now read from CLAUDE.md automatically)
		if (isFirstMessage && this.compactSummary) {
			fullPrompt = `[Previous conversation summary]:\n${this.compactSummary}\n\n---\n\n` + fullPrompt;
			this.compactSummary = null; // Clear after use
		}

		// Get CLI session ID - either from ClaudeService (current) or from saved session
		const cliSessionId = this.plugin.claudeService.getCliSessionId(currentSession.id)
			?? currentSession.cliSessionId
			?? undefined;

		// Lock model after first message
		if (!this.sessionStarted) {
			this.sessionStarted = true;
			this.updateModelIndicatorState();
			// Save model to session
			currentSession.model = this.currentModel;
			this.plugin.saveSettings();
		}

		// Add ultrathink prefix if thinking mode is enabled
		if (this.thinkingEnabled) {
			fullPrompt = `ultrathink: ${fullPrompt}`;
		}

		// Send to Claude with model and session ID
		await this.plugin.claudeService.sendMessage(
			fullPrompt,
			currentSession.id,
			cliSessionId,
			this.currentModel
		);
	}

	private addUserMessage(content: string, expandedPrompt?: string | null): void {
		const msgId = crypto.randomUUID();
		const message: ChatMessage = {
			id: msgId,
			role: "user",
			content,
			timestamp: Date.now()
		};
		this.messages.push(message);

		const msgEl = this.messagesContainer.createDiv({
			cls: "claude-rock-message claude-rock-message-user"
		});
		msgEl.dataset.id = msgId;

		const contentEl = msgEl.createDiv({ cls: "claude-rock-message-content" });
		contentEl.setText(content);

		// Show expanded prompt for slash commands
		if (expandedPrompt && content.startsWith("/")) {
			const expandedEl = msgEl.createDiv({ cls: "claude-rock-expanded-prompt" });
			expandedEl.setText(expandedPrompt);
		}

		this.scrollToBottom();
	}

	private prepareAssistantMessage(): void {
		this.currentAssistantContent = "";
		this.hasReceivedText = false;
		this.currentThinkingBlock = null;
		this.currentThinkingSteps = null;
		this.currentAssistantMessage = null;
		this.currentMessageThinkingSteps = [];

		// Create initial thinking block with "Thinking..." header
		this.createThinkingBlock();

		this.scrollToBottom();
	}

	private createThinkingBlock(): void {
		const locale = getButtonLocale(this.plugin.settings.language);

		// Create thinking block container
		this.currentThinkingBlock = this.messagesContainer.createDiv({
			cls: "claude-rock-thinking-block"
		});

		// Header with "Thinking..." text
		const header = this.currentThinkingBlock.createDiv({ cls: "claude-rock-thinking-header" });
		const iconEl = header.createSpan({ cls: "claude-rock-thinking-icon" });
		setIcon(iconEl, "brain");
		header.createSpan({ cls: "claude-rock-thinking-text", text: locale.thinking });

		// Steps container
		this.currentThinkingSteps = this.currentThinkingBlock.createDiv({ cls: "claude-rock-thinking-steps" });
	}

	private updateAssistantMessage(fullText: string): void {
		// If we haven't received text yet, create the streaming text element inside thinking block
		if (!this.hasReceivedText && fullText.trim()) {
			// Save tool steps as separate message before starting text
			if (this.currentMessageThinkingSteps.length > 0) {
				this.saveToolStepsAsMessage();
			}
			this.hasReceivedText = true;
			this.createStreamingTextElement();
		}

		if (!this.currentAssistantMessage) return;

		this.currentAssistantContent = fullText;

		// During streaming: show plain text inside thinking block style
		this.currentAssistantMessage.setText(fullText);

		this.scrollToBottom();
	}

	// Save current tool steps as a separate message (for grouping)
	private saveToolStepsAsMessage(): void {
		if (this.currentMessageThinkingSteps.length === 0) return;

		const message: ChatMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			content: "",
			timestamp: Date.now(),
			thinkingSteps: [...this.currentMessageThinkingSteps]
		};
		this.messages.push(message);
		this.currentMessageThinkingSteps = [];
		this.saveCurrentSession();
	}

	// Save current text as a separate message (for grouping)
	private saveTextAsMessage(): void {
		if (!this.currentAssistantContent.trim()) return;

		// Remove streaming text element
		if (this.currentAssistantMessage) {
			this.currentAssistantMessage.remove();
			this.currentAssistantMessage = null;
		}

		// Capture selection context before it gets cleared
		const selectionContext = this.lastSelectionContext ? { ...this.lastSelectionContext } : undefined;

		// Create final message block
		const msgId = crypto.randomUUID();
		const msgEl = this.messagesContainer.createDiv({
			cls: "claude-rock-message claude-rock-message-assistant"
		});
		msgEl.dataset.id = msgId;

		const contentEl = msgEl.createDiv({ cls: "claude-rock-message-content" });
		MarkdownRenderer.render(
			this.app,
			this.currentAssistantContent,
			contentEl,
			"",
			this
		);
		this.removeEditableAttributes(contentEl);
		this.addCopyButton(msgEl, this.currentAssistantContent, selectionContext);

		// Save to history with selection context
		const message: ChatMessage = {
			id: msgId,
			role: "assistant",
			content: this.currentAssistantContent,
			timestamp: Date.now(),
			selectionContext
		};
		this.messages.push(message);
		this.currentAssistantContent = "";
		this.hasReceivedText = false;
		this.saveCurrentSession();
	}

	private createStreamingTextElement(): void {
		// Mark current thinking block as done (stop animation)
		this.markThinkingDone();

		// Create NEW thinking block for streaming text
		this.currentThinkingBlock = this.messagesContainer.createDiv({
			cls: "claude-rock-thinking-block claude-rock-thinking-done"  // Already "done" style (no animation)
		});

		// Header (same as thinking block)
		const locale = getButtonLocale(this.plugin.settings.language);
		const header = this.currentThinkingBlock.createDiv({ cls: "claude-rock-thinking-header" });
		const iconEl = header.createSpan({ cls: "claude-rock-thinking-icon" });
		setIcon(iconEl, "message-square");  // Different icon for text
		header.createSpan({ cls: "claude-rock-thinking-text", text: locale.agentResponse || "Response" });

		// Steps container with streaming text
		this.currentThinkingSteps = this.currentThinkingBlock.createDiv({ cls: "claude-rock-thinking-steps" });
		this.currentAssistantMessage = this.currentThinkingSteps.createDiv({
			cls: "claude-rock-streaming-text"
		});
	}

	private removeEditableAttributes(el: HTMLElement): void {
		// Remove contenteditable from all child elements
		el.querySelectorAll("[contenteditable]").forEach((child) => {
			child.removeAttribute("contenteditable");
		});
		// Remove tabindex to prevent focus
		el.querySelectorAll("[tabindex]").forEach((child) => {
			child.setAttribute("tabindex", "-1");
		});
	}

	private markThinkingDone(): void {
		if (this.currentThinkingBlock) {
			this.currentThinkingBlock.addClass("claude-rock-thinking-done");
		}
	}

	private finalizeAssistantMessage(): void {
		// Remove streaming text element (it was temporary)
		if (this.currentAssistantMessage) {
			this.currentAssistantMessage.remove();
			this.currentAssistantMessage = null;
		}

		// Mark thinking block as done and clean up empty steps
		if (this.currentThinkingBlock && this.currentThinkingSteps) {
			if (this.currentThinkingSteps.children.length === 0) {
				this.currentThinkingBlock.remove();
			} else {
				this.markThinkingDone();
			}
		}

		// Save message if we have content OR tool steps
		const hasContent = this.currentAssistantContent.trim().length > 0;
		const hasToolSteps = this.currentMessageThinkingSteps.length > 0;

		// Capture selection context before it gets cleared
		const selectionContext = this.lastSelectionContext ? { ...this.lastSelectionContext } : undefined;

		if (hasContent || hasToolSteps) {
			const msgId = crypto.randomUUID();

			// Create message block only if there's text content
			if (hasContent) {
				const msgEl = this.messagesContainer.createDiv({
					cls: "claude-rock-message claude-rock-message-assistant"
				});
				msgEl.dataset.id = msgId;

				const contentEl = msgEl.createDiv({ cls: "claude-rock-message-content" });
				MarkdownRenderer.render(
					this.app,
					this.currentAssistantContent,
					contentEl,
					"",
					this
				);
				this.removeEditableAttributes(contentEl);
				this.addCopyButton(msgEl, this.currentAssistantContent, selectionContext);
			}

			// Save message to history with selection context
			const message: ChatMessage = {
				id: msgId,
				role: "assistant",
				content: this.currentAssistantContent,
				timestamp: Date.now(),
				thinkingSteps: hasToolSteps
					? [...this.currentMessageThinkingSteps]
					: undefined,
				selectionContext
			};
			this.messages.push(message);
			this.saveCurrentSession();
		}

		// Reset all state
		this.currentAssistantMessage = null;
		this.currentAssistantContent = "";
		this.currentThinkingBlock = null;
		this.currentThinkingSteps = null;
		this.hasReceivedText = false;
		this.currentMessageThinkingSteps = [];
	}

	private addCopyButton(messageEl: HTMLElement, content: string, selectionContext?: SelectionContext): void {
		const locale = getButtonLocale(this.plugin.settings.language);
		const actionsEl = messageEl.createDiv({ cls: "claude-rock-message-actions" });

		// Copy button (icon-only)
		const copyBtn = actionsEl.createEl("button", {
			cls: "claude-rock-action-btn-icon",
			attr: { "aria-label": locale.copy, "title": locale.copy }
		});
		setIcon(copyBtn, "copy");

		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(content);
				// Show success feedback
				copyBtn.empty();
				setIcon(copyBtn, "check");
				copyBtn.setAttribute("title", locale.copySuccess);
				copyBtn.addClass("claude-rock-action-btn-success");

				// Reset after 2 seconds
				setTimeout(() => {
					copyBtn.empty();
					setIcon(copyBtn, "copy");
					copyBtn.setAttribute("title", locale.copy);
					copyBtn.removeClass("claude-rock-action-btn-success");
				}, 2000);
			} catch (err) {
				console.error("Failed to copy:", err);
			}
		});

		// Replace button (icon-only)
		const replaceBtn = actionsEl.createEl("button", {
			cls: "claude-rock-action-btn-icon claude-rock-note-action",
			attr: { "aria-label": locale.replace, "title": locale.replace }
		});
		setIcon(replaceBtn, "replace");

		replaceBtn.addEventListener("click", async () => {
			await this.replaceNoteContent(content, replaceBtn, locale, selectionContext);
		});

		// Append button (icon-only)
		const appendBtn = actionsEl.createEl("button", {
			cls: "claude-rock-action-btn-icon claude-rock-note-action",
			attr: { "aria-label": locale.append, "title": locale.append }
		});
		setIcon(appendBtn, "file-plus");

		appendBtn.addEventListener("click", async () => {
			await this.appendToNote(content, appendBtn, locale, selectionContext);
		});

		// New Page button (icon-only)
		const newPageBtn = actionsEl.createEl("button", {
			cls: "claude-rock-action-btn-icon",
			attr: { "aria-label": locale.newPage, "title": locale.newPage }
		});
		setIcon(newPageBtn, "file-plus-2");

		newPageBtn.addEventListener("click", async () => {
			await this.createNewPageWithContent(content, newPageBtn, locale);
		});

		// Update visibility based on active file
		this.updateNoteActionButtons(actionsEl);
	}

	private updateNoteActionButtons(actionsEl: HTMLElement): void {
		const activeFile = this.app.workspace.getActiveFile();
		const noteButtons = actionsEl.querySelectorAll(".claude-rock-note-action");

		noteButtons.forEach(btn => {
			if (activeFile && activeFile.extension === "md") {
				(btn as HTMLElement).style.display = "flex";
			} else {
				(btn as HTMLElement).style.display = "none";
			}
		});
	}

	private updateAllNoteActionButtons(): void {
		const allActions = this.messagesContainer.querySelectorAll(".claude-rock-message-actions");
		allActions.forEach(actionsEl => {
			this.updateNoteActionButtons(actionsEl as HTMLElement);
		});
	}

	private async replaceNoteContent(content: string, btn: HTMLElement, locale: ButtonLocale, selectionContext?: SelectionContext): Promise<void> {
		try {
			// If we have selection context with position, replace only the selected text
			if (selectionContext && selectionContext.filePath) {
				const file = this.app.vault.getAbstractFileByPath(selectionContext.filePath);
				if (file instanceof TFile && file.extension === "md") {
					const currentContent = await this.app.vault.read(file);
					const lines = currentContent.split("\n");

					// Build content before selection
					let before = lines.slice(0, selectionContext.startLine).join("\n");
					if (before) before += "\n";
					before += lines[selectionContext.startLine]?.slice(0, selectionContext.startCh) || "";

					// Build content after selection
					let after = lines[selectionContext.endLine]?.slice(selectionContext.endCh) || "";
					if (selectionContext.endLine < lines.length - 1) {
						after += "\n" + lines.slice(selectionContext.endLine + 1).join("\n");
					}

					// Replace only the selected fragment
					const newContent = before + content + after;
					await this.app.vault.modify(file, newContent);

					// Show success feedback
					this.showButtonSuccess(btn, "check", locale.replaceSuccess, "replace", locale.replace);
					return;
				}
			}

			// Fallback: replace entire active file
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile || activeFile.extension !== "md") {
				return;
			}

			await this.app.vault.modify(activeFile, content);
			this.showButtonSuccess(btn, "check", locale.replaceSuccess, "replace", locale.replace);
		} catch (err) {
			console.error("Failed to replace note content:", err);
		}
	}

	private async appendToNote(content: string, btn: HTMLElement, locale: ButtonLocale, selectionContext?: SelectionContext): Promise<void> {
		try {
			// If we have selection context with position, insert after the selected text
			if (selectionContext && selectionContext.filePath) {
				const file = this.app.vault.getAbstractFileByPath(selectionContext.filePath);
				if (file instanceof TFile && file.extension === "md") {
					const currentContent = await this.app.vault.read(file);
					const lines = currentContent.split("\n");

					// Build content up to end of selection
					let before = lines.slice(0, selectionContext.endLine).join("\n");
					if (before) before += "\n";
					before += lines[selectionContext.endLine]?.slice(0, selectionContext.endCh) || "";

					// Build content after selection
					let after = lines[selectionContext.endLine]?.slice(selectionContext.endCh) || "";
					if (selectionContext.endLine < lines.length - 1) {
						after += "\n" + lines.slice(selectionContext.endLine + 1).join("\n");
					}

					// Insert content right after the selection
					const newContent = before + "\n\n" + content + after;
					await this.app.vault.modify(file, newContent);

					// Show success feedback
					this.showButtonSuccess(btn, "check", locale.appendSuccess, "file-plus", locale.append);
					return;
				}
			}

			// Fallback: append to end of active file
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile || activeFile.extension !== "md") {
				return;
			}

			const currentContent = await this.app.vault.read(activeFile);
			const newContent = currentContent + "\n\n---\n\n" + content;
			await this.app.vault.modify(activeFile, newContent);
			this.showButtonSuccess(btn, "check", locale.appendSuccess, "file-plus", locale.append);
		} catch (err) {
			console.error("Failed to append to note:", err);
		}
	}

	private showButtonSuccess(btn: HTMLElement, successIcon: string, successTitle: string, defaultIcon: string, defaultTitle: string): void {
		btn.empty();
		setIcon(btn, successIcon);
		btn.setAttribute("title", successTitle);
		btn.addClass("claude-rock-action-btn-success");

		setTimeout(() => {
			btn.empty();
			setIcon(btn, defaultIcon);
			btn.setAttribute("title", defaultTitle);
			btn.removeClass("claude-rock-action-btn-success");
		}, 2000);
	}

	private addToolStep(tool: ToolUseBlock): void {
		const locale = getButtonLocale(this.plugin.settings.language);

		// If we already received text, save it as separate message before new tools
		if (this.hasReceivedText) {
			this.saveTextAsMessage();      // Save current text as separate message
			this.hasReceivedText = false;  // Reset so next text creates new response block
			this.createThinkingBlock();    // Create new thinking block after previous response
		}

		// Ensure we have a thinking block
		if (!this.currentThinkingSteps) {
			this.createThinkingBlock();
		}

		if (!this.currentThinkingSteps) return;

		const stepEl = this.currentThinkingSteps.createDiv({ cls: "claude-rock-tool-step" });

		// Header with icon, text, and expand arrow
		const stepHeader = stepEl.createDiv({ cls: "claude-rock-tool-step-header" });

		const iconEl = stepHeader.createSpan({ cls: "claude-rock-tool-step-icon" });
		setIcon(iconEl, this.getToolIcon(tool.name));

		const textEl = stepHeader.createSpan({ cls: "claude-rock-tool-step-text" });
		textEl.setText(this.formatToolStep(tool, locale));

		// Expand arrow
		const expandEl = stepHeader.createSpan({ cls: "claude-rock-tool-step-expand" });
		setIcon(expandEl, "chevron-down");

		// Hidden details block
		const detailsEl = stepEl.createDiv({ cls: "claude-rock-tool-step-details" });
		detailsEl.style.display = "none";
		this.renderToolDetails(detailsEl, tool);

		// Click handler for expand/collapse
		stepHeader.addEventListener("click", () => {
			const isExpanded = detailsEl.style.display !== "none";
			detailsEl.style.display = isExpanded ? "none" : "block";
			stepEl.toggleClass("expanded", !isExpanded);
			expandEl.empty();
			setIcon(expandEl, isExpanded ? "chevron-down" : "chevron-up");
		});

		// Accumulate step for saving to message history
		this.currentMessageThinkingSteps.push(tool);

		this.scrollToBottom();
	}

	private renderToolDetails(container: HTMLElement, tool: ToolUseBlock): void {
		const input = tool.input as Record<string, unknown>;

		switch (tool.name) {
			case "Read":
				container.createDiv({ text: `Path: ${input.file_path}` });
				if (input.offset) container.createDiv({ text: `Offset: ${input.offset}` });
				if (input.limit) container.createDiv({ text: `Limit: ${input.limit}` });
				break;

			case "Grep":
				container.createDiv({ text: `Pattern: ${input.pattern}` });
				if (input.path) container.createDiv({ text: `Path: ${input.path}` });
				if (input.glob) container.createDiv({ text: `Glob: ${input.glob}` });
				break;

			case "Glob":
				container.createDiv({ text: `Pattern: ${input.pattern}` });
				if (input.path) container.createDiv({ text: `Path: ${input.path}` });
				break;

			case "Edit":
				container.createDiv({ text: `File: ${input.file_path}` });
				break;

			case "Write":
				container.createDiv({ text: `File: ${input.file_path}` });
				break;

			case "Delete":
				container.createDiv({ text: `File: ${input.file_path}` });
				break;

			case "WebSearch":
				container.createDiv({ text: `Query: ${input.query}` });
				break;

			case "WebFetch":
				container.createDiv({ text: `URL: ${input.url}` });
				break;

			default:
				const pre = container.createEl("pre");
				pre.setText(JSON.stringify(input, null, 2));
		}
	}

	private formatToolStep(tool: ToolUseBlock, locale: ButtonLocale): string {
		const input = tool.input as Record<string, unknown>;

		switch (tool.name) {
			case "Read":
				const filePath = input.file_path as string || "";
				const fileName = filePath.split("/").pop() || filePath;
				return `${locale.readingFile}: ${fileName}`;

			case "Edit":
			case "Write":
				const editPath = input.file_path as string || "";
				const editName = editPath.split("/").pop() || editPath;
				return tool.name === "Edit"
					? `${locale.editingFile}: ${editName}`
					: `${locale.writingFile}: ${editName}`;

			case "Delete":
				const deletePath = input.file_path as string || "";
				const deleteName = deletePath.split("/").pop() || deletePath;
				return `${locale.deletingFile}: ${deleteName}`;

			case "Grep":
				const pattern = input.pattern as string || "";
				return `${locale.searching}: "${pattern.substring(0, 30)}${pattern.length > 30 ? "..." : ""}"`;

			case "Glob":
				const globPattern = input.pattern as string || "";
				return `${locale.findingFiles}: ${globPattern}`;

			case "WebSearch":
				const query = input.query as string || "";
				return `${locale.webSearch}: "${query.substring(0, 30)}${query.length > 30 ? "..." : ""}"`;

			case "WebFetch":
				const url = input.url as string || "";
				return `${locale.fetchingUrl}: ${url.substring(0, 40)}${url.length > 40 ? "..." : ""}`;

			default:
				return `${locale.usingTool} ${tool.name}`;
		}
	}

	private getToolIcon(toolName: string): string {
		switch (toolName) {
			case "Read":
				return "file-text";
			case "Edit":
				return "edit";
			case "Write":
				return "file-plus";
			case "Delete":
				return "trash";
			case "Grep":
				return "search";
			case "Glob":
				return "folder-search";
			case "WebSearch":
				return "globe";
			case "WebFetch":
				return "download";
			case "Bash":
				return "terminal";
			case "Task":
				return "list-todo";
			default:
				return "wrench";
		}
	}

	private clearToolSteps(): void {
		// Legacy method - no longer needed with new architecture
		if (this.currentThinkingBlock) {
			this.currentThinkingBlock.remove();
			this.currentThinkingBlock = null;
			this.currentThinkingSteps = null;
		}
	}

	private addErrorMessage(error: string): void {
		const msgEl = this.messagesContainer.createDiv({
			cls: "claude-rock-message claude-rock-message-error"
		});

		const contentEl = msgEl.createDiv({ cls: "claude-rock-message-content" });
		contentEl.setText(error);

		this.scrollToBottom();
	}

	private handleRateLimitError(_resetTime: string | null, _originalMessage: string): void {
		// Finalize any pending message (the error message from Claude is already shown in chat)
		this.finalizeAssistantMessage();
		this.setInputEnabled(true);
		this.setStatus("idle");
	}

	private setStatus(status: "idle" | "loading" | "streaming" | "error", message?: string): void {
		this.statusEl.empty();
		this.statusEl.removeClass("claude-rock-status-error", "claude-rock-status-loading", "claude-rock-status-streaming");

		// Only show status bar for errors
		if (status === "error") {
			this.statusEl.addClass("claude-rock-status-error");
			this.statusEl.setText(message || "An error occurred");
			this.statusEl.style.display = "block";
		} else {
			// Hide status bar for non-error states
			this.statusEl.style.display = "none";
		}
	}

	private setInputEnabled(enabled: boolean): void {
		this.isGenerating = !enabled;
		this.sendButton.empty();

		if (this.isGenerating) {
			// Loading state: grey background with spinner
			setIcon(this.sendButton, "loader-2");
			this.sendButton.setAttribute("aria-label", "Stop generation");
			this.sendButton.addClass("claude-rock-send-btn-loading");
			this.sendButton.removeClass("claude-rock-send-btn-stop");

			// Hover listeners: show stop icon on hover
			this.sendButton.addEventListener("mouseenter", this.showStopIcon);
			this.sendButton.addEventListener("mouseleave", this.showLoaderIcon);
		} else {
			// Idle state: purple background with arrow
			setIcon(this.sendButton, "arrow-up");
			this.sendButton.setAttribute("aria-label", "Send message");
			this.sendButton.removeClass("claude-rock-send-btn-loading");
			this.sendButton.removeClass("claude-rock-send-btn-stop");

			// Remove hover listeners
			this.sendButton.removeEventListener("mouseenter", this.showStopIcon);
			this.sendButton.removeEventListener("mouseleave", this.showLoaderIcon);
		}

		// Focus input when generation completes
		if (enabled) {
			this.inputEl.focus();
		}
	}

	private showStopIcon = (): void => {
		if (this.isGenerating) {
			this.sendButton.empty();
			setIcon(this.sendButton, "square");
		}
	};

	private showLoaderIcon = (): void => {
		if (this.isGenerating) {
			this.sendButton.empty();
			setIcon(this.sendButton, "loader-2");
		}
	};

	private scrollToBottom(): void {
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	// =========================================================================
	// Slash Command Autocomplete
	// =========================================================================

	private autoResizeInput(): void {
		// Reset height to auto to get correct scrollHeight
		this.inputEl.style.height = "auto";
		// Set height based on content, respecting max-height from CSS
		const maxHeight = 200;
		const newHeight = Math.min(this.inputEl.scrollHeight, maxHeight);
		this.inputEl.style.height = newHeight + "px";
		// Show scrollbar if content exceeds max height
		this.inputEl.style.overflowY = this.inputEl.scrollHeight > maxHeight ? "auto" : "hidden";
	}

	private handleInputChange(): void {
		const value = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart ?? 0;

		// Check for @ mention
		const textBeforeCursor = value.slice(0, cursorPos);
		const atIndex = textBeforeCursor.lastIndexOf("@");

		if (atIndex !== -1) {
			const query = textBeforeCursor.slice(atIndex + 1);
			// Only show autocomplete if no space after @ (still typing file name)
			if (!query.includes(" ") && !query.includes("\n")) {
				this.mentionStartIndex = atIndex;
				this.showMentionAutocomplete(query);
				this.hideAutocomplete();
				return;
			}
		}

		this.hideMentionAutocomplete();

		// Check if input starts with /
		if (value.startsWith("/")) {
			const commands = getAvailableCommands(
				this.plugin.settings.customCommands,
				this.plugin.settings.disabledBuiltinCommands,
				this.plugin.settings.language
			);

			// Extract command part (before any space)
			const commandPart = value.split(" ")[0] ?? "/";
			this.filteredCommands = filterCommands(commands, commandPart);

			// Hide /model command if session has started (model is locked)
			if (this.sessionStarted) {
				this.filteredCommands = this.filteredCommands.filter(cmd => cmd.command !== "/model");
			}

			if (this.filteredCommands.length > 0) {
				this.showAutocomplete();
			} else {
				this.hideAutocomplete();
			}
		} else {
			// Don't hide if difficulty autocomplete is visible
			if (!this.difficultyAutocompleteVisible) {
				this.hideAutocomplete();
			}
		}
	}

	private showAutocomplete(): void {
		if (!this.autocompleteEl) return;

		this.autocompleteEl.empty();
		this.autocompleteVisible = true;
		this.selectedCommandIndex = 0;

		for (const cmd of this.filteredCommands) {
			const item = this.autocompleteEl.createDiv({
				cls: "claude-rock-autocomplete-item"
			});

			const iconEl = item.createSpan({ cls: "claude-rock-autocomplete-icon" });
			setIcon(iconEl, cmd.icon);

			const textEl = item.createDiv({ cls: "claude-rock-autocomplete-text" });
			textEl.createSpan({ cls: "claude-rock-autocomplete-name", text: cmd.command });
			textEl.createSpan({ cls: "claude-rock-autocomplete-desc", text: cmd.description });

			const index = this.filteredCommands.indexOf(cmd);
			item.addEventListener("click", () => this.selectCommand(index));
			item.addEventListener("mouseenter", () => this.highlightCommand(index));
		}

		// Highlight first item
		const firstItem = this.autocompleteEl.querySelector(".claude-rock-autocomplete-item");
		if (firstItem) {
			firstItem.addClass("claude-rock-autocomplete-item-selected");
		}

		this.autocompleteEl.addClass("claude-rock-autocomplete-visible");
	}

	private hideAutocomplete(): void {
		if (!this.autocompleteEl) return;

		this.autocompleteVisible = false;
		this.autocompleteEl.removeClass("claude-rock-autocomplete-visible");
		this.autocompleteEl.empty();
	}

	private highlightCommand(index: number): void {
		if (!this.autocompleteEl) return;

		const items = this.autocompleteEl.querySelectorAll(".claude-rock-autocomplete-item");
		items.forEach((item, i) => {
			if (i === index) {
				item.addClass("claude-rock-autocomplete-item-selected");
			} else {
				item.removeClass("claude-rock-autocomplete-item-selected");
			}
		});
		this.selectedCommandIndex = index;
	}

	private selectNextCommand(): void {
		const nextIndex = (this.selectedCommandIndex + 1) % this.filteredCommands.length;
		this.highlightCommand(nextIndex);
		this.scrollAutocompleteToSelected();
	}

	private selectPrevCommand(): void {
		const prevIndex = this.selectedCommandIndex === 0
			? this.filteredCommands.length - 1
			: this.selectedCommandIndex - 1;
		this.highlightCommand(prevIndex);
		this.scrollAutocompleteToSelected();
	}

	private scrollAutocompleteToSelected(): void {
		if (!this.autocompleteEl) return;

		const selected = this.autocompleteEl.querySelector(".claude-rock-autocomplete-item-selected");
		if (selected) {
			selected.scrollIntoView({ block: "nearest" });
		}
	}

	private selectCommand(index: number): void {
		const command = this.filteredCommands[index];
		if (!command) return;

		// Special handling for /difficulty command
		if (command.command === "/difficulty") {
			this.inputEl.value = "";
			this.hideAutocomplete();
			this.showDifficultyAutocomplete();
			return;
		}

		// Check if command needs an argument
		const needsArg = command.prompt.includes("{arg}");
		if (needsArg) {
			// Set input to command + space for user to type argument
			this.inputEl.value = command.command + " ";
			this.hideAutocomplete();
			this.inputEl.focus();

			// Move cursor to end
			this.inputEl.selectionStart = this.inputEl.value.length;
			this.inputEl.selectionEnd = this.inputEl.value.length;
		} else {
			// Auto-send command that doesn't need arguments
			this.inputEl.value = command.command;
			this.hideAutocomplete();
			this.sendMessage();
		}
	}

	private processSlashCommand(input: string): string | null {
		const parsed = parseCommand(input);
		if (!parsed) return null;

		const commands = getAvailableCommands(
			this.plugin.settings.customCommands,
			this.plugin.settings.disabledBuiltinCommands,
			this.plugin.settings.language
		);

		const command = commands.find(cmd => cmd.command === parsed.command);
		if (!command) return null;

		return buildCommandPrompt(command, parsed.arg);
	}

	// =========================================================================
	// @ Mention Autocomplete
	// =========================================================================

	private searchFiles(query: string): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const lowerQuery = query.toLowerCase();
		return files
			.filter(f => f.basename.toLowerCase().includes(lowerQuery))
			.sort((a, b) => {
				// Prioritize files that start with the query
				const aStarts = a.basename.toLowerCase().startsWith(lowerQuery);
				const bStarts = b.basename.toLowerCase().startsWith(lowerQuery);
				if (aStarts && !bStarts) return -1;
				if (!aStarts && bStarts) return 1;
				return a.basename.localeCompare(b.basename);
			})
			.slice(0, 10);
	}

	private showMentionAutocomplete(query: string): void {
		if (!this.mentionAutocompleteEl) return;

		this.filteredFiles = this.searchFiles(query);
		if (this.filteredFiles.length === 0) {
			this.hideMentionAutocomplete();
			return;
		}

		this.mentionAutocompleteEl.empty();
		this.mentionAutocompleteVisible = true;
		this.selectedFileIndex = 0;

		for (const file of this.filteredFiles) {
			const item = this.mentionAutocompleteEl.createDiv({
				cls: "claude-rock-autocomplete-item"
			});

			const iconEl = item.createSpan({ cls: "claude-rock-autocomplete-icon" });
			setIcon(iconEl, "file-text");

			const textEl = item.createDiv({ cls: "claude-rock-autocomplete-text" });
			textEl.createSpan({ cls: "claude-rock-autocomplete-name", text: file.basename });
			textEl.createSpan({ cls: "claude-rock-autocomplete-desc", text: file.path });

			const index = this.filteredFiles.indexOf(file);
			item.addEventListener("click", () => this.selectFile(index));
			item.addEventListener("mouseenter", () => this.highlightFile(index));
		}

		// Highlight first item
		const firstItem = this.mentionAutocompleteEl.querySelector(".claude-rock-autocomplete-item");
		if (firstItem) {
			firstItem.addClass("claude-rock-autocomplete-item-selected");
		}

		this.mentionAutocompleteEl.addClass("claude-rock-autocomplete-visible");
	}

	private hideMentionAutocomplete(): void {
		if (!this.mentionAutocompleteEl) return;

		this.mentionAutocompleteVisible = false;
		this.mentionAutocompleteEl.removeClass("claude-rock-autocomplete-visible");
		this.mentionAutocompleteEl.empty();
		this.mentionStartIndex = -1;
	}

	private highlightFile(index: number): void {
		if (!this.mentionAutocompleteEl) return;

		const items = this.mentionAutocompleteEl.querySelectorAll(".claude-rock-autocomplete-item");
		items.forEach((item, i) => {
			if (i === index) {
				item.addClass("claude-rock-autocomplete-item-selected");
			} else {
				item.removeClass("claude-rock-autocomplete-item-selected");
			}
		});
		this.selectedFileIndex = index;
	}

	private selectNextFile(): void {
		const nextIndex = (this.selectedFileIndex + 1) % this.filteredFiles.length;
		this.highlightFile(nextIndex);
		this.scrollMentionAutocompleteToSelected();
	}

	private selectPrevFile(): void {
		const prevIndex = this.selectedFileIndex === 0
			? this.filteredFiles.length - 1
			: this.selectedFileIndex - 1;
		this.highlightFile(prevIndex);
		this.scrollMentionAutocompleteToSelected();
	}

	private scrollMentionAutocompleteToSelected(): void {
		if (!this.mentionAutocompleteEl) return;

		const selected = this.mentionAutocompleteEl.querySelector(".claude-rock-autocomplete-item-selected");
		if (selected) {
			selected.scrollIntoView({ block: "nearest" });
		}
	}

	private selectFile(index: number): void {
		const file = this.filteredFiles[index];
		if (!file || this.mentionStartIndex === -1) return;

		// Replace @query with @filename
		const text = this.inputEl.value;
		const before = text.slice(0, this.mentionStartIndex);
		const cursorPos = this.inputEl.selectionStart ?? text.length;
		const after = text.slice(cursorPos);

		this.inputEl.value = before + "@" + file.basename + " " + after;

		// Add to mentioned files if not already there
		if (!this.mentionedFiles.find(f => f.path === file.path)) {
			this.mentionedFiles.push(file);
		}

		this.hideMentionAutocomplete();
		this.inputEl.focus();

		// Move cursor after the inserted mention
		const newCursorPos = before.length + 1 + file.basename.length + 1;
		this.inputEl.selectionStart = newCursorPos;
		this.inputEl.selectionEnd = newCursorPos;
	}

	private async getMentionedFilesContext(): Promise<string> {
		const contexts: string[] = [];

		for (const file of this.mentionedFiles) {
			try {
				const content = await this.app.vault.read(file);
				contexts.push(`[File: ${file.basename}]\n${content}`);
			} catch {
				// File might have been deleted
			}
		}

		return contexts.join("\n\n---\n\n");
	}

	private clearMentionedFiles(): void {
		this.mentionedFiles = [];
	}

	private async createNewPageWithContent(content: string, btn: HTMLElement, locale: ButtonLocale): Promise<void> {
		// Generate default filename: "Ответ агента, YYYY-MM-DD HH:mm"
		const now = new Date();
		const dateStr = now.toLocaleString(this.plugin.settings.language === "ru" ? "ru-RU" : "en-US", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit"
		}).replace(/[/:]/g, "-");
		const defaultName = `${locale.agentResponse}, ${dateStr}`;

		// Show modal to get filename
		new FileNameModal(this.app, defaultName, locale.createNewPage, async (filename) => {
			if (!filename) return;

			// Ensure .md extension
			const finalName = filename.endsWith(".md") ? filename : filename + ".md";

			try {
				// Create file in vault root
				const file = await this.app.vault.create(finalName, content);

				// Open the created file
				await this.app.workspace.getLeaf(false).openFile(file);

				// Show success feedback
				btn.empty();
				setIcon(btn, "check");
				btn.setAttribute("title", locale.newPageSuccess);
				btn.addClass("claude-rock-action-btn-success");

				setTimeout(() => {
					btn.empty();
					setIcon(btn, "file-plus-2");
					btn.setAttribute("title", locale.newPage);
					btn.removeClass("claude-rock-action-btn-success");
				}, 2000);
			} catch (err) {
				console.error("Failed to create new page:", err);
			}
		}).open();
	}

	private async handleFileAttachment(file: File): Promise<void> {
		const locale = getButtonLocale(this.plugin.settings.language);

		try {
			const maxSize = 10 * 1024 * 1024; // 10MB
			if (file.size > maxSize) {
				this.addErrorMessage(`${locale.fileTooLarge || "File too large"}: ${file.name}`);
				return;
			}

			const ext = file.name.split(".").pop()?.toLowerCase() || "";
			const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
			const isText = ["md", "txt", "json", "yaml", "yml", "js", "ts", "tsx", "jsx", "py", "java", "cpp", "c", "h", "go", "rs", "rb", "php", "html", "css", "xml", "csv"].includes(ext);
			const isBinary = ["pdf", "xlsx", "docx"].includes(ext);

			let content = "";

			if (isImage) {
				const reader = new FileReader();
				content = await new Promise<string>((resolve, reject) => {
					reader.onload = () => resolve(reader.result as string);
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});
			} else if (isText) {
				const reader = new FileReader();
				content = await new Promise<string>((resolve, reject) => {
					reader.onload = () => resolve(reader.result as string);
					reader.onerror = reject;
					reader.readAsText(file);
				});
			} else if (isBinary) {
				content = `[Binary file: ${file.name}]`;
			} else {
				this.addErrorMessage(`${locale.unsupportedFileType || "Unsupported file type"}: ${ext}`);
				return;
			}

			this.attachedFiles.push({ name: file.name, content, type: ext });
			this.updateFileContextIndicator();

		} catch (err) {
			console.error("Failed to attach file:", err);
			this.addErrorMessage(`${locale.fileAttachError || "Failed to attach file"}: ${file.name}`);
		}
	}

	private getFileBasename(filename: string): string {
		return filename.replace(/\.[^/.]+$/, "");
	}

	private getFileIcon(type: string): string {
		const imageTypes = ["png", "jpg", "jpeg", "gif", "webp"];
		const codeTypes = ["js", "ts", "tsx", "jsx", "py", "java", "cpp", "c", "h", "go", "rs", "rb", "php"];
		const docTypes = ["md", "txt", "pdf", "docx"];
		const configTypes = ["json", "yaml", "yml", "xml"];

		if (imageTypes.includes(type)) return "image";
		if (codeTypes.includes(type)) return "code";
		if (docTypes.includes(type)) return "file-text";
		if (configTypes.includes(type)) return "settings";
		return "file";
	}

	private removeAttachedFile(fileName: string): void {
		this.attachedFiles = this.attachedFiles.filter(f => f.name !== fileName);
		this.updateFileContextIndicator();
	}

	private clearAttachedFiles(): void {
		this.attachedFiles = [];
		this.updateFileContextIndicator();
	}
}

/**
 * Modal for entering filename when creating new page
 */
class FileNameModal extends Modal {
	private defaultName: string;
	private title: string;
	private onSubmit: (result: string | null) => void;
	private inputEl!: TextComponent;

	constructor(app: import("obsidian").App, defaultName: string, title: string, onSubmit: (result: string | null) => void) {
		super(app);
		this.defaultName = defaultName;
		this.title = title;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("claude-rock-filename-modal");

		contentEl.createEl("h3", { text: this.title });

		const inputContainer = contentEl.createDiv({ cls: "claude-rock-filename-input-container" });
		this.inputEl = new TextComponent(inputContainer);
		this.inputEl.inputEl.addClass("claude-rock-filename-input");
		this.inputEl.setValue(this.defaultName);
		this.inputEl.inputEl.select();

		// Handle Enter key
		this.inputEl.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});

		const buttonContainer = contentEl.createDiv({ cls: "claude-rock-modal-buttons" });

		const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.onSubmit(null);
			this.close();
		});

		const createBtn = buttonContainer.createEl("button", {
			text: "Create",
			cls: "mod-cta"
		});
		createBtn.addEventListener("click", () => this.submit());

		// Focus input after modal opens
		setTimeout(() => this.inputEl.inputEl.focus(), 50);
	}

	private submit(): void {
		const value = this.inputEl.getValue().trim();
		if (value) {
			this.onSubmit(value);
		}
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
