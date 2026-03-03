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
export const LOW_CONFIDENCE_THRESHOLD = 0.50;

/**
 * Weights for the hybrid score calculation.
 * keyword + semantic + content boost must sum to 1.0.
 */
const KEYWORD_WEIGHT = 0.35;
const SEMANTIC_WEIGHT = 0.50;
/**
 * Bonus weight for verbatim keyword matches found inside section content.
 * Proportional to the fraction of provided keywords found in the section text.
 */
const CONTENT_BOOST_WEIGHT = 0.15;

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
    async hybridSearch(
        userId: string,
        query: string,
        contentKeywords?: string[]
    ): Promise<ScoredSection[]> {
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

            // Content-keyword boost: reward sections where user's verbatim
            // keywords appear directly in the section text.
            const contentBoost = this.contentKeywordBoost(
                s.content,
                contentKeywords
            );

            const score = Math.min(1, keywordScore + semanticScore + contentBoost);

            return {
                ...s,
                sectionId: s.id.toString(),
                score,
                confidence: score
            };
        });

        const results = scored.sort((a, b) => b.score - a.score).slice(0, 3);

        logger.info("hybridSearch: top results", {
            results: results.map((r) => ({ title: r.title, confidence: r.confidence })),
            contentKeywordsUsed: contentKeywords ?? [],
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

    /**
     * Adds a completely new section to the draft.
     */
    async addSection(userId: string, title: string, content: string): Promise<Section> {
        const context = DraftService.contexts.get(userId);
        if (!context) {
            throw new Error(`No draft context found for user ${userId}. Please prepare the draft first.`);
        }

        const newId = Math.max(...context.sections.map(s => s.id), -1) + 1;
        const [embedding] = await this.embeddings.embedDocuments([content]);

        const newSection: Section = {
            id: newId,
            title,
            content,
            embedding,
        };

        // Add to sections array
        context.sections.push(newSection);

        // Add to search index
        context.index.add(newSection as any);

        logger.info("addSection: added new section to draft", { userId, sectionId: newId, title });
        return newSection;
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

    /**
     * Computes a normalised bonus score [0, CONTENT_BOOST_WEIGHT] based on how many
     * of the provided keywords appear verbatim (case-insensitive) in sectionContent.
     *
     * Returns 0 when no keywords are provided.
     */
    private contentKeywordBoost(
        sectionContent: string,
        keywords?: string[]
    ): number {
        if (!keywords || keywords.length === 0) return 0;

        const lowerContent = sectionContent.toLowerCase();
        const matched = keywords.filter((kw) =>
            lowerContent.includes(kw.toLowerCase())
        ).length;

        return (matched / keywords.length) * CONTENT_BOOST_WEIGHT;
    }
}