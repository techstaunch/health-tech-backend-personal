import FlexSearch from "flexsearch";
import { DraftEntity } from "./draft.entity";
import { SectionEntity } from "./section.entity";

const KEYWORD_WEIGHT = 0.4;
const SEMANTIC_WEIGHT = 0.6;

interface SearchContext {
  index: any;
  sections: SectionEntity[];
}

export class SearchService {
  private contexts = new Map<string, SearchContext>();

  buildIndex(draft: DraftEntity): void {
    const index = new FlexSearch.Document({
      tokenize: "forward",
      resolution: 9,
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: "forward" },
          { field: "content", tokenize: "forward" },
        ],
      },
    });

    for (const s of draft.sections) {
      index.add({
        id: s.id,
        title: s.title,
        content: s.content,
      });
    }

    this.contexts.set(draft.id, {
      index,
      sections: draft.sections,
    });
  }

  clear(draftId: string): void {
    this.contexts.delete(draftId);
  }

  search(
    draft: DraftEntity,
    query: string,
    queryEmbedding: number[],
    limit = 3,
  ) {
    const ctx = this.contexts.get(draft.id);
    if (!ctx) throw new Error("Index not built");

    const { index, sections } = ctx;

    const keywordResults = index.search(query, {
      limit: 5,
      suggest: true,
    });

    const keywordHitIds = new Set<string>();

    if (Array.isArray(keywordResults)) {
      for (const r of keywordResults) {
        r?.result?.forEach((id: string) =>
          keywordHitIds.add(id),
        );
      }
    }

    const scored = sections.map((s) => {
      const keywordScore = keywordHitIds.has(s.id)
        ? KEYWORD_WEIGHT
        : 0;

      const semanticScore = s.embedding
        ? this.cosineSimilarity(
            queryEmbedding,
            s.embedding,
          ) * SEMANTIC_WEIGHT
        : 0;

      const score = Math.min(
        1,
        keywordScore + semanticScore,
      );

      return {
        sectionId: s.id,
        title: s.title,
        content: s.content,
        confidence: score,
      };
    });

    return scored
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  private cosineSimilarity(
    a: number[],
    b: number[],
  ): number {
    let dot = 0;
    let na = 0;
    let nb = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }

    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }
}