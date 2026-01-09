import { App, PluginSettingTab, Setting, Modal, TextComponent, setIcon } from "obsidian";
import type ClaudeRockPlugin from "./main";
import type { SlashCommand, LanguageCode, ClaudeModel } from "./types";
import { CLAUDE_MODELS } from "./types";
import { getBuiltinCommands } from "./commands";
import { LANGUAGE_NAMES } from "./systemPrompts";
import { checkCLIInstalled } from "./cliDetector";
import { getSettingsLocale, type SettingsLocale } from "./settingsLocales";

export class ClaudeRockSettingTab extends PluginSettingTab {
	plugin: ClaudeRockPlugin;
	private locale!: SettingsLocale;

	constructor(app: App, plugin: ClaudeRockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Update locale on each render
		this.locale = getSettingsLocale(this.plugin.settings.language);

		// Display usage section first
		this.displayUsageSection(containerEl);

		new Setting(containerEl)
			.setName(this.locale.cliPath)
			.setDesc(this.locale.cliPathDesc)
			.addText(text => text
				.setPlaceholder("claude")
				.setValue(this.plugin.settings.cliPath)
				.onChange(async (value) => {
					this.plugin.settings.cliPath = value || "claude";
					await this.plugin.saveSettings();
					// Refresh CLI status when path changes
					this.checkAndDisplayCLIStatus(cliStatusEl);
				}));

		// CLI Status indicator
		const cliStatusEl = containerEl.createDiv({ cls: "claude-rock-cli-status" });
		this.checkAndDisplayCLIStatus(cliStatusEl);

		// Language selection
		new Setting(containerEl)
			.setName(this.locale.assistantLanguage)
			.setDesc(this.locale.assistantLanguageDesc)
			.addDropdown(dropdown => {
				// Add all language options
				for (const [code, name] of Object.entries(LANGUAGE_NAMES)) {
					dropdown.addOption(code, name);
				}
				dropdown
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value as LanguageCode;
						await this.plugin.saveSettings();
						// Redraw settings with new language
						this.display();
					});
			});

		// CLAUDE.md Editor Section
		new Setting(containerEl)
			.setName(this.locale.systemInstructions)
			.setDesc(this.locale.systemInstructionsDesc)
			.addButton(button => button
				.setButtonText(this.locale.editButton)
				.onClick(() => {
					new ClaudeMdModal(this.app, this.plugin).open();
				}));

		// Default model selection
		new Setting(containerEl)
			.setName(this.locale.defaultModel)
			.setDesc(this.locale.defaultModelDesc)
			.addDropdown(dropdown => {
				for (const model of CLAUDE_MODELS) {
					dropdown.addOption(model.value, model.label);
				}
				dropdown
					.setValue(this.plugin.settings.defaultModel)
					.onChange(async (value) => {
						this.plugin.settings.defaultModel = value as ClaudeModel;
						await this.plugin.saveSettings();
					});
			});

		// Deep thinking mode
		new Setting(containerEl)
			.setName(this.locale.deepThinking)
			.setDesc(this.locale.deepThinkingDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.thinkingEnabled)
				.onChange(async (value) => {
					this.plugin.settings.thinkingEnabled = value;
					await this.plugin.saveSettings();
				}));

		// Permissions section
		containerEl.createEl("h3", { text: this.locale.claudePermissions });

		containerEl.createEl("p", {
			cls: "claude-rock-settings-note",
			text: this.locale.permissionsNote
		});

		new Setting(containerEl)
			.setName(this.locale.webSearch)
			.setDesc(this.locale.webSearchDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.permissions.webSearch)
				.onChange(async (value) => {
					this.plugin.settings.permissions.webSearch = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.locale.webFetch)
			.setDesc(this.locale.webFetchDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.permissions.webFetch)
				.onChange(async (value) => {
					this.plugin.settings.permissions.webFetch = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.locale.subAgents)
			.setDesc(this.locale.subAgentsDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.permissions.task)
				.onChange(async (value) => {
					this.plugin.settings.permissions.task = value;
					await this.plugin.saveSettings();
				}));

		// Slash Commands section
		containerEl.createEl("h3", { text: this.locale.slashCommands });

		containerEl.createEl("p", {
			cls: "claude-rock-settings-note",
			text: this.locale.slashCommandsNote
		});

		// Built-in commands
		containerEl.createEl("h4", { text: this.locale.builtinCommands });

		const builtinCommands = getBuiltinCommands(this.plugin.settings.language);
		for (const cmd of builtinCommands) {
			const isDisabled = this.plugin.settings.disabledBuiltinCommands.includes(cmd.id);

			new Setting(containerEl)
				.setName(cmd.command)
				.setDesc(cmd.description)
				.addToggle(toggle => toggle
					.setValue(!isDisabled)
					.onChange(async (value) => {
						if (value) {
							// Enable: remove from disabled list
							this.plugin.settings.disabledBuiltinCommands =
								this.plugin.settings.disabledBuiltinCommands.filter(id => id !== cmd.id);
						} else {
							// Disable: add to disabled list
							this.plugin.settings.disabledBuiltinCommands.push(cmd.id);
						}
						await this.plugin.saveSettings();
					}));
		}

		// Custom commands
		containerEl.createEl("h4", { text: this.locale.customCommands });

		new Setting(containerEl)
			.setName(this.locale.addCustomCommand)
			.setDesc(this.locale.addCustomCommandDesc)
			.addButton(button => button
				.setButtonText(this.locale.addButton)
				.onClick(() => {
					new CommandModal(this.app, this.plugin, null, () => {
						this.display(); // Refresh the settings view
					}).open();
				}));

		// Display existing custom commands
		for (const cmd of this.plugin.settings.customCommands) {
			new Setting(containerEl)
				.setName(cmd.command)
				.setDesc(cmd.description)
				.addButton(button => button
					.setButtonText(this.locale.editButton)
					.onClick(() => {
						new CommandModal(this.app, this.plugin, cmd, () => {
							this.display();
						}).open();
					}))
				.addButton(button => button
					.setButtonText(this.locale.deleteButton)
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.customCommands =
							this.plugin.settings.customCommands.filter(c => c.id !== cmd.id);
						await this.plugin.saveSettings();
						this.display();
					}));
		}

		// Prerequisites section at the bottom (collapsible)
		this.displayPrerequisites(containerEl);
	}

	private displayPrerequisites(containerEl: HTMLElement): void {
		const isDismissed = this.plugin.settings.gettingStartedDismissed;

		// Collapsible header
		const headerEl = containerEl.createDiv({ cls: "claude-rock-getting-started-header" });
		const chevronEl = headerEl.createSpan({ cls: "claude-rock-getting-started-chevron" });
		setIcon(chevronEl, isDismissed ? "chevron-right" : "chevron-down");
		headerEl.createEl("h3", { text: this.locale.gettingStarted });

		// Content container (collapsible)
		const contentEl = containerEl.createDiv({ cls: "claude-rock-getting-started-content" });
		if (isDismissed) {
			contentEl.style.display = "none";
		}

		// Toggle on header click
		headerEl.addEventListener("click", () => {
			const isHidden = contentEl.style.display === "none";
			contentEl.style.display = isHidden ? "block" : "none";
			chevronEl.empty();
			setIcon(chevronEl, isHidden ? "chevron-down" : "chevron-right");
		});

		const infoEl = contentEl.createDiv({ cls: "claude-rock-settings-info" });

		const steps = infoEl.createEl("ol");

		// Step 1: Open Terminal
		const step1 = steps.createEl("li");
		step1.createEl("strong", { text: this.locale.step1Title });
		step1.createEl("br");
		step1.createEl("span", {
			cls: "claude-rock-settings-note",
			text: this.locale.step1MacOS
		});
		step1.createEl("br");
		step1.createEl("span", {
			cls: "claude-rock-settings-note",
			text: this.locale.step1Windows
		});

		// Step 2: Install CLI
		const step2 = steps.createEl("li");
		step2.createEl("strong", { text: this.locale.step2Title });
		step2.createEl("br");
		step2.createEl("code", { text: "npm i -g @anthropic-ai/claude-code" });

		// Step 3: Wait and run claude
		const step3 = steps.createEl("li");
		step3.createEl("strong", { text: this.locale.step3Title });
		step3.createEl("br");
		step3.createEl("code", { text: "claude" });

		// Step 4: Choose login method
		const step4 = steps.createEl("li");
		step4.createEl("strong", { text: this.locale.step4Title });
		step4.createEl("br");
		step4.createEl("span", {
			cls: "claude-rock-settings-note",
			text: this.locale.step4Note
		});

		// Step 5: Complete auth
		const step5 = steps.createEl("li");
		step5.createEl("strong", { text: this.locale.step5Title });
		step5.createEl("br");
		step5.createEl("span", {
			cls: "claude-rock-settings-note",
			text: this.locale.step5Note
		});

		// Step 6: Enter auth code
		const step6 = steps.createEl("li");
		step6.createEl("strong", { text: this.locale.step6Title });
		step6.createEl("br");
		step6.createEl("span", {
			cls: "claude-rock-settings-note",
			text: this.locale.step6Note
		});

		// Step 7: Grant permissions
		const step7 = steps.createEl("li");
		step7.createEl("strong", { text: this.locale.step7Title });
		step7.createEl("br");
		step7.createEl("span", {
			cls: "claude-rock-settings-note",
			text: this.locale.step7Note
		});

		// Step 8: Return
		const step8 = steps.createEl("li");
		step8.createEl("strong", { text: this.locale.step8Title });

		infoEl.createEl("p", {
			cls: "claude-rock-settings-note",
			text: this.locale.subscriptionNote
		});

		// "Already Done" button
		const buttonContainer = contentEl.createDiv({ cls: "claude-rock-getting-started-actions" });
		const doneBtn = buttonContainer.createEl("button", {
			cls: "mod-cta",
			text: this.locale.alreadyDoneButton
		});
		doneBtn.addEventListener("click", async () => {
			this.plugin.settings.gettingStartedDismissed = true;
			await this.plugin.saveSettings();
			contentEl.style.display = "none";
			chevronEl.empty();
			setIcon(chevronEl, "chevron-right");
		});
	}

	private displayUsageSection(containerEl: HTMLElement): void {
		const usageSection = containerEl.createDiv({ cls: "claude-rock-usage-section" });
		usageSection.createEl("h3", { text: this.locale.usageStatistics });

		// Calculate stats from plugin sessions
		const stats = this.calculateUsageStats();

		// Inline compact format
		const inline = usageSection.createDiv({ cls: "claude-rock-stats-inline" });
		this.createStatInline(inline, this.locale.today, this.formatTokens(stats.todayTokens));
		this.createStatInline(inline, this.locale.week, this.formatTokens(stats.weekTokens));
		this.createStatInline(inline, this.locale.month, this.formatTokens(stats.monthTokens));
	}

	private calculateUsageStats(): { todayTokens: number; weekTokens: number; monthTokens: number } {
		const now = new Date();
		const todayStr = now.toISOString().split("T")[0] as string;

		// Week start (Monday)
		const weekStart = new Date(now);
		weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
		weekStart.setHours(0, 0, 0, 0);

		// Month start
		const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

		let todayTokens = 0;
		let weekTokens = 0;
		let monthTokens = 0;

		const tokenHistory = this.plugin.getTokenHistory();

		for (const [dateStr, tokens] of Object.entries(tokenHistory)) {
			const date = new Date(dateStr);

			if (dateStr === todayStr) {
				todayTokens += tokens;
			}
			if (date >= weekStart) {
				weekTokens += tokens;
			}
			if (date >= monthStart) {
				monthTokens += tokens;
			}
		}

		return { todayTokens, weekTokens, monthTokens };
	}

	private createStatInline(container: HTMLElement, label: string, value: string): void {
		const item = container.createDiv({ cls: "claude-rock-stat-inline" });
		item.createSpan({ cls: "claude-rock-stat-inline-label", text: label });
		item.createSpan({ cls: "claude-rock-stat-inline-value", text: value });
	}

	private formatTokens(tokens: number): string {
		if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
		if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
		return String(tokens);
	}

	private async checkAndDisplayCLIStatus(container: HTMLElement): Promise<void> {
		container.empty();
		container.createEl("span", {
			cls: "claude-rock-cli-status-checking",
			text: this.locale.checkingCli
		});

		const status = await checkCLIInstalled(this.plugin.settings.cliPath);

		container.empty();

		if (status.installed) {
			// CLI Found
			const foundEl = container.createDiv({ cls: "claude-rock-cli-status-item claude-rock-cli-status-success" });
			const iconSpan = foundEl.createSpan({ cls: "claude-rock-cli-status-icon" });
			setIcon(iconSpan, "check-circle");
			foundEl.createSpan({ text: this.locale.cliFound.replace("{version}", status.version || "?") });
		} else {
			// CLI Not Found
			const errorEl = container.createDiv({ cls: "claude-rock-cli-status-item claude-rock-cli-status-error" });
			const iconSpan = errorEl.createSpan({ cls: "claude-rock-cli-status-icon" });
			setIcon(iconSpan, "x-circle");
			errorEl.createSpan({ text: this.locale.cliNotFound });

			// Installation hint
			container.createEl("p", {
				cls: "claude-rock-settings-note",
				text: this.locale.installWith
			});
		}

		// Refresh button
		const refreshBtn = container.createEl("button", {
			text: this.locale.refreshButton,
			cls: "claude-rock-cli-refresh-btn"
		});
		refreshBtn.addEventListener("click", () => {
			this.checkAndDisplayCLIStatus(container);
		});
	}
}

/**
 * Modal for creating/editing custom slash commands
 */
class CommandModal extends Modal {
	private plugin: ClaudeRockPlugin;
	private command: SlashCommand | null;
	private onSave: () => void;

	private nameInput!: TextComponent;
	private commandInput!: TextComponent;
	private descInput!: TextComponent;

	private get locale(): SettingsLocale {
		return getSettingsLocale(this.plugin.settings.language);
	}

	constructor(app: App, plugin: ClaudeRockPlugin, command: SlashCommand | null, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.command = command;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", {
			text: this.command ? this.locale.editCommand : this.locale.newCustomCommand
		});

		// Name field
		new Setting(contentEl)
			.setName(this.locale.nameField)
			.setDesc(this.locale.nameFieldDesc)
			.addText(text => {
				this.nameInput = text;
				text.setPlaceholder(this.locale.namePlaceholder)
					.setValue(this.command?.name ?? "");
			});

		// Command field
		new Setting(contentEl)
			.setName(this.locale.commandField)
			.setDesc(this.locale.commandFieldDesc)
			.addText(text => {
				this.commandInput = text;
				text.setPlaceholder(this.locale.commandPlaceholder)
					.setValue(this.command?.command ?? "/");
			});

		// Description field
		new Setting(contentEl)
			.setName(this.locale.descriptionField)
			.setDesc(this.locale.descriptionFieldDesc)
			.addText(text => {
				this.descInput = text;
				text.setPlaceholder(this.locale.descriptionPlaceholder)
					.setValue(this.command?.description ?? "");
			});

		// Prompt field
		const promptSetting = new Setting(contentEl)
			.setName(this.locale.promptField)
			.setDesc(this.locale.promptFieldDesc);

		const promptContainer = contentEl.createDiv({ cls: "claude-rock-prompt-container" });
		const promptTextarea = promptContainer.createEl("textarea", {
			cls: "claude-rock-prompt-textarea",
			attr: { rows: "4", placeholder: this.locale.promptPlaceholder }
		});
		promptTextarea.value = this.command?.prompt ?? "";

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "claude-rock-modal-buttons" });

		const cancelBtn = buttonContainer.createEl("button", { text: this.locale.cancelButton });
		cancelBtn.addEventListener("click", () => this.close());

		const saveBtn = buttonContainer.createEl("button", {
			text: this.locale.saveButton,
			cls: "mod-cta"
		});
		saveBtn.addEventListener("click", async () => {
			await this.save(promptTextarea.value);
		});
	}

	private async save(promptValue: string): Promise<void> {
		const name = this.nameInput.getValue().trim();
		const command = this.commandInput.getValue().trim();
		const description = this.descInput.getValue().trim();
		const prompt = promptValue.trim();

		// Validation
		if (!name || !command || !description || !prompt) {
			// TODO: Show error
			return;
		}

		// Ensure command starts with /
		const finalCommand = command.startsWith("/") ? command : "/" + command;

		if (this.command) {
			// Editing existing command
			const idx = this.plugin.settings.customCommands.findIndex(c => c.id === this.command!.id);
			if (idx !== -1) {
				this.plugin.settings.customCommands[idx] = {
					...this.command,
					name,
					command: finalCommand,
					description,
					prompt
				};
			}
		} else {
			// Creating new command
			const newCommand: SlashCommand = {
				id: crypto.randomUUID(),
				name,
				command: finalCommand,
				description,
				prompt,
				icon: "terminal",
				isBuiltin: false,
				enabled: true
			};
			this.plugin.settings.customCommands.push(newCommand);
		}

		await this.plugin.saveSettings();
		this.onSave();
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for editing CLAUDE.md system instructions
 */
class ClaudeMdModal extends Modal {
	private plugin: ClaudeRockPlugin;
	private textarea!: HTMLTextAreaElement;

	private get locale(): SettingsLocale {
		return getSettingsLocale(this.plugin.settings.language);
	}

	constructor(app: App, plugin: ClaudeRockPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("claude-rock-claudemd-modal");

		contentEl.createEl("h2", { text: this.locale.systemInstructionsTitle });

		contentEl.createEl("p", {
			cls: "claude-rock-settings-note",
			text: this.locale.systemInstructionsModalDesc
		});

		// Textarea container
		const container = contentEl.createDiv({ cls: "claude-rock-claudemd-container" });
		this.textarea = container.createEl("textarea", {
			cls: "claude-rock-claudemd-textarea",
			attr: { rows: "16", placeholder: this.locale.loadingPlaceholder }
		});

		// Load current content
		const content = await this.plugin.readClaudeMd();
		this.textarea.value = content || this.plugin.getDefaultClaudeMdContent();

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "claude-rock-modal-buttons" });

		const resetBtn = buttonContainer.createEl("button", { text: this.locale.resetToDefaultButton });
		resetBtn.addEventListener("click", async () => {
			const defaultContent = this.plugin.getDefaultClaudeMdContent();
			this.textarea.value = defaultContent;
		});

		const saveBtn = buttonContainer.createEl("button", {
			text: this.locale.saveButton,
			cls: "mod-cta"
		});
		saveBtn.addEventListener("click", async () => {
			await this.plugin.writeClaudeMd(this.textarea.value);
			this.close();
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
