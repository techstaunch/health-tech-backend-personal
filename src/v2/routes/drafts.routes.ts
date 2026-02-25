import { Router } from "express";
import multer from "multer";

import { VOICE_TO_TEXT_CONFIG } from "../../voice-to-text/config/voice-to-text.config";
import { AgentController } from "../db/agent.controller";

const router = Router();
const controller = new AgentController();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: VOICE_TO_TEXT_CONFIG.maxFileSize,
    },
});

router.post("/prepare-draft", (req, res) => controller.prepareDraft(req, res));

router.get("/drafts/:patientId/:accountNumber", (req, res) =>
    controller.getDraft(req, res),
);

router.post("/drafts/:patientId/:accountNumber/commit", (req, res) =>
    controller.commit(req, res),
);

router.post("/drafts/:patientId/:accountNumber/rollback", (req, res) =>
    controller.rollback(req, res),
);

router.post("/drafts/:patientId/:accountNumber/checkout", (req, res) =>
    controller.checkout(req, res),
);

router.get("/drafts/:patientId/:accountNumber/history", (req, res) =>
    controller.history(req, res),
);

router.get("/drafts/:patientId/:accountNumber/versions/:version", (req, res) =>
    controller.getVersionSnapshot(req, res),
);

router.post("/invoke", (req, res) => controller.invoke(req, res));

router.post("/voice-command", upload.single("audio"), (req, res) =>
    controller.processVoiceCommand(req, res),
);

export default router;
