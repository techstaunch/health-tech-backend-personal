import { EmbeddingsService } from "./embeddings.service";
import FlexSearch from "flexsearch";
import logger from "../../logger";
import { ScoredSection } from "../types/agent.types";

export interface Section {
    id: number;
    title: string;
    content: string;
    embedding?: number[];
}

export interface DraftContext {
    sections: Section[];
    index: any;
}

/**
 * Minimum normalized confidence score [0, 1] required to proceed with an edit.
 * Below this threshold the agent will ask the user for clarification.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.35;

/**
 * Weights for the hybrid score calculation.
 * keyword + semantic must sum to 1.0.
 */
const KEYWORD_WEIGHT = 0.4;
const SEMANTIC_WEIGHT = 0.6;

export class DraftService {
    private static contexts = new Map<string, DraftContext>();
    private embeddings = EmbeddingsService.getProvider();

    async prepareDraft(userId: string, draft: Record<string, string>) {
        try {
            logger.info("Preparing draft", { userId, sectionCount: Object.keys(draft).length });

            const sections: Section[] = Object.entries(draft).map(([title, content], i) => ({
                id: i,
                title,
                content,
            }));

            const index = new FlexSearch.Document({
                tokenize: "forward",
                resolution: 9,
                document: {
                    id: "id",
                    index: [
                        { field: "title", tokenize: "forward", resolution: 9 },
                        { field: "content", tokenize: "forward", resolution: 9 },
                    ],
                },
            });

            for (const s of sections) {
                index.add(s as any);
            }

            logger.info("Generating embeddings for sections", { userId });
            const texts = sections.map((s) => s.content);
            const embeddings = await this.embeddings.embedDocuments(texts);
            sections.forEach((s, i) => {
                s.embedding = embeddings[i];
            });

            DraftService.contexts.set(userId, { sections, index });
            logger.info("Draft prepared and cached", { userId });
            return sections;
        } catch (error: any) {
            logger.error("Failed to prepare draft", { userId, error: error.message });
            throw error;
        }
    }

    /**
     * Performs a hybrid search (keyword + semantic) over the cached sections.
     * Returns results sorted by normalized confidence score descending.
     *
     * Score formula:
     *   score = (keywordHit ? KEYWORD_WEIGHT : 0) + (cosineSimilarity * SEMANTIC_WEIGHT)
     * Both components are already in [0, 1], so the combined score is in [0, 1].
     */
    async hybridSearch(userId: string, query: string): Promise<ScoredSection[]> {
        const context = DraftService.contexts.get(userId);
        if (!context) {
            throw new Error(
                `No draft context found for user ${userId}. Please prepare the draft first.`
            );
        }

        const { sections, index } = context;

        const [queryEmbedding] = await this.embeddings.embedDocuments([query]);

        const keywordResults = index.search(query, { limit: 5, suggest: true });
        logger.info("hybridSearch: keyword results", { keywordResults });

        const keywordHitIds = new Set<number>();
        if (Array.isArray(keywordResults)) {
            keywordResults.forEach((res: any) => {
                if (res.result) {
                    res.result.forEach((id: number) => keywordHitIds.add(id));
                }
            });
        }
        logger.info("hybridSearch: keyword hit IDs", {
            size: keywordHitIds.size,
            ids: [...keywordHitIds],
        });

        const scored: ScoredSection[] = sections.map((s) => {
            const keywordScore = keywordHitIds.has(s.id) ? KEYWORD_WEIGHT : 0;
            const semanticScore = s.embedding
                ? this.cosineSimilarity(queryEmbedding, s.embedding) * SEMANTIC_WEIGHT
                : 0;

            const score = Math.min(1, keywordScore + semanticScore); // clamp to [0, 1]

            return { ...s, score, confidence: score };
        });

        const results = scored.sort((a, b) => b.score - a.score).slice(0, 3);

        logger.info("hybridSearch: top results", {
            results: results.map((r) => ({ title: r.title, confidence: r.confidence })),
        });

        return results;
    }

    /**
     * Updates a single section's content in the in-memory cache.
     * Call this after a successful patch so subsequent searches reflect the edit.
     */
    updateSection(userId: string, sectionId: number, newContent: string): void {
        const context = DraftService.contexts.get(userId);
        if (!context) {
            logger.warn("updateSection: no context found, skipping cache update", { userId });
            return;
        }

        const section = context.sections.find((s) => s.id === sectionId);
        if (!section) {
            logger.warn("updateSection: section not found in cache", { userId, sectionId });
            return;
        }

        section.content = newContent;
        logger.info("updateSection: cache updated", { userId, sectionId, title: section.title });
    }

    static clearContext(userId: string) {
        DraftService.contexts.delete(userId);
    }

    static getSections(userId: string) {
        return DraftService.contexts.get(userId)?.sections;
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0,
            normA = 0,
            normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dotProduct / denom;
    }
}