import { Router } from "express";
import { AgentController } from "../agents/controllers/agent.controller";

const router = Router();
const agentController = new AgentController();

/**
 * POST /api/agent/invoke
 * Single invocation endpoint - returns complete response
 */
router.post("/invoke", (req, res) => agentController.invoke(req, res));

/**
 * POST /api/agent/stream
 * Streaming endpoint - returns Server-Sent Events (SSE)
 */
router.post("/stream", (req, res) => agentController.stream(req, res));

export default router;
