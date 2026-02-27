import pool from "../../db";
import logger from "../../logger";
import { DraftEntity } from "../db/draft.entity";

const KEYWORD_WEIGHT = 0.35;
const SEMANTIC_WEIGHT = 0.5;
const CONTENT_BOOST_WEIGHT = 0.15;
const MIN_CONFIDENCE = 0.05;

export interface SearchResult {
  sectionId: string;
  title: string;
  content: string;
  confidence: number;
}

export class SearchService {
  async search(
    draft: DraftEntity,
    query: string,
    queryEmbedding: number[],
    contentKeywords?: string[],
    limit = 3,
  ): Promise<SearchResult[]> {
    if (!queryEmbedding.length) {
      throw new Error("queryEmbedding must not be empty");
    }

    try {
      // Build keyword boost expression, deriving param index from actual params array
      const baseParams: unknown[] = [
        `[${queryEmbedding.join(",")}]`, // $1
        draft.id,                         // $2
        query,                            // $3
        limit,                            // $4
        MIN_CONFIDENCE,                   // $5
      ];

      const boostPerKeyword = contentKeywords?.length
        ? CONTENT_BOOST_WEIGHT / contentKeywords.length
        : 0;

      const boostExpression = contentKeywords?.length
        ? contentKeywords
            .map((_, i) => {
              const idx = baseParams.length + 1 + i;
              return `(s.content ILIKE $${idx})::int * ${boostPerKeyword}`;
            })
            .join(" + ")
        : "0";

      const params: unknown[] = [
        ...baseParams,
        ...(contentKeywords ?? []).map((kw) => `%${kw}%`),
      ];

      const { rows } = await pool.query(
        `
        WITH scored AS (
          SELECT
            s.id      AS section_id,
            s.title,
            s.content,
            COALESCE(
              ts_rank(
                to_tsvector('english', s.title || ' ' || s.content),
                plainto_tsquery('english', $3)
              ), 0
            ) * ${KEYWORD_WEIGHT}
            +
            CASE WHEN s.embedding IS NOT NULL
              THEN (1 - (s.embedding <=> $1::vector)) * ${SEMANTIC_WEIGHT}
              ELSE 0
            END
            +
            (${boostExpression}) AS confidence
          FROM sections s
          WHERE s.draft_id = $2
        )
        SELECT *
        FROM scored
        WHERE confidence >= $5
        ORDER BY confidence DESC
        LIMIT $4
        `,
        params,
      );

      return rows.map((r) => ({
        sectionId: r.section_id,
        title: r.title,
        content: r.content,
        confidence: Math.max(0, Math.min(1, parseFloat(r.confidence))),
      }));
    } catch (error) {
      logger.error("Error performing hybrid search", {
        draftId: draft.id,
        error,
      });
      throw error;
    }
  }
}