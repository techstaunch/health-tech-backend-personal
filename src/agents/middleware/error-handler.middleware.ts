import { createMiddleware, ToolMessage } from "langchain";
import logger from "../../logger";

/**
 * Error handler middleware for tool calls
 * Catches errors during tool execution and returns user-friendly messages
 */
export const errorHandlerMiddleware = createMiddleware({
    name: "ErrorHandler",
    wrapToolCall: async (request, handler) => {
        const startTime = Date.now();

        try {
            const result = await handler(request);

            const duration = Date.now() - startTime;
            logger.info("Tool call succeeded", {
                toolName: request.toolCall.name,
                duration,
                toolCallId: request.toolCall.id,
            });

            return result;
        } catch (error: any) {
            const duration = Date.now() - startTime;

            logger.error("Tool call failed", {
                toolName: request.toolCall.name,
                error: error.message,
                stack: error.stack,
                duration,
                toolCallId: request.toolCall.id,
                args: request.toolCall.args,
            });

            // Return a user-friendly error message to the agent
            // The agent can then decide how to handle the error
            return new ToolMessage({
                content: `Tool error: ${error.message}. Please try a different approach or ask for help.`,
                tool_call_id: request.toolCall.id!,
            });
        }
    },
});
