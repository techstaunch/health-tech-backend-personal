import { StateGraph, MessagesAnnotation, END, CompiledStateGraph, Annotation } from "@langchain/langgraph";

import { createAzureOpenAIModel } from "../config/azure-openai.config";
import { HEALTHCARE_SYSTEM_PROMPT } from "../config/agent.config";
import { healthcareTools } from "../tools";
import logger from "../../logger";
import { AgentMessage } from "../types/agent.types";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

/**
 * Custom state for the agent, extending MessagesAnnotation with userId
 */
export const AgentState = Annotation.Root({
    ...MessagesAnnotation.spec,
    userId: Annotation<string>(),
});

/**
 * Agent Service - Main service for LangChain agent operations
 * Handles agent initialization, invocation, and streaming
 */
export class AgentService {
    // using any for state to avoid complex generic mismatches during compilation
    private agent!: CompiledStateGraph<any, any, any>;

    constructor() {
        this.initializeAgent();
    }

    /**
     * Initializes the LangChain agent with Azure OpenAI model
     */
    private initializeAgent() {
        try {
            const model = createAzureOpenAIModel();
            const modelWithTools = model.bindTools(healthcareTools);

            // Define the function that calls the model
            const callModel = async (state: typeof AgentState.State) => {
                const systemPrompt = `${HEALTHCARE_SYSTEM_PROMPT}\n\nCURRENT USER SESSION ID: ${state.userId}\nUse this session ID for any tools that require a userId argument.`;
                const messages = [
                    new SystemMessage(systemPrompt),
                    ...state.messages,
                ];
                const response = await modelWithTools.invoke(messages);
                return { messages: [response] };
            };

            // Define the conditional edge function
            const shouldContinue = (state: typeof AgentState.State) => {
                const lastMessage = state.messages[state.messages.length - 1];
                if (lastMessage._getType() === "ai" && (lastMessage as AIMessage).tool_calls?.length) {
                    return "tools";
                }
                return END;
            };

            // Create the tool node with custom error handling and logging
            const toolNode = async (state: typeof MessagesAnnotation.State) => {
                const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
                const toolCalls = lastMessage.tool_calls || [];

                const results = await Promise.all(toolCalls.map(async (toolCall) => {
                    const tool = healthcareTools.find(t => t.name === toolCall.name);

                    logger.info("Tool call initiated", {
                        toolName: toolCall.name,
                        args: toolCall.args,
                        toolCallId: toolCall.id,
                        timestamp: new Date().toISOString(),
                    });

                    try {
                        if (!tool) {
                            throw new Error(`Tool ${toolCall.name} not found`);
                        }

                        // Execute tool
                        const result = await (tool as any).invoke(toolCall.args as any);

                        logger.info("Tool call completed", {
                            toolName: toolCall.name,
                            toolCallId: toolCall.id,
                        });

                        return new ToolMessage({
                            tool_call_id: toolCall.id!,
                            content: typeof result === 'string' ? result : JSON.stringify(result),
                        });
                    } catch (error: any) {
                        logger.error("Tool call failed", {
                            toolName: toolCall.name,
                            error: error.message,
                            stack: error.stack,
                            toolCallId: toolCall.id,
                            args: toolCall.args,
                        });

                        // Return error message to agent
                        return new ToolMessage({
                            tool_call_id: toolCall.id!,
                            content: `Tool error: ${error.message}. Please try a different approach or ask for help.`,
                        });
                    }
                }));

                return { messages: results };
            };

            // Build the graph
            const workflow = new StateGraph(AgentState)
                .addNode("agent", callModel)
                .addNode("tools", toolNode)
                .addEdge("__start__", "agent")
                .addConditionalEdges("agent", shouldContinue, {
                    tools: "tools",
                    [END]: END,
                })
                .addEdge("tools", "agent");

            this.agent = workflow.compile();

            logger.info("LangChain agent initialized successfully", {
                toolCount: healthcareTools.length,
            });
        } catch (error: any) {
            logger.error("Failed to initialize LangChain agent", {
                error: error.message,
                stack: error.stack,
            });
            throw error;
        }
    }

    private extractToolResult(agentResult: any) {
        const messages = agentResult.messages;

        // Find all tool messages in the history
        const toolMessages = messages.filter((m: any) => m._getType?.() === "tool");

        if (toolMessages.length === 0) {
            // Fallback: surface the last AI text response (e.g. clarification question
            // that the agent decided to answer without calling the tool)
            const aiMsg = [...messages]
                .reverse()
                .find((m: any) => m._getType?.() === "ai");
            if (aiMsg) {
                const text = typeof aiMsg.content === "string" ? aiMsg.content : JSON.stringify(aiMsg.content);
                return { message: text, edits: [], needsClarification: false };
            }
            return null;
        }

        const combinedResult = {
            message: [] as string[],
            edits: [] as any[],
            needsClarification: false
        };

        for (const toolMsg of toolMessages) {
            try {
                const parsed = JSON.parse(toolMsg.content);

                if (parsed.message) {
                    combinedResult.message.push(parsed.message);
                }

                if (Array.isArray(parsed.edits)) {
                    combinedResult.edits.push(...parsed.edits);
                }

                if (parsed.needsClarification) {
                    combinedResult.needsClarification = true;
                }
            } catch {
                // If the content is plain text (not JSON), push it as a message
                if (toolMsg.content) {
                    combinedResult.message.push(toolMsg.content);
                }
            }
        }

        return {
            message: combinedResult.message.join(" "),
            edits: combinedResult.edits,
            needsClarification: combinedResult.needsClarification
        };
    }


    /**
     * Invokes the agent with a single request
     * @param messages - Array of conversation messages
     * @param userId - Optional user ID for logging
     * @returns Agent response
     */
    async invoke(messages: AgentMessage[], userId?: string) {
        try {
            logger.info("Agent invocation started", {
                userId: userId || "anonymous",
                messageCount: messages.length,
            });

            const startTime = Date.now();

            // Convert AgentMessage to BaseMessage if needed, or rely on compatible structure
            // We blindly pass messages because langgraph expects BaseMessageLike
            const result = await this.agent.invoke({
                messages: messages as any,
                userId: userId || "anonymous"
            });

            const duration = Date.now() - startTime;

            logger.info("Agent invocation completed", {
                userId: userId || "anonymous",
                duration,
                responseMessageCount: (result as any).messages?.length || 0,
            });
            const toolData = this.extractToolResult(result);
            return {
                success: true,
                message: toolData?.message ?? null,
                edits: toolData?.edits ?? [],
                needsClarification: toolData?.needsClarification ?? false,
            };
        } catch (error: any) {
            logger.error("Agent invocation failed", {
                error: error.message,
                stack: error.stack,
                userId: userId || "anonymous",
            });
            throw error;
        }
    }

    /**
     * Streams agent responses for real-time updates
     * @param messages - Array of conversation messages
     * @param userId - Optional user ID for logging
     * @returns Async iterator of agent stream chunks
     */
    async stream(messages: AgentMessage[], userId?: string) {
        try {
            logger.info("Agent streaming started", {
                userId: userId || "anonymous",
                messageCount: messages.length,
            });

            const stream = await this.agent.stream(
                {
                    messages: messages as any,
                    userId: userId || "anonymous"
                },
                { streamMode: "values" }
            );

            return stream;
        } catch (error: any) {
            logger.error("Agent streaming failed", {
                error: error.message,
                stack: error.stack,
                userId: userId || "anonymous",
            });
            throw error;
        }
    }
}
