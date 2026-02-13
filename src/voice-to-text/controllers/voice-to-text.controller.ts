import { Request, Response } from "express";
import { TranscriptionServiceFactory } from "../factories/transcription-service.factory";
import logger from "../../logger";

/**
 * Controller for voice-to-text operations
 */
export class VoiceToTextController {
    /**
     * Handle audio transcription request
     * POST /api/voice-to-text/transcribe
     */
    async transcribe(req: Request, res: Response): Promise<void> {
        try {
            // Validate that a file was uploaded
            if (!req.file) {
                res.status(400).json({
                    success: false,
                    error: "No audio file provided. Please upload an audio file.",
                });
                return;
            }

            const { buffer, mimetype, size } = req.file;

            logger.info("Received transcription request", {
                mimeType: mimetype,
                fileSize: size,
            });

            // Get the transcription service
            const transcriptionService = TranscriptionServiceFactory.getService();

            // Transcribe the audio
            const startTime = Date.now();
            const transcribedText = await transcriptionService.transcribe(buffer, mimetype);
            const duration = Date.now() - startTime;

            logger.info("Transcription completed", {
                duration,
                textLength: transcribedText.length,
            });

            // Return the transcribed text
            res.status(200).json({
                success: true,
                data: {
                    text: transcribedText,
                    metadata: {
                        fileSize: size,
                        mimeType: mimetype,
                        processingTime: duration,
                    },
                },
            });
        } catch (error) {
            logger.error("Transcription request failed", {
                error: error instanceof Error ? error.message : String(error),
            });

            res.status(500).json({
                success: false,
                error: "Transcription failed. Please try again.",
                details: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
