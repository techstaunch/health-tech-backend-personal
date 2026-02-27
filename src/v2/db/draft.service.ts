import crypto from "crypto";
import logger from "../../logger";

import { EmbeddingsService } from "../../agents/services/embeddings.service";
import { Reference } from "../../agents/types/draft-summary";

import { DraftRepository } from "./draft.repository";
import { SearchService } from "./search.service";

import { DraftEntity } from "./draft.entity";
import { SectionEntity } from "./section.entity";

export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export class DraftService {
  private embeddings = EmbeddingsService.getProvider();

  constructor(
    private repository: DraftRepository,
    private searchService: SearchService,
  ) {}

  async prepareDraft(params: {
    patientId: string;
    accountNumber: string;
    createdBy: string;
    draft: Record<string, string>;
    sectionReferences?: Record<string, Reference[]>;
  }): Promise<DraftEntity> {
    try {
      const draft = await this.repository.findOrCreateDraft({
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        createdBy: params.createdBy,
      });

      const entries = Object.entries(params.draft);

      const allRefs: Reference[] = [];
      const sections: SectionEntity[] = entries.map(([title, content]) => {
        const refs = params.sectionReferences?.[title] ?? [];
        refs.forEach((r) => allRefs.push(r));

        return new SectionEntity({
          id: crypto.randomUUID(),
          title,
          content,
          referenceIds: refs.map((r) => r.id),
          embedding: undefined,
        });
      });

      const uniqueRefs = Array.from(
        new Map(allRefs.map((r) => [r.id, r])).values(),
      );

      const [, , versionId] = await Promise.all([
        uniqueRefs.length
          ? this.repository.upsertReferences(draft.id, uniqueRefs)
          : Promise.resolve(),
        this.repository.upsertSections(draft.id, sections),
        this.repository.createVersion({
          draftId: draft.id,
          version: 0,
          createdBy: params.createdBy,
          isRollback: false,
        }),
      ]);

      await Promise.all([
        this.repository.saveVersionSections(versionId, sections),
        this.repository.updateDraftMeta(draft.id, 0, 1),
      ]);

      draft.restoreSections(sections);
      draft.addOrUpdateReferences(uniqueRefs);

      logger.info("Draft prepared", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
      });

      setImmediate(async () => {
        try {
          logger.info("Starting background embedding generation", {
            patientId: params.patientId,
            accountNumber: params.accountNumber,
          });

          const embeddings = await this.embeddings.embedDocuments(
            entries.map(([, c]) => c),
          );

          sections.forEach((s, i) => s.updateEmbedding(embeddings[i]));

          await Promise.all([
            this.repository.upsertSections(draft.id, sections),
            this.repository.updateVersionSectionEmbeddings(versionId, sections),
          ]);

          this.searchService.buildIndex(draft);

          logger.info(
            "Background tasks completed (embeddings + search index)",
            {
              patientId: params.patientId,
              accountNumber: params.accountNumber,
            },
          );
        } catch (bgError) {
          logger.error("Error in background tasks", {
            patientId: params.patientId,
            accountNumber: params.accountNumber,
            error: bgError,
          });
        }
      });

      return draft;
    } catch (error) {
      logger.error("Error preparing draft", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        error,
      });
      throw error;
    }
  }

  async getDraft(
    patientId: string,
    accountNumber: string,
  ): Promise<DraftEntity | null> {
    try {
      const draft = await this.repository.getDraftMeta(
        patientId,
        accountNumber,
      );

      if (!draft) return null;

      const [sections, refs] = await Promise.all([
        this.repository.getVersionSnapshot(
          draft.id,
          draft.currentVersionNumber,
        ),
        this.repository.getDraftReferences(draft.id),
      ]);

      if (sections) {
        draft.restoreSections(sections);
      }

      draft.restoreReferences(refs);

      this.searchService.buildIndex(draft);

      return draft;
    } catch (error) {
      logger.error("Error getting draft", { patientId, accountNumber, error });
      throw error;
    }
  }

  async updateSection(params: {
    patientId: string;
    accountNumber: string;
    sectionId: string;
    newContent: string;
    newReferences: Reference[];
  }): Promise<void> {
    try {
      const draft = await this.getDraft(params.patientId, params.accountNumber);

      if (!draft) throw new Error("Draft not found");

      const section = draft.getSection(params.sectionId);

      if (!section) throw new Error("Section not found");

      const [[embedding]] = await Promise.all([
        this.embeddings.embedDocuments([params.newContent]),
        params.newReferences.length
          ? this.repository.upsertReferences(draft.id, params.newReferences)
          : Promise.resolve(),
      ]);

      if (params.newReferences.length) {
        draft.addOrUpdateReferences(params.newReferences);
      }

      section.update(
        params.newContent,
        params.newReferences.map((r) => r.id),
        embedding,
      );

      await this.repository.upsertSections(draft.id, [section]);

      this.searchService.buildIndex(draft);

      logger.info("Section updated", {
        draftId: draft.id,
        sectionId: params.sectionId,
      });
    } catch (error) {
      logger.error("Error updating section", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        sectionId: params.sectionId,
        error,
      });
      throw error;
    }
  }

  async commitDraft(params: {
    patientId: string;
    accountNumber: string;
    createdBy: string;
  }): Promise<string> {
    try {
      const draft = await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

      if (!draft) throw new Error("Draft not found");

      const workingSections = await this.repository.getCurrentSections(
        draft.id,
      );

      if (!workingSections || workingSections.length === 0) {
        throw new Error("No sections to commit");
      }

      const newVersion = draft.nextVersionNumber;

      const versionId = await this.repository.createVersion({
        draftId: draft.id,
        version: newVersion,
        createdBy: params.createdBy,
        isRollback: false,
      });

      await this.repository.saveVersionSections(versionId, workingSections);

      draft.advanceVersion();

      await this.repository.updateDraftMeta(
        draft.id,
        draft.currentVersionNumber,
        draft.nextVersionNumber,
      );

      logger.info("Draft committed", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        version: newVersion,
      });

      return `v${newVersion}`;
    } catch (error) {
      logger.error("Error committing draft", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        error,
      });
      throw error;
    }
  }

  async discardDraft(params: {
    patientId: string;
    accountNumber: string;
  }): Promise<boolean> {
    try {
      const draft = await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

      if (!draft) return false;

      const [restored, refs] = await Promise.all([
        this.repository.overwriteWorkspaceFromVersion(
          draft.id,
          draft.currentVersionNumber,
        ),
        this.repository.getDraftReferences(draft.id),
      ]);

      if (!restored) return false;

      draft.restoreSections(restored);
      draft.restoreReferences(refs);

      this.searchService.buildIndex(draft);

      logger.info("Draft discarded", { draftId: draft.id });

      return true;
    } catch (error) {
      logger.error("Error discarding draft", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        error,
      });
      throw error;
    }
  }

  async rollback(params: {
    patientId: string;
    accountNumber: string;
    targetVersion: string;
    createdBy: string;
  }): Promise<boolean> {
    try {
      const draft = await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

      if (!draft) return false;

      const versionNum = Number(params.targetVersion.replace("v", ""));

      if (isNaN(versionNum)) throw new Error("Invalid version");

      const restored = await this.repository.overwriteWorkspaceFromVersion(
        draft.id,
        versionNum,
      );

      if (!restored) return false;

      const newVersion = draft.nextVersionNumber;

      const versionId = await this.repository.createVersion({
        draftId: draft.id,
        version: newVersion,
        createdBy: params.createdBy,
        isRollback: true,
      });

      // saveVersionSections and getDraftReferences are independent
      const [, refs] = await Promise.all([
        this.repository.saveVersionSections(versionId, restored),
        this.repository.getDraftReferences(draft.id),
      ]);

      draft.restoreSections(restored);
      draft.restoreReferences(refs);
      draft.advanceVersion();

      await this.repository.updateDraftMeta(
        draft.id,
        draft.currentVersionNumber,
        draft.nextVersionNumber,
      );

      this.searchService.buildIndex(draft);

      logger.info("Draft rolled back", {
        draftId: draft.id,
        fromVersion: versionNum,
        toVersion: newVersion,
      });

      return true;
    } catch (error) {
      logger.error("Error rolling back draft", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        targetVersion: params.targetVersion,
        error,
      });
      throw error;
    }
  }

  // Delegates to repository — no more raw pool.query in the service layer
  async getHistory(patientId: string, accountNumber: string) {
    try {
      const draft = await this.repository.getDraftMeta(
        patientId,
        accountNumber,
      );

      if (!draft) return null;

      return this.repository.getHistory(draft.id);
    } catch (error) {
      logger.error("Error getting history", {
        patientId,
        accountNumber,
        error,
      });
      throw error;
    }
  }

  async search(params: {
    patientId: string;
    accountNumber: string;
    query: string;
    contentKeywords?: string[];
    limit?: number;
  }) {
    try {
      const draft = await this.getDraft(params.patientId, params.accountNumber);

      if (!draft) throw new Error("Draft not found");

      const [queryEmbedding] = await this.embeddings.embedDocuments([
        params.query,
      ]);

      return this.searchService.search(
        draft,
        params.query,
        queryEmbedding,
        params.contentKeywords,
        params.limit ?? 3,
      );
    } catch (error) {
      logger.error("Error searching draft", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        query: params.query,
        error,
      });
      throw error;
    }
  }
  async saveInlineVersion(params: {
    patientId: string;
    accountNumber: string;
    createdBy: string;
    sections: { id: string; title: string; content: string }[];
  }): Promise<DraftEntity> {
    try {
      const draft = await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

      if (!draft) {
        throw new Error("Draft not found");
      }

      const resolvedSections: SectionEntity[] = params.sections.map(
        (s) =>
          new SectionEntity({
            id: s.id,
            title: s.title,
            content: s.content,
            referenceIds: [],
            embedding: undefined,
          }),
      );

      const newVersionNumber = draft.nextVersionNumber;

      const versionId = await this.repository.createVersion({
        draftId: draft.id,
        version: newVersionNumber,
        createdBy: params.createdBy,
        isRollback: false,
      });

      await Promise.all([
        this.repository.upsertSections(draft.id, resolvedSections),
        this.repository.saveVersionSections(versionId, resolvedSections),
        this.repository.updateDraftMeta(
          draft.id,
          newVersionNumber,
          newVersionNumber + 1,
        ),
      ]);

      draft.restoreSections(resolvedSections);
      draft.advanceVersion();

      logger.info("Inline version saved", {
        draftId: draft.id,
        version: newVersionNumber,
      });

      setImmediate(async () => {
        try {
          const embeddings = await this.embeddings.embedDocuments(
            resolvedSections.map((s) => s.content),
          );

          resolvedSections.forEach((s, i) => s.updateEmbedding(embeddings[i]));

          await Promise.all([
            this.repository.upsertSections(draft.id, resolvedSections),
            this.repository.updateVersionSectionEmbeddings(
              versionId,
              resolvedSections,
            ),
          ]);

          this.searchService.buildIndex(draft);

          logger.info("Embeddings updated for inline version", {
            draftId: draft.id,
            version: newVersionNumber,
          });
        } catch (err) {
          logger.error("Background embedding error (inline save)", {
            draftId: draft.id,
            error: err,
          });
        }
      });

      return draft;
    } catch (error) {
      logger.error("Error saving inline version", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        error,
      });
      throw error;
    }
  }

  async getSnapshotByVersion(params: {
    patientId: string;
    accountNumber: string;
    version: number;
  }) {
    try {
      const draft = await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

      if (!draft) return null;

      // Snapshot fetch and history fetch are independent
      const [snapshot, history] = await Promise.all([
        this.repository.getVersionSnapshot(draft.id, params.version),
        this.repository.getHistory(draft.id),
      ]);

      if (!snapshot) return null;

      const found = history?.find((h) => h.version === `v${params.version}`);

      if (!found) return null;

      return {
        version: params.version,
        createdBy: found.createdBy,
        timestamp: found.timestamp,
        isRollback: found.isRollback,
        sections: snapshot,
      };
    } catch (error) {
      logger.error("Error getting snapshot by version", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        version: params.version,
        error,
      });
      throw error;
    }
  }
}
