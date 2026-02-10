import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { Serialized } from "@langchain/core/load/serializable";
import { ChainValues } from "@langchain/core/utils/types";
import logger from "../../logger";

/**
 * Custom callback handler for logging agent steps and tool calls
 */
export class LoggingCallbackHandler extends BaseCallbackHandler {
    name = "LoggingCallbackHandler";

    async handleToolStart(
        tool: Serialized,
        input: string,
        runId: string,
        parentRunId?: string,
        tags?: string[],
        metadata?: any,
        name?: string
    ): Promise<void> {
        logger.info("Tool call initiated", {
            toolName: name || tool.id.join("_"),
            args: input,
            toolCallId: runId,
            timestamp: new Date().toISOString(),
        });
    }

    async handleToolEnd(
        output: string,
        runId: string,
        parentRunId?: string,
        tags?: string[]
    ): Promise<void> {
        logger.info("Tool call completed", {
            toolCallId: runId,
            output,
        });
    }

    async handleToolError(
        err: any,
        runId: string,
        parentRunId?: string,
        tags?: string[]
    ): Promise<void> {
        logger.error("Tool call failed", {
            toolCallId: runId,
            error: err.message,
            stack: err.stack,
        });
    }
}
