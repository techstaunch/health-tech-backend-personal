import { Request, Response } from "express";
import { AgentService } from "../services/agent.service";
import logger from "../../logger";
import { z } from "zod";
import { BaseMessage } from "@langchain/core/messages";

/**
 * Input validation schema for agent requests
 */
const InvokeSchema = z.object({
    messages: z.array(
        z.object({
            role: z.enum(["user", "assistant", "system", "tool"]),
            content: z.string(),
            name: z.string().optional(),
            tool_call_id: z.string().optional(),
        })
    ),
});

/**
 * Agent Controller - Handles HTTP requests for agent operations
 */
export class AgentController {
    private agentService: AgentService;

    constructor() {
        this.agentService = new AgentService();
    }

    /**
     * Handles single agent invocation requests
     * POST /api/agent/invoke
     */
    async invoke(req: Request, res: Response) {
        try {
            console.log("Yes enter in function");
            // Validate input
            const { messages } = InvokeSchema.parse(req.body);

            // Get user ID from auth middleware (if implemented)
            // For now, using a placeholder
            const userId = (req as any).user?.id || "anonymous";

            logger.info("Agent invoke request received", {
                userId,
                messageCount: messages.length,
            });

            const result = await this.agentService.invoke(messages, userId);

            res.json({
                success: true,
                data: result,
            });
        } catch (error: any) {
            logger.error("Agent controller invoke error", {
                error: error.message,
                stack: error.stack,
            });

            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid request format",
                    details: error.errors,
                });
            }

            res.status(500).json({
                success: false,
                error: "Agent invocation failed",
                message: error.message,
            });
        }
    }

    /**
     * Handles streaming agent requests
     * POST /api/agent/stream
     */
    async stream(req: Request, res: Response) {
        try {
            // Validate input
            const { messages } = InvokeSchema.parse(req.body);

            // Get user ID from auth middleware (if implemented)
            const userId = (req as any).user?.id || "anonymous";

            logger.info("Agent stream request received", {
                userId,
                messageCount: messages.length,
            });

            // Set headers for Server-Sent Events (SSE)
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");

            const stream = await this.agentService.stream(messages, userId);



            // ... (existing imports)

            // ...

            // Stream the results
            for await (const chunk of stream) {
                const messages = (chunk as { messages: BaseMessage[] }).messages;
                const latestMessage = messages[messages.length - 1];

                // Send each chunk as SSE
                res.write(`data: ${JSON.stringify(latestMessage)}\n\n`);
            }

            // End the stream
            res.write("data: [DONE]\n\n");
            res.end();

            logger.info("Agent stream completed", { userId });
        } catch (error: any) {
            logger.error("Agent controller stream error", {
                error: error.message,
                stack: error.stack,
            });

            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid request format",
                    details: error.errors,
                });
            }

            // If headers haven't been sent yet, send error response
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: "Streaming failed",
                    message: error.message,
                });
            } else {
                // If streaming already started, send error event
                res.write(
                    `data: ${JSON.stringify({ error: "Streaming failed", message: error.message })}\n\n`
                );
                res.end();
            }
        }
    }
}
