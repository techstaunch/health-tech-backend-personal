import crypto from "crypto";
import logger from "../../logger";

import { EmbeddingsService } from "../../agents/services/embeddings.service";
import { Reference } from "../../agents/types/draft-summary";

import { DraftRepository } from "./draft.repository";
import { SearchService } from "./search.service";

import { DraftEntity } from "./draft.entity";
import { SectionEntity } from "./section.entity";
import pool from "../../db";
export const LOW_CONFIDENCE_THRESHOLD = 0.35;

export class DraftService {
  private embeddings = EmbeddingsService.getProvider();

  constructor(
    private repository: DraftRepository,
    private searchService: SearchService,
  ) {}

  /* ================================
     Prepare Draft
  ================================= */

  async prepareDraft(params: {
    patientId: string;
    accountNumber: string;
    createdBy: string;
    draft: Record<string, string>;
    sectionReferences?: Record<string, Reference[]>;
  }): Promise<DraftEntity> {
    const draft = await this.repository.findOrCreateDraft({
      patientId: params.patientId,
      accountNumber: params.accountNumber,
      createdBy: params.createdBy,
    });

    const entries = Object.entries(params.draft);

    const embeddings = await this.embeddings.embedDocuments(
      entries.map(([, c]) => c),
    );

    const allRefs: Reference[] = [];
    const sections: SectionEntity[] = [];

    for (let i = 0; i < entries.length; i++) {
      const [title, content] = entries[i];

      const refs = params.sectionReferences?.[title] ?? [];

      refs.forEach((r) => allRefs.push(r));

      sections.push(
        new SectionEntity({
          id: crypto.randomUUID(),
          title,
          content,
          referenceIds: refs.map((r) => r.id),
          embedding: embeddings[i],
        }),
      );
    }

    const uniqueRefs = Array.from(
      new Map(allRefs.map((r) => [r.id, r])).values(),
    );

    if (uniqueRefs.length) {
      await this.repository.upsertReferences(
        draft.id,
        uniqueRefs,
      );
    }

    await this.repository.upsertSections(
      draft.id,
      sections,
    );

    const versionId =
      await this.repository.createVersion({
        draftId: draft.id,
        version: 0,
        createdBy: params.createdBy,
        isRollback: false,
      });

    await this.repository.saveVersionSections(
      versionId,
      sections,
    );

    await this.repository.updateDraftMeta(
      draft.id,
      0,
      1,
    );

    draft.restoreSections(sections);
    draft.addOrUpdateReferences(uniqueRefs);

    this.searchService.buildIndex(draft);

    logger.info("Draft prepared", {
      patientId: params.patientId,
      accountNumber: params.accountNumber,
    });

    return draft;
  }

  /* ================================
     Load Draft (Read-only - reads from IMMUTABLE version_sections)
  ================================= */

  async getDraft(
    patientId: string,
    accountNumber: string,
  ): Promise<DraftEntity | null> {
    const draft =
      await this.repository.getDraftMeta(
        patientId,
        accountNumber,
      );

    if (!draft) return null;

    // FIXED: Read from IMMUTABLE version_sections table using current_version
    // This ensures we always get the last committed state, not the mutable sections table
    const sections = await this.repository.getVersionSnapshot(
      draft.id,
      draft.currentVersionNumber,
    );

    if (sections) {
      draft.restoreSections(sections);
    }

    const refs =
      await this.repository.getDraftReferences(
        draft.id,
      );

    draft.restoreReferences(refs);

    this.searchService.buildIndex(draft);

    return draft;
  }
 

  async updateSection(params: {
    patientId: string;
    accountNumber: string;
    sectionId: string;
    newContent: string;
    newReferences: Reference[];
  }): Promise<void> {
    const draft = await this.getDraft(
      params.patientId,
      params.accountNumber,
    );

    if (!draft) throw new Error("Draft not found");

    const section = draft.getSection(params.sectionId);

    if (!section) throw new Error("Section not found");

    const [embedding] =
      await this.embeddings.embedDocuments([
        params.newContent,
      ]);

    if (params.newReferences.length) {
      draft.addOrUpdateReferences(params.newReferences);

      await this.repository.upsertReferences(
        draft.id,
        params.newReferences,
      );
    }

    section.update(
      params.newContent,
      params.newReferences.map((r) => r.id),
      embedding,
    );

    // Update the mutable sections table for work-in-progress changes
    await this.repository.upsertSections(
      draft.id,
      [section],
    );

    this.searchService.buildIndex(draft);

    logger.info("Section updated", {
      draftId: draft.id,
      sectionId: params.sectionId,
    });
  }

  /* ================================
     Commit Draft
  ================================= */

  async commitDraft(params: {
    patientId: string;
    accountNumber: string;
    createdBy: string;
  }): Promise<string> {
    // Get the current working version from the mutable sections table
    const draft =
      await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

    if (!draft) throw new Error("Draft not found");

    // Read current working sections from the MUTABLE sections table
    const workingSections = await this.repository.getCurrentSections(draft.id);

    if (!workingSections || workingSections.length === 0) {
      throw new Error("No sections to commit");
    }

    const newVersion = draft.nextVersionNumber;

    // Create a new immutable version snapshot
    const versionId =
      await this.repository.createVersion({
        draftId: draft.id,
        version: newVersion,
        createdBy: params.createdBy,
        isRollback: false,
      });

    // Save the working sections as an immutable version
    await this.repository.saveVersionSections(
      versionId,
      workingSections,
    );

    draft.advanceVersion();

    // Update the draft metadata to point to the new committed version
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
  }

  /* ================================
     Discard Changes (Reset to last committed version)
  ================================= */

  async discardDraft(params: {
    patientId: string;
    accountNumber: string;
  }): Promise<boolean> {
    const draft =
      await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

    if (!draft) return false;

    // Restore the mutable sections table from the last committed version
    const restored =
      await this.repository.overwriteWorkspaceFromVersion(
        draft.id,
        draft.currentVersionNumber,
      );

    if (!restored) return false;

    draft.restoreSections(restored);

    const refs =
      await this.repository.getDraftReferences(
        draft.id,
      );

    draft.restoreReferences(refs);

    this.searchService.buildIndex(draft);

    logger.info("Draft discarded", {
      draftId: draft.id,
    });

    return true;
  }

  /* ================================
     Rollback (Create new version from old version)
  ================================= */

  async rollback(params: {
    patientId: string;
    accountNumber: string;
    targetVersion: string;
    createdBy: string;
  }): Promise<boolean> {
    const draft =
      await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

    if (!draft) return false;

    const versionNum = Number(
      params.targetVersion.replace("v", ""),
    );

    if (isNaN(versionNum))
      throw new Error("Invalid version");

    // Get the snapshot from the target version
    const targetSnapshot = await this.repository.getVersionSnapshot(
      draft.id,
      versionNum,
    );

    if (!targetSnapshot) return false;

    // Overwrite the mutable sections table with the target version
    const restored =
      await this.repository.overwriteWorkspaceFromVersion(
        draft.id,
        versionNum,
      );

    if (!restored) return false;

    const newVersion = draft.nextVersionNumber;

    // Create a new version entry marked as a rollback
    const versionId =
      await this.repository.createVersion({
        draftId: draft.id,
        version: newVersion,
        createdBy: params.createdBy,
        isRollback: true,
      });

    // Save the restored sections as the new version
    await this.repository.saveVersionSections(
      versionId,
      restored,
    );

    draft.restoreSections(restored);
    draft.advanceVersion();

    // Update metadata to point to the new version
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
  }

  /* ================================
     History
  ================================= */

  async getHistory(
    patientId: string,
    accountNumber: string,
  ) {
    const draft =
      await this.repository.getDraftMeta(
        patientId,
        accountNumber,
      );

    if (!draft) return null;

    const { rows } = await pool.query(
      `
      SELECT
        version,
        created_by,
        created_at,
        is_rollback
      FROM draft_versions
      WHERE draft_id = $1
      ORDER BY version ASC
      `,
      [draft.id],
    );

    return rows.map(
      (h: {
        version: number;
        created_by: string;
        created_at: string;
        is_rollback: boolean;
      }) => ({
        version: `v${h.version}`,
        createdBy: h.created_by,
        timestamp: h.created_at,
        isRollback: h.is_rollback,
      }),
    );
  }

  /* ================================
     Search
  ================================= */

  async search(params: {
    patientId: string;
    accountNumber: string;
    query: string;
    limit?: number;
  }) {
    const draft = await this.getDraft(
      params.patientId,
      params.accountNumber,
    );

    if (!draft) throw new Error("Draft not found");

    const [queryEmbedding] =
      await this.embeddings.embedDocuments([
        params.query,
      ]);

    return this.searchService.search(
      draft,
      params.query,
      queryEmbedding,
      params.limit ?? 3,
    );
  }

  /* ================================
     Get Version Snapshot (Read-only from immutable version_sections)
  ================================= */

  async getSnapshotByVersion(params: {
    patientId: string;
    accountNumber: string;
    version: number;
  }) {
    const draft =
      await this.repository.getDraftMeta(
        params.patientId,
        params.accountNumber,
      );

    if (!draft) return null;

    // Read from IMMUTABLE version_sections table
    const snapshot = await this.repository.getVersionSnapshot(
      draft.id,
      params.version,
    );

    if (!snapshot) return null;

    const history = await this.getHistory(
      params.patientId,
      params.accountNumber,
    );

    const found = history?.find(
      (h) => h.version === `v${params.version}`,
    );

    if (!found) return null;

    return {
      version: params.version,
      createdBy: found.createdBy,
      timestamp: found.timestamp,
      isRollback: found.isRollback,
      sections: snapshot,
    };
  }
}