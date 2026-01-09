// ============================================================================
// CLI Message Types (from stream-json output)
// ============================================================================

export interface InitMessage {
	type: "system";
	subtype: "init";
	session_id: string;
	tools: string[];
	mcp_servers: Record<string, unknown>;
}

export interface ResultMessage {
	type: "result";
	subtype: "success" | "error";
	result: string;
	session_id: string;
	is_error: boolean;
	total_cost_usd: number;
	duration_ms: number;
	duration_api_ms: number;
	num_turns: number;
	// Usage stats (cumulative for session) - snake_case from CLI
	usage?: {
		input_tokens: number;
		output_tokens: number;
		cache_read_input_tokens: number;
		cache_creation_input_tokens: number;
	};
}

export interface CompactBoundaryMessage {
	type: "system";
	subtype: "compact_boundary";
	session_id: string;
	compact_metadata: {
		trigger: "manual" | "auto";
		pre_tokens: number;
	};
}

export interface ConversationMessage {
	type: "user" | "assistant";
	message: {
		role: "user" | "assistant";
		content: ContentBlock[];
	};
	session_id: string;
	uuid?: string;
}

export type ContentBlock =
	| TextBlock
	| ToolUseBlock
	| ToolResultBlock;

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: unknown;
}

export interface ToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	content: string;
}

export type CLIMessage = InitMessage | ResultMessage | ConversationMessage | CompactBoundaryMessage;

// ============================================================================
// UI State Types
// ============================================================================

// Context for selected text with position info for precise replacement
export interface SelectionContext {
	content: string;      // Selected text content
	source: string;       // Source file name (display)
	filePath: string;     // Full path to source file
	startLine: number;    // Start line (0-based)
	startCh: number;      // Start character in line
	endLine: number;      // End line
	endCh: number;        // End character in line
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
	isStreaming?: boolean;
	isError?: boolean;
	thinkingSteps?: ToolUseBlock[];  // Tool steps performed for this message
	selectionContext?: SelectionContext;  // Selection context for this response (for replace/append)
}

export interface ChatSession {
	id: string;
	cliSessionId: string | null;  // Claude CLI session ID for --resume
	messages: ChatMessage[];
	createdAt: number;
	title?: string;  // Auto-generated from first message
	model?: ClaudeModel;  // Model used for this session
	tokenStats?: SessionTokenStats;  // Token statistics for this session
}

// ============================================================================
// Plugin Data (persisted)
// ============================================================================

export interface PluginData {
	settings: ClaudeRockSettings;
	sessions: ChatSession[];
	currentSessionId: string | null;
}

// ============================================================================
// Slash Commands
// ============================================================================

export interface SlashCommand {
	id: string;
	name: string;           // Display name (e.g., "Summarize")
	command: string;        // Command trigger (e.g., "/summarize")
	prompt: string;         // Prompt template (use {text} for context)
	description: string;    // Short description for autocomplete
	icon: string;           // Obsidian icon name
	isBuiltin: boolean;     // Built-in commands can't be deleted
	enabled: boolean;       // Can be toggled on/off
}

// ============================================================================
// Plugin Settings
// ============================================================================

// Re-export LanguageCode for convenience
export type { LanguageCode } from "./systemPrompts";

// Claude model types
export type ClaudeModel = "claude-haiku-4-5-20251001" | "claude-sonnet-4-5-20250929" | "claude-opus-4-5-20251101";

export const CLAUDE_MODELS: { value: ClaudeModel; label: string }[] = [
	{ value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
	{ value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
	{ value: "claude-opus-4-5-20251101", label: "Opus 4.5" }
];

export interface ClaudePermissions {
	webSearch: boolean;
	webFetch: boolean;
	task: boolean;
}

export interface ClaudeRockSettings {
	cliPath: string;
	language: import("./systemPrompts").LanguageCode;
	permissions: ClaudePermissions;
	customCommands: SlashCommand[];
	disabledBuiltinCommands: string[];  // IDs of disabled built-in commands
	defaultModel: ClaudeModel;
	thinkingEnabled: boolean;  // Enable extended thinking mode by default
	tokenHistory: Record<string, number>;  // date -> tokens used that day
	gettingStartedDismissed: boolean;  // Whether the Getting Started section is collapsed
}

export const DEFAULT_SETTINGS: ClaudeRockSettings = {
	cliPath: "claude",
	language: "en",
	permissions: {
		webSearch: false,
		webFetch: false,
		task: false
	},
	customCommands: [],
	disabledBuiltinCommands: [],
	defaultModel: "claude-haiku-4-5-20251001",
	thinkingEnabled: false,
	tokenHistory: {},
	gettingStartedDismissed: false
};

// ============================================================================
// Service Event Types (for parallel sessions)
// ============================================================================

export interface StreamingEvent {
	sessionId: string;
	text: string;
}

export interface CompleteEvent {
	sessionId: string;
	code: number | null;
}

export interface InitEvent {
	sessionId: string;
	cliSessionId: string;
}

export interface AssistantEvent {
	sessionId: string;
	message: ConversationMessage;
}

export interface ResultEvent {
	sessionId: string;
	result: ResultMessage;
}

export interface ErrorEvent {
	sessionId: string;
	error: string;
}

// ============================================================================
// Context Tracking Types
// ============================================================================

export interface SessionTokenStats {
	inputTokens: number;
	outputTokens: number;
	contextWindow: number;
	cacheReadTokens: number;
	compactCount: number;
	lastCompactPreTokens: number | null;
}

export interface ContextUsage {
	used: number;        // current tokens
	limit: number;       // effective limit (60%)
	nominal: number;     // full window size
	percentage: number;  // 0-100
}

export interface ContextUpdateEvent {
	sessionId: string;
	stats: SessionTokenStats;
	usage: ContextUsage;
}

export interface CompactEvent {
	sessionId: string;
	trigger: "manual" | "auto";
	preTokens: number;
}

export interface ToolUseEvent {
	sessionId: string;
	tool: ToolUseBlock;
}

export interface ToolResultEvent {
	sessionId: string;
	result: ToolResultBlock;
}

// Pending message for background sessions
export interface PendingMessage {
	text: string;
	tools: ToolUseBlock[];
}

