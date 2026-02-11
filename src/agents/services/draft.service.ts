import { EmbeddingsService } from "./embeddings.service";
import FlexSearch from "flexsearch";
import logger from "../../logger";

export interface Section {
    id: number;
    title: string;
    content: string;
    embedding?: number[];
}

export interface DraftContext {
    sections: Section[];
    index: any; // FlexSearch index
}

/**
 * DraftService - Handles document sectioning, indexing, and hybrid search
 */
export class DraftService {
    private static contexts = new Map<string, DraftContext>();
    private embeddings = EmbeddingsService.getProvider();

    /**
     * Phase 1: Prepare draft by sectioning, indexing, and creating embeddings
     * @param userId - Unique identifier for the context
     * @param draft - JSON data (key-value pairs of title-content)
     */
    async prepareDraft(userId: string, draft: Record<string, string>) {
        try {
            logger.info("Preparing draft", { userId, sectionCount: Object.keys(draft).length });

            // 1. Convert JSON -> sections
            const sections: Section[] = Object.entries(draft).map(([title, content], i) => ({
                id: i,
                title,
                content
            }));

            // 2. Build FlexSearch engine
            const index = new FlexSearch.Document({
                document: {
                    id: "id",
                    index: ["title", "content"]
                }
            });

            for (const s of sections) {
                index.add(s as any);
            }

            // 3. Create embeddings (do only once)
            logger.info("Generating embeddings for sections", { userId });
            for (const s of sections) {
                s.embedding = await this.embeddings.embedQuery(s.content);
            }

            // Cache in memory
            DraftService.contexts.set(userId, { sections, index });

            logger.info("Draft prepared and cached", { userId });
            return sections;
        } catch (error: any) {
            logger.error("Failed to prepare draft", { userId, error: error.message });
            throw error;
        }
    }

    /**
     * Phase 2: Hybrid search (Keyword + Semantic)
     * @param userId - Unique identifier for the context
     * @param query - Search query
     * @returns Scored sections
     */
    async hybridSearch(userId: string, query: string) {
        const context = DraftService.contexts.get(userId);
        if (!context) {
            throw new Error(`No draft context found for user ${userId}. Please prepare the draft first.`);
        }

        const { sections, index } = context;

        // Semantic embedding
        const queryEmbedding = await this.embeddings.embedQuery(query);

        // Keyword search
        const keywordResults = index.search(query, 5);
        // FlexSearch.Document search returns an array of { field: string, result: id[] }
        const keywordHitIds = new Set<number>();
        if (Array.isArray(keywordResults)) {
            keywordResults.forEach((res: any) => {
                if (res.result) {
                    res.result.forEach((id: number) => keywordHitIds.add(id));
                }
            });
        }

        // Score sections
        const scored = sections.map(s => {
            const keywordScore = keywordHitIds.has(s.id) ? 1.0 : 0.0;
            const semanticScore = s.embedding ? this.cosineSimilarity(queryEmbedding, s.embedding) : 0;

            return {
                ...s,
                score: keywordScore + semanticScore
            };
        });

        // Sort and return top 3
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
    }

    /**
     * Helper: Clear context for a user
     */
    static clearContext(userId: string) {
        DraftService.contexts.delete(userId);
    }

    /**
     * Helper: Get sections for a user
     */
    static getSections(userId: string) {
        return DraftService.contexts.get(userId)?.sections;
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
