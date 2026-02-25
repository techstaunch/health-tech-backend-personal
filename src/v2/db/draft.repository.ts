import pool from "../../db";
import logger from "../../logger";

import { Reference } from "../../agents/types/draft-summary";
import { DraftEntity } from "./draft.entity";
import { SectionEntity } from "./section.entity";

/* ================================
   UTF-8 Sanitization
================================ */

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

/* ================================
   Repository
================================ */

export class DraftRepository {
    /* ================================
       Draft: Find or Create
    ================================= */

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
            throw e;
        } finally {
            client.release();
        }
    }

    /* ================================
       Draft: Load Metadata
    ================================= */

    async getDraftMeta(
        patientId: string,
        accountNumber: string,
    ): Promise<DraftEntity | null> {
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
    }

    /* ================================
       NEW: Get Current Sections (Read-only)
    ================================= */

    async getCurrentSections(draftId: string): Promise<SectionEntity[]> {
        const { rows } = await pool.query(
            `
      SELECT
        s.id,
        s.title,
        s.content,
        s.embedding,
        COALESCE(
          array_agg(sr.reference_id)
            FILTER (WHERE sr.reference_id IS NOT NULL),
          '{}'
        ) AS reference_ids
      FROM sections s
      LEFT JOIN section_reference_map sr
        ON sr.section_id = s.id
      WHERE s.draft_id = $1
      GROUP BY s.id, s.title, s.content, s.embedding
      ORDER BY s.id ASC
      `,
            [draftId],
        );

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

    /* ================================
       References: Upsert
    ================================= */

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
            (id, draft_id, url, raw, content)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING
          `,
                    [clean.id, draftId, clean.url, clean.raw, clean.content],
                );
            }

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    }

    /* ================================
       References: Load
    ================================= */

    async getDraftReferences(draftId: string): Promise<Reference[]> {
        const { rows } = await pool.query(
            `
      SELECT id, url, raw, content
      FROM draft_references
      WHERE draft_id = $1
      `,
            [draftId],
        );

        return rows.map((r) => ({
            id: r.id,
            url: r.url,
            raw: r.raw,
            content: r.content,
        }));
    }

    /* ================================
       Sections: Upsert (Live)
    ================================= */

    async upsertSections(
        draftId: string,
        sections: SectionEntity[],
    ): Promise<void> {
        if (!sections.length) return;

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            for (const s of sections) {
                await client.query(
                    `
          INSERT INTO sections
            (id, draft_id, title, content, embedding, updated_at)
          VALUES ($1, $2, $3, $4, $5::vector, NOW())

          ON CONFLICT (id)
          DO UPDATE SET
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
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

                await client.query(
                    `
          DELETE FROM section_reference_map
          WHERE section_id = $1
          `,
                    [s.id],
                );

                for (const refId of s.referenceIds) {
                    await client.query(
                        `
            INSERT INTO section_reference_map
              (section_id, reference_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            `,
                        [s.id, refId],
                    );
                }
            }

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }
    }

    /* ================================
       NEW: Get Version Snapshot (Read-only - does NOT modify workspace)
    ================================= */

    async getVersionSnapshot(
        draftId: string,
        version: number,
    ): Promise<SectionEntity[] | null> {
        const { rows } = await pool.query(
            `
      SELECT
        vs.section_id AS id,
        vs.title,
        vs.content,
        vs.embedding,

        COALESCE(
          array_agg(sr.reference_id)
            FILTER (WHERE sr.reference_id IS NOT NULL),
          '{}'
        ) AS reference_ids

      FROM version_sections vs

      JOIN draft_versions dv
        ON dv.id = vs.version_id

      LEFT JOIN section_reference_map sr
        ON sr.section_id = vs.section_id

      WHERE dv.draft_id = $1
        AND dv.version = $2

      GROUP BY vs.section_id, vs.title, vs.content, vs.embedding
      ORDER BY vs.section_id ASC
      `,
            [draftId, version],
        );

        if (!rows.length) return null;

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

    /* ================================
       Workspace Reset From Version (WRITES to database)
    ================================= */

    async overwriteWorkspaceFromVersion(
        draftId: string,
        version: number,
    ): Promise<SectionEntity[] | null> {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const snapshot = await client.query(
                `
        SELECT
          vs.section_id AS id,
          vs.title,
          vs.content,
          vs.embedding,

          COALESCE(
            array_agg(sr.reference_id)
              FILTER (WHERE sr.reference_id IS NOT NULL),
            '{}'
          ) AS reference_ids

        FROM version_sections vs

        JOIN draft_versions dv
          ON dv.id = vs.version_id

        LEFT JOIN section_reference_map sr
          ON sr.section_id = vs.section_id

        WHERE dv.draft_id = $1
          AND dv.version = $2

        GROUP BY vs.section_id, vs.title, vs.content, vs.embedding
        ORDER BY vs.section_id ASC
        `,
                [draftId, version],
            );

            if (!snapshot.rows.length) {
                await client.query("ROLLBACK");
                return null;
            }

            await client.query(`DELETE FROM sections WHERE draft_id = $1`, [draftId]);

            for (const r of snapshot.rows) {
                await client.query(
                    `INSERT INTO sections (
    id,
    draft_id,
    title,
    content,
    embedding,
    updated_at
  )
  VALUES ($1, $2, $3, $4, $5::vector, NOW())

  ON CONFLICT (id)
  DO UPDATE SET
    title     = EXCLUDED.title,
    content   = EXCLUDED.content,
    embedding = EXCLUDED.embedding,
    updated_at = NOW()
  `,
                    [r.id, draftId, r.title, r.content, r.embedding],
                );
            }

            await client.query("COMMIT");

            return snapshot.rows.map(
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
        } catch (e) {
            await client.query("ROLLBACK");
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
        await pool.query(
            `
      UPDATE drafts
      SET current_version = $1,
          next_version = $2,
          updated_at = NOW()
      WHERE id = $3
      `,
            [currentVersion, nextVersion, draftId],
        );
    }

    /* ================================
       Helpers
    ================================= */

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
