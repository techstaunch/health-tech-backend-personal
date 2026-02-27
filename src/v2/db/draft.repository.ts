import pool from "../../db";
import logger from "../../logger";

import { Reference } from "../../agents/types/draft-summary";
import { DraftEntity } from "./draft.entity";
import { SectionEntity } from "./section.entity";

export function sanitizeString(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\u0000/g, "");
  }
  return value;
}

export function deepSanitize<T>(obj: T): T {
  if (typeof obj === "string") {
    return obj.replace(/\u0000/g, "") as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(deepSanitize) as T;
  }

  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, deepSanitize(v)]),
    ) as T;
  }

  return obj;
}

// ---------------------------------------------------------------------------
// Shared SQL fragment reused by getVersionSnapshot and overwriteWorkspaceFromVersion
// Returns section rows joined with their reference_ids for a given draft+version.
// ---------------------------------------------------------------------------
const VERSION_SNAPSHOT_SQL = `
  SELECT
    vs.section_id AS id,
    vs.title,
    vs.content,
    vs.embedding,
    COALESCE(
      array_agg(dr.reference_id)
        FILTER (WHERE dr.reference_id IS NOT NULL),
      '{}'
    ) AS reference_ids
  FROM version_sections vs
  JOIN draft_versions dv
    ON dv.id = vs.version_id
  LEFT JOIN section_reference_map sr
    ON sr.section_id = vs.section_id
  LEFT JOIN draft_references dr
    ON dr.id = sr.reference_id
  WHERE dv.draft_id = $1
    AND dv.version = $2
  GROUP BY vs.section_id, vs.title, vs.content, vs.embedding
  ORDER BY vs.section_id ASC
`;

function rowsToSections(rows: any[]): SectionEntity[] {
  return rows.map(
    (r) =>
      new SectionEntity({
        id: r.id,
        title: r.title,
        content: r.content,
        referenceIds: r.reference_ids,
        embedding: r.embedding
          ? r.embedding
              .replace(/[\[\]]/g, "")
              .split(",")
              .map(Number)
          : undefined,
      }),
  );
}

export class DraftRepository {
  async findOrCreateDraft(params: {
    patientId: string;
    accountNumber: string;
    createdBy: string;
  }): Promise<DraftEntity> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `
        SELECT *
        FROM drafts
        WHERE patient_id = $1
          AND account_number = $2
        FOR UPDATE
        `,
        [params.patientId, params.accountNumber],
      );

      if (existing.rows.length) {
        await client.query("COMMIT");
        return this._rowToDraft(existing.rows[0]);
      }

      const created = await client.query(
        `
        INSERT INTO drafts
          (patient_id, account_number, created_by)
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [params.patientId, params.accountNumber, params.createdBy],
      );

      await client.query("COMMIT");

      logger.info("Draft created", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
      });

      return this._rowToDraft(created.rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      logger.error("Error finding or creating draft", {
        patientId: params.patientId,
        accountNumber: params.accountNumber,
        error: e,
      });
      throw e;
    } finally {
      client.release();
    }
  }

  async getDraftMeta(
    patientId: string,
    accountNumber: string,
  ): Promise<DraftEntity | null> {
    try {
      const { rows } = await pool.query(
        `
        SELECT *
        FROM drafts
        WHERE patient_id = $1
          AND account_number = $2
        `,
        [patientId, accountNumber],
      );

      if (!rows.length) return null;

      return this._rowToDraft(rows[0]);
    } catch (error) {
      logger.error("Error getting draft metadata", {
        patientId,
        accountNumber,
        error,
      });
      throw error;
    }
  }

  async getCurrentSections(draftId: string): Promise<SectionEntity[]> {
    try {
      const { rows } = await pool.query(
        `
        SELECT
          s.id,
          s.title,
          s.content,
          s.embedding,
          COALESCE(
            array_agg(dr.reference_id)
              FILTER (WHERE dr.reference_id IS NOT NULL),
            '{}'
          ) AS reference_ids
        FROM sections s
        LEFT JOIN section_reference_map sr
          ON sr.section_id = s.id
        LEFT JOIN draft_references dr
          ON dr.id = sr.reference_id
        WHERE s.draft_id = $1
        GROUP BY s.id, s.title, s.content, s.embedding
        ORDER BY s.id ASC
        `,
        [draftId],
      );

      return rowsToSections(rows);
    } catch (error) {
      logger.error("Error getting current sections", { draftId, error });
      throw error;
    }
  }

  async upsertReferences(
    draftId: string,
    references: Reference[],
  ): Promise<void> {
    if (!references.length) return;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const ref of references) {
        const clean = deepSanitize(ref) as Reference;

        await client.query(
          `
          INSERT INTO draft_references
            (reference_id, draft_id, url, raw, content)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (draft_id, reference_id) DO UPDATE SET
            url = EXCLUDED.url,
            raw = EXCLUDED.raw,
            content = EXCLUDED.content
          `,
          [clean.id, draftId, clean.url, clean.raw, clean.content],
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      logger.error("Error upserting references", {
        draftId,
        referenceCount: references.length,
        error: e,
      });
      throw e;
    } finally {
      client.release();
    }
  }

  async getDraftReferences(draftId: string): Promise<Reference[]> {
    try {
      const { rows } = await pool.query(
        `
        SELECT reference_id, url, raw, content
        FROM draft_references
        WHERE draft_id = $1
        `,
        [draftId],
      );

      return rows.map((r) => ({
        id: r.reference_id,
        url: r.url,
        raw: r.raw,
        content: r.content,
      }));
    } catch (error) {
      logger.error("Error getting draft references", { draftId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // upsertSections — rewritten to batch all queries instead of N² round-trips.
  //
  // Old approach per section:
  //   1x DELETE section_reference_map
  //   Nx SELECT draft_references (one per referenceId)
  //   Nx INSERT section_reference_map (one per referenceId)
  //
  // New approach for all sections at once:
  //   1x INSERT ... ON CONFLICT per section (unchanged)
  //   1x DELETE section_reference_map WHERE section_id = ANY($1)
  //   1x SELECT draft_references WHERE reference_id = ANY($1) AND draft_id = $2
  //   1x INSERT section_reference_map via unnest batch
  // ---------------------------------------------------------------------------
  async upsertSections(
    draftId: string,
    sections: SectionEntity[],
  ): Promise<void> {
    if (!sections.length) return;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Upsert section rows (one per section — unavoidable, each has unique content)
      for (const s of sections) {
        await client.query(
          `
          INSERT INTO sections
            (id, draft_id, title, content, embedding, updated_at)
          VALUES ($1, $2, $3, $4, $5::vector, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            title      = EXCLUDED.title,
            content    = EXCLUDED.content,
            embedding  = EXCLUDED.embedding,
            updated_at = NOW()
          `,
          [
            s.id,
            draftId,
            s.title,
            s.content,
            s.embedding ? `[${s.embedding.join(",")}]` : null,
          ],
        );
      }

      // 2. Wipe all reference mappings for these sections in one shot
      const sectionIds = sections.map((s) => s.id);

      await client.query(
        `DELETE FROM section_reference_map WHERE section_id = ANY($1::uuid[])`,
        [sectionIds],
      );

      // 3. Collect every unique referenceId that any section needs
      const allReferenceIds = Array.from(
        new Set(sections.flatMap((s) => s.referenceIds)),
      );

      if (!allReferenceIds.length) {
        await client.query("COMMIT");
        return;
      }

      // 4. Single batch SELECT to resolve text reference_id → UUID primary key
      const { rows: refRows } = await client.query(
        `
        SELECT id, reference_id
        FROM draft_references
        WHERE reference_id = ANY($1::text[])
          AND draft_id = $2
        `,
        [allReferenceIds, draftId],
      );

      // Build a lookup map: text reference_id → UUID pk
      const refIdToPk = new Map<string, string>(
        refRows.map((r) => [r.reference_id, r.id]),
      );

      // 5. Build the full set of (section_id, reference_pk) pairs to insert
      const mappingPairs: { sectionId: string; refPk: string }[] = [];

      for (const s of sections) {
        for (const refId of s.referenceIds) {
          const refPk = refIdToPk.get(refId);
          if (refPk) {
            mappingPairs.push({ sectionId: s.id, refPk });
          }
        }
      }

      // 6. Single batch INSERT via unnest — one round-trip regardless of pair count
      if (mappingPairs.length) {
        const sectionIdArr = mappingPairs.map((p) => p.sectionId);
        const refPkArr = mappingPairs.map((p) => p.refPk);

        await client.query(
          `
          INSERT INTO section_reference_map (section_id, reference_id)
          SELECT
            unnest($1::uuid[]),
            unnest($2::uuid[])
          ON CONFLICT DO NOTHING
          `,
          [sectionIdArr, refPkArr],
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      logger.error("Error upserting sections", {
        draftId,
        sectionCount: sections.length,
        error: e,
      });
      throw e;
    } finally {
      client.release();
    }
  }

  async getVersionSnapshot(
    draftId: string,
    version: number,
  ): Promise<SectionEntity[] | null> {
    try {
      const { rows } = await pool.query(VERSION_SNAPSHOT_SQL, [
        draftId,
        version,
      ]);

      if (!rows.length) return null;

      return rowsToSections(rows);
    } catch (error) {
      logger.error("Error getting version snapshot", {
        draftId,
        version,
        error,
      });
      throw error;
    }
  }

  async overwriteWorkspaceFromVersion(
    draftId: string,
    version: number,
  ): Promise<SectionEntity[] | null> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Reuse the same snapshot SQL inside the transaction
      const snapshot = await client.query(VERSION_SNAPSHOT_SQL, [
        draftId,
        version,
      ]);

      if (!snapshot.rows.length) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(`DELETE FROM sections WHERE draft_id = $1`, [draftId]);

      for (const r of snapshot.rows) {
        await client.query(
          `
          INSERT INTO sections (id, draft_id, title, content, embedding, updated_at)
          VALUES ($1, $2, $3, $4, $5::vector, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            title      = EXCLUDED.title,
            content    = EXCLUDED.content,
            embedding  = EXCLUDED.embedding,
            updated_at = NOW()
          `,
          [r.id, draftId, r.title, r.content, r.embedding],
        );
      }

      await client.query("COMMIT");

      return rowsToSections(snapshot.rows);
    } catch (e) {
      await client.query("ROLLBACK");
      logger.error("Error overwriting workspace from version", {
        draftId,
        version,
        error: e,
      });
      throw e;
    } finally {
      client.release();
    }
  }

  async createVersion(params: {
    draftId: string;
    version: number;
    createdBy: string;
    isRollback: boolean;
  }): Promise<number> {
    try {
      const { rows } = await pool.query(
        `
        INSERT INTO draft_versions
          (draft_id, version, created_by, is_rollback)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [params.draftId, params.version, params.createdBy, params.isRollback],
      );

      return rows[0].id;
    } catch (error) {
      logger.error("Error creating version", {
        draftId: params.draftId,
        version: params.version,
        error,
      });
      throw error;
    }
  }

  async saveVersionSections(
    versionId: number,
    sections: SectionEntity[],
  ): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const s of sections) {
        await client.query(
          `
          INSERT INTO version_sections
            (version_id, section_id, title, content, embedding)
          VALUES ($1, $2, $3, $4, $5::vector)
          `,
          [
            versionId,
            s.id,
            s.title,
            s.content,
            s.embedding ? `[${s.embedding.join(",")}]` : null,
          ],
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      logger.error("Error saving version sections", {
        versionId,
        sectionCount: sections.length,
        error: e,
      });
      throw e;
    } finally {
      client.release();
    }
  }

  async updateDraftMeta(
    draftId: string,
    currentVersion: number,
    nextVersion: number,
  ): Promise<void> {
    try {
      await pool.query(
        `
        UPDATE drafts
        SET current_version = $1,
            next_version    = $2,
            updated_at      = NOW()
        WHERE id = $3
        `,
        [currentVersion, nextVersion, draftId],
      );
    } catch (error) {
      logger.error("Error updating draft metadata", {
        draftId,
        currentVersion,
        nextVersion,
        error,
      });
      throw error;
    }
  }
  async updateVersionSectionEmbeddings(
    versionId: number,
    sections: SectionEntity[],
  ): Promise<void> {
    if (!sections.length) return;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const s of sections) {
        await client.query(
          `
          UPDATE version_sections
          SET embedding = $1::vector
          WHERE version_id = $2
            AND section_id = $3
          `,
          [s.embedding ? `[${s.embedding.join(",")}]` : null, versionId, s.id],
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      logger.error("Error updating version section embeddings", {
        versionId,
        sectionCount: sections.length,
        error: e,
      });
      throw e;
    } finally {
      client.release();
    }
  }

  async getReferencesByIds(referenceIds: string[]): Promise<Reference[]> {
    if (!referenceIds.length) return [];

    const { rows } = await pool.query(
      `
    SELECT reference_id, url, raw, content
    FROM draft_references
    WHERE reference_id = ANY($1::text[])
    `,
      [referenceIds],
    );

    return rows.map((r) => ({
      id: r.reference_id,
      url: r.url,
      raw: r.raw,
      content: r.content,
    }));
  }

  async getHistory(draftId: string) {
    try {
      const { rows } = await pool.query(
        `
        SELECT version, created_by, created_at, is_rollback
        FROM draft_versions
        WHERE draft_id = $1
        ORDER BY version ASC
        `,
        [draftId],
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
    } catch (error) {
      logger.error("Error getting draft history", { draftId, error });
      throw error;
    }
  }

  private _rowToDraft(row: any): DraftEntity {
    return new DraftEntity({
      id: row.id,
      patientId: row.patient_id,
      accountNumber: row.account_number,
      createdBy: row.created_by,
      initialSections: [],
      currentVersion: row.current_version,
      nextVersion: row.next_version,
    });
  }
}

export const draftRepository = new DraftRepository();
