/**
 * TypeScript types and interfaces for the agent system
 */

/**
 * Message role types
 */
export type MessageRole = "user" | "assistant" | "system" | "tool";

/**
 * Message structure for agent conversations
 */
export interface AgentMessage {
    role: MessageRole;
    content: string;
    name?: string;
    tool_call_id?: string;
}

/**
 * Agent invocation request
 */
export interface AgentInvokeRequest {
    messages: AgentMessage[];
    userId?: string;
}

/**
 * Tool call information
 */
export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, any>;
}

/**
 * Agent invocation response
 */
export interface AgentInvokeResponse {
    messages: AgentMessage[];
    toolCalls?: ToolCall[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * Streaming chunk from agent
 */
export interface AgentStreamChunk {
    messages: AgentMessage[];
    isComplete: boolean;
}

/**
 * Tool execution context
 */
export interface ToolContext {
    userId?: string;
    timestamp: Date;
}

/**
 * Tool execution result
 */
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
}

// ─── Super Agent Types ────────────────────────────────────────────────────────

/**
 * Parsed intent from a user instruction.
 * Produced by the intent-parser module.
 */
export interface IntentResult {
    /** The type of edit operation */
    action: "replace" | "add" | "delete" | "update";
    /** The section or concept to target */
    target: string;
    /** The new value or content to apply */
    value: string;
    /** True when the user did NOT explicitly name a section */
    isImplicit?: boolean;
    /** Key clinical terms from the instruction for semantic matching */
    contentKeywords?: string[];
    /** The specific part of the original instruction related to this intent */
    originalPhrase: string;
}

/**
 * A document section enriched with a hybrid search score and confidence.
 * Returned by DraftService.hybridSearch().
 */
export interface ScoredSection {
    id: number;
    title: string;
    content: string;
    embedding?: number[];
    /** Normalized hybrid score in [0, 1] */
    score: number;
    /** Alias for score — used for threshold checks */
    confidence: number;
}

/**
 * Result of a single section patch operation.
 * Produced by the patch-editor module.
 */
export interface PatchResult {
    title: string;
    original: string;
    updated: string;
    confidence: number;
}

/**
 * Structured output returned by the edit_summary_sections tool.
 * Consumed by AgentService.extractToolResult().
 */
export interface ToolOutput {
    message: string;
    edits: PatchResult[];
    /** True when the agent should ask the user for more specific input */
    needsClarification?: boolean;
}

/**
 * Data fetched from an external source based on a document ID.
 */
export interface EnrichedData {
    /** The ID extracted from the document (e.g., T263517) */
    id: string;
    /** The content retrieved from the external API */
    content: string;
    /** Whether the data was found and successfully retrieved */
    found: boolean;
    /** Optional title or source information */
    title?: string;
    /** Optional relevance score */
    relevance?: number;
}
