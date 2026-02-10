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
