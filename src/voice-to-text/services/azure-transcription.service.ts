import { AzureOpenAI } from "openai";
import { ITranscriptionService } from "../interfaces/transcription.interface";
import { AZURE_CONFIG } from "../config/voice-to-text.config";
import logger from "../../logger";

/**
 * Azure OpenAI transcription service implementation
 * Uses Azure OpenAI's Whisper model for speech-to-text
 */
export class AzureTranscriptionService implements ITranscriptionService {
    private client: AzureOpenAI;

    constructor() {
        if (!AZURE_CONFIG.endpoint || !AZURE_CONFIG.apiKey) {
            throw new Error(
                "Azure OpenAI configuration is missing. Please set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY environment variables."
            );
        }

        this.client = new AzureOpenAI({
            endpoint: AZURE_CONFIG.endpoint,
            apiKey: AZURE_CONFIG.apiKey,
            apiVersion: AZURE_CONFIG.apiVersion,
        });

        logger.info("Azure OpenAI transcription service initialized");
    }

    /**
     * Transcribe audio using Azure OpenAI Whisper
     */
    async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
        try {
            logger.info("Starting Azure OpenAI transcription", {
                bufferSize: audioBuffer.length,
                mimeType,
            });

            // Determine file extension from MIME type
            const extension = this.getFileExtension(mimeType);

            // Convert Buffer to Uint8Array and create File object
            const uint8Array = new Uint8Array(audioBuffer);
            const audioFile = new File([uint8Array], `audio.${extension}`, {
                type: mimeType,
            });

            // Call Azure OpenAI Whisper transcription API
            const result = await this.client.audio.transcriptions.create({
                file: audioFile,
                model: AZURE_CONFIG.deploymentName,
            });

            logger.info("Azure OpenAI transcription completed successfully", {
                textLength: result.text.length,
            });

            return result.text;
        } catch (error) {
            logger.error("Azure OpenAI transcription failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw new Error(
                `Azure transcription failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Get file extension from MIME type
     */
    private getFileExtension(mimeType: string): string {
        const mimeToExt: Record<string, string> = {
            "audio/wav": "wav",
            "audio/wave": "wav",
            "audio/x-wav": "wav",
            "audio/mp3": "mp3",
            "audio/mpeg": "mp3",
            "audio/webm": "webm",
            "audio/ogg": "ogg",
            "audio/m4a": "m4a",
            "audio/x-m4a": "m4a",
        };

        return mimeToExt[mimeType] || "wav";
    }
}
