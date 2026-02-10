import { ITranscriptionService } from "../interfaces/transcription.interface";
import { AzureTranscriptionService } from "../services/azure-transcription.service";
import { ElevenLabsTranscriptionService } from "../services/elevenlabs-transcription.service";
import { VOICE_TO_TEXT_CONFIG } from "../config/voice-to-text.config";
import logger from "../../logger";

/**
 * Factory for creating transcription service instances
 * Implements singleton pattern to ensure only one service instance exists
 */
export class TranscriptionServiceFactory {
    private static instance: ITranscriptionService | null = null;

    /**
     * Get the configured transcription service instance
     * @returns The active transcription service based on configuration
     */
    static getService(): ITranscriptionService {
        if (!this.instance) {
            this.instance = this.createService();
        }
        return this.instance;
    }

    /**
     * Create a new transcription service based on configuration
     */
    private static createService(): ITranscriptionService {
        const serviceType = VOICE_TO_TEXT_CONFIG.transcriptionService;

        logger.info(`Initializing transcription service: ${serviceType}`);

        switch (serviceType) {
            case "azure":
                return new AzureTranscriptionService();
            case "elevenlabs":
                return new ElevenLabsTranscriptionService();
            default:
                throw new Error(
                    `Invalid transcription service: ${serviceType}. Must be 'azure' or 'elevenlabs'.`
                );
        }
    }

    /**
     * Reset the service instance (useful for testing or service switching)
     */
    static reset(): void {
        this.instance = null;
        logger.info("Transcription service instance reset");
    }
}
