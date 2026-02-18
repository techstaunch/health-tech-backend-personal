import { Router } from "express";
import { AgentController } from "../agents/controllers/agent.controller";
import multer from "multer";
import { VOICE_TO_TEXT_CONFIG } from "../voice-to-text/config/voice-to-text.config";

const router = Router();
const agentController = new AgentController();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: VOICE_TO_TEXT_CONFIG.maxFileSize,
    }
});

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

/**
 * POST /api/agent/prepare-draft
 * Initial Phase 1 endpoint to section and index JSON draft
 */
router.post("/prepare-draft", (req, res) => agentController.prepareDraft(req, res));

/**
 * POST /api/agent/voice-command
 * Process voice commands: Transcribe and optionally auto-process with agent
 */
router.post("/voice-command", upload.single("audio"), (req, res) => agentController.processVoiceCommand(req, res));

export default router;
