/**
 * Voice-to-text configuration constants
 */

export const VOICE_TO_TEXT_CONFIG = {
    // Maximum file size in bytes (10MB)
    maxFileSize: parseInt(process.env.MAX_AUDIO_FILE_SIZE || "10485760"),

    // Allowed audio MIME types
    allowedMimeTypes: [
        "audio/wav",
        "audio/wave",
        "audio/x-wav",
        "audio/mp3",
        "audio/mpeg",
        "audio/webm",
        "audio/ogg",
        "audio/m4a",
        "audio/x-m4a",
    ],

    // Selected transcription service ('azure' or 'elevenlabs')
    transcriptionService: (process.env.TRANSCRIPTION_SERVICE || "azure") as "azure" | "elevenlabs",
} as const;

/**
 * Azure OpenAI configuration for transcription
 */
export const AZURE_CONFIG = {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
    apiKey: process.env.AZURE_OPENAI_API_KEY || "",
    deploymentName: process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT_NAME || "gpt-4o-transcribe",
    apiVersion: process.env.AZURE_OPENAI_API_TRANSCRIPTION_VERSION || "2024-08-01-preview",
} as const;

/**
 * ElevenLabs configuration for transcription
 */
export const ELEVENLABS_CONFIG = {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
} as const;
