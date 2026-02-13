// import type { FeatureExtractionPipeline } from "@xenova/transformers";

// Type for the embedding output (number array)
export type Embedding = number[];

// Configuration for the embedding model
// This allows easy switching to other models or services (like Azure) in the future
interface EmbeddingConfig {
    model: string;
    quantized: boolean;
}

const defaultConfig: EmbeddingConfig = {
    model: "Xenova/all-MiniLM-L6-v2",
    quantized: true,
};

// In-memory cache for embeddings
// TODO: Replace with Redis for production scalability
const embeddingCache = new Map<string, Embedding>();

// Singleton instance of the pipeline to avoid reloading
let extractor: any = null;

/**
 * Get or initialize the feature extraction pipeline.
 */
const getExtractor = async (): Promise<any> => {
    if (!extractor) {
        const { pipeline } = await import("@xenova/transformers");
        extractor = await pipeline("feature-extraction", defaultConfig.model, {
            quantized: defaultConfig.quantized,
        });
    }
    return extractor;
};

/**
 * Generates an embedding for the given text.
 * Uses in-memory caching to improve performance for repeated queries.
 * 
 * @param text - The text to generate an embedding for.
 * @returns A promise resolving to the embedding vector.
 */
export const createEmbedding = async (text: string): Promise<Embedding> => {
    // Check cache first
    if (embeddingCache.has(text)) {
        return embeddingCache.get(text)!;
    }

    // Prepare pipeline
    const pipe = await getExtractor();

    // Generate embedding
    // pooling: 'mean' and normalize: true are standard for sentence embeddings
    const output = await pipe(text, { pooling: "mean", normalize: true });

    // Convert Tensor to standard array
    // @xenova/transformers returns a Tensor, data is Float32Array
    const embedding = Array.from(output.data) as number[];

    // Cache result
    embeddingCache.set(text, embedding);

    return embedding;
};
