import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { ITranscriptionService } from "../interfaces/transcription.interface";
import { ELEVENLABS_CONFIG } from "../config/voice-to-text.config";
import logger from "../../logger";

/**
 * ElevenLabs transcription service implementation
 * Uses ElevenLabs speech-to-text API (Scribe)
 */
export class ElevenLabsTranscriptionService implements ITranscriptionService {
    private client: ElevenLabsClient;

    constructor() {
        if (!ELEVENLABS_CONFIG.apiKey) {
            throw new Error(
                "ElevenLabs configuration is missing. Please set ELEVENLABS_API_KEY environment variable."
            );
        }

        this.client = new ElevenLabsClient({
            apiKey: ELEVENLABS_CONFIG.apiKey,
        });

        logger.info("ElevenLabs transcription service initialized");
    }

    /**
     * Transcribe audio using ElevenLabs Scribe
     */
    async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
        try {
            logger.info("Starting ElevenLabs transcription", {
                bufferSize: audioBuffer.length,
                mimeType,
            });

            // Convert Buffer to Uint8Array and create Blob
            const uint8Array = new Uint8Array(audioBuffer);
            const audioBlob = new Blob([uint8Array], { type: mimeType });

            // Call ElevenLabs transcription API (Scribe)
            const result = await this.client.speechToText.convert({
                file: audioBlob,
                modelId: "scribe_v2",
            });

            // Extract text from the response
            // The response can be SpeechToTextChunkResponseModel or MultichannelSpeechToTextResponseModel
            let transcribedText = "";

            if ("text" in result) {
                // Single channel response
                transcribedText = result.text || "";
            } else if ("transcripts" in result) {
                // Multi-channel response - combine all transcripts
                transcribedText = result.transcripts?.map((t: any) => t.text).join(" ") || "";
            }

            logger.info("ElevenLabs transcription completed successfully", {
                textLength: transcribedText.length,
            });

            return transcribedText;
        } catch (error) {
            logger.error("ElevenLabs transcription failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw new Error(
                `ElevenLabs transcription failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}
