import { Router } from "express";
import multer from "multer";
import { HybridSearchController } from "../controllers/hybrid-search.controller";
import { VOICE_TO_TEXT_CONFIG } from "../voice-to-text/config/voice-to-text.config";

const router = Router();
const controller = new HybridSearchController();

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
 * POST /api/hybrid-search
 * Accepts an audio file, transcribes it, and performs a hybrid search (keyword + semantic).
 */
router.post("/", upload.single("audio"), (req, res) =>
    controller.search(req, res)
);

export default router;
