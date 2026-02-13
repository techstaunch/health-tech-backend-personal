import { Router } from "express";
import multer from "multer";
import { VoiceToTextController } from "../controllers/voice-to-text.controller";
import { VOICE_TO_TEXT_CONFIG } from "../config/voice-to-text.config";

const router = Router();
const controller = new VoiceToTextController();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: VOICE_TO_TEXT_CONFIG.maxFileSize,
    },
    fileFilter: (req, file, cb) => {
        // Check if the MIME type is allowed
        const allowedTypes = VOICE_TO_TEXT_CONFIG.allowedMimeTypes as readonly string[];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    `Invalid file type: ${file.mimetype}. Allowed types: ${allowedTypes.join(", ")}`
                )
            );
        }
    },
});

/**
 * POST /api/voice-to-text/transcribe
 * Transcribe audio file to text
 * Expects multipart/form-data with 'audio' field
 */
router.post("/transcribe", upload.single("audio"), (req, res) =>
    controller.transcribe(req, res)
);

export default router;
