import { StateGraph, MessagesAnnotation, END, CompiledStateGraph } from "@langchain/langgraph";

import { createAzureOpenAIModel } from "../config/azure-openai.config";
import { HEALTHCARE_SYSTEM_PROMPT } from "../config/agent.config";
import { healthcareTools } from "../tools";
import logger from "../../logger";
import { AgentMessage } from "../types/agent.types";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

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
            const callModel = async (state: typeof MessagesAnnotation.State) => {
                const messages = [
                    new SystemMessage(HEALTHCARE_SYSTEM_PROMPT),
                    ...state.messages,
                ];
                const response = await modelWithTools.invoke(messages);
                return { messages: [response] };
            };

            // Define the conditional edge function
            const shouldContinue = (state: typeof MessagesAnnotation.State) => {
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
                        const result = await tool.invoke(toolCall.args as any);

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
            const workflow = new StateGraph(MessagesAnnotation)
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
            });

            const duration = Date.now() - startTime;

            logger.info("Agent invocation completed", {
                userId: userId || "anonymous",
                duration,
                responseMessageCount: (result as any).messages?.length || 0,
            });

            return result;
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
                { messages: messages as any },
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
