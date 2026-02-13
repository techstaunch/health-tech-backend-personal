/**
 * Interface for transcription services
 * This allows easy switching between different transcription providers
 */
export interface ITranscriptionService {
    /**
     * Transcribe audio to text
     * @param audioBuffer - The audio file buffer
     * @param mimeType - The MIME type of the audio file (e.g., 'audio/wav', 'audio/mp3')
     * @returns Promise resolving to the transcribed text
     */
    transcribe(audioBuffer: Buffer, mimeType: string): Promise<string>;
}
