import { Embeddings } from "@langchain/core/embeddings";
import { createAzureOpenAIEmbeddings } from "../config/azure-openai.config";
import logger from "../../logger";

/**
 * Custom Embeddings implementation using Xenova (Transformers.js)
 */
export class XenovaEmbeddings extends Embeddings {
    private pipeline: any;
    private modelName: string;

    constructor(fields?: { modelName?: string }) {
        super(fields as any ?? {});
        this.modelName = fields?.modelName || 'Xenova/all-MiniLM-L6-v2';
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        const extractor = await this.getPipeline();
        return Promise.all(texts.map(async (text) => {
            const output = await extractor(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data) as number[];
        }));
    }

    async embedQuery(text: string): Promise<number[]> {
        const extractor = await this.getPipeline();
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data) as number[];
    }

    private async getPipeline() {
        if (!this.pipeline) {
            // dynamic import to avoid issues if not used
            const { pipeline } = await import('@xenova/transformers');
            this.pipeline = await pipeline('feature-extraction', this.modelName);
        }
        return this.pipeline;
    }
}

/**
 * EmbeddingsService - Factory to get the configured embedding provider
 */
export class EmbeddingsService {
    /**
     * Returns the configured embedding provider based on EMBEDDING_PROVIDER env var
     * Default is 'azure'
     */
    static getProvider(): Embeddings {
        const provider = process.env.EMBEDDING_PROVIDER || 'azure';

        logger.info("Initializing embedding provider", { provider });

        if (provider === 'xenova') {
            return new XenovaEmbeddings();
        }

        // Default to Azure
        return createAzureOpenAIEmbeddings();
    }
}