import { createMiddleware } from "langchain";
import logger from "../../logger";

/**
 * Logging middleware for tool calls
 * Logs tool invocation details for debugging and monitoring
 */
export const loggingMiddleware = createMiddleware({
    name: "RequestLogger",
    wrapToolCall: async (request, handler) => {
        logger.info("Tool call initiated", {
            toolName: request.toolCall.name,
            args: request.toolCall.args,
            toolCallId: request.toolCall.id,
            timestamp: new Date().toISOString(),
        });

        const result = await handler(request);

        logger.info("Tool call completed", {
            toolName: request.toolCall.name,
            toolCallId: request.toolCall.id,
        });

        return result;
    },
});