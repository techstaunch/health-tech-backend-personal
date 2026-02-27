/**
 * @type {import('node-pg-migrate').MigrationBuilder}
 */
export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS vector`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  pgm.createTable("drafts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    patient_id: {
      type: "varchar",
      notNull: true,
    },

    account_number: {
      type: "varchar",
      notNull: true,
    },

    created_by: {
      type: "varchar",
      notNull: true,
    },

    current_version: {
      type: "integer",
      notNull: true,
      default: 0,
    },

    next_version: {
      type: "integer",
      notNull: true,
      default: 1,
    },

    created_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },

    updated_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint("drafts", "drafts_identity_unique", {
    unique: ["patient_id", "account_number"],
  });

  pgm.createTable("sections", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    draft_id: {
      type: "uuid",
      notNull: true,
      references: "drafts",
      onDelete: "CASCADE",
    },

    title: {
      type: "varchar",
      notNull: true,
    },

    content: {
      type: "text",
      notNull: true,
    },

    embedding: {
      type: "vector(1024)",
    },

    updated_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("sections", ["draft_id"]);

  pgm.createTable("draft_versions", {
    id: {
      type: "serial",
      primaryKey: true,
    },

    draft_id: {
      type: "uuid",
      notNull: true,
      references: "drafts",
      onDelete: "CASCADE",
    },

    version: {
      type: "integer",
      notNull: true,
    },

    created_by: {
      type: "varchar",
      notNull: true,
    },

    is_rollback: {
      type: "boolean",
      default: false,
    },

    created_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint("draft_versions", "draft_versions_unique", {
    unique: ["draft_id", "version"],
  });

  pgm.createTable("version_sections", {
    id: {
      type: "serial",
      primaryKey: true,
    },

    version_id: {
      type: "integer",
      notNull: true,
      references: "draft_versions",
      onDelete: "CASCADE",
    },

    section_id: {
      type: "uuid",
      notNull: true,
      references: "sections",
      onDelete: "CASCADE",
    },

    title: {
      type: "varchar",
      notNull: true,
    },

    content: {
      type: "text",
      notNull: true,
    },

    embedding: {
      type: "vector(1024)",
    },
  });

  pgm.createIndex("version_sections", ["version_id"]);

  pgm.createTable("draft_references", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    reference_id: {
      type: "text",
      notNull: true,
    },

    draft_id: {
      type: "uuid",
      notNull: true,
      references: "drafts",
      onDelete: "CASCADE",
    },

    url: {
      type: "text",
      notNull: true,
    },

    raw: {
      type: "text",
    },

    content: {
      type: "text",
    },

    created_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("draft_references", ["draft_id"]);
  pgm.createIndex("draft_references", ["reference_id"]);

  pgm.addConstraint(
    "draft_references",
    "draft_references_draft_reference_unique",
    {
      unique: ["draft_id", "reference_id"],
    },
  );

  pgm.createTable("section_reference_map", {
    section_id: {
      type: "uuid",
      notNull: true,
      references: "sections",
      onDelete: "CASCADE",
    },

    reference_id: {
      type: "uuid",
      notNull: true,
      references: "draft_references",
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("section_reference_map", ["reference_id"]);

  pgm.addConstraint("section_reference_map", "section_reference_map_pk", {
    primaryKey: ["section_id", "reference_id"],
  });
  pgm.addConstraint(
    "version_sections",
    "version_sections_version_section_unique",
    {
      unique: ["version_id", "section_id"],
    },
  );
  pgm.sql(`
    CREATE INDEX sections_fts_idx
    ON sections
    USING GIN (to_tsvector('english', title || ' ' || content))
  `);

  pgm.sql(`
    CREATE INDEX sections_embedding_idx
    ON sections
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `);
};

/**
 * Reverses the migration by dropping all tables and extensions
 * created by the up migration.
 *
 * @param {pgm} pgm - The migration manager
 */
export const down = (pgm) => {
  pgm.dropTable("section_reference_map");
  pgm.dropTable("draft_references");
  pgm.dropTable("version_sections");
  pgm.dropTable("draft_versions");
  pgm.dropTable("sections");
  pgm.dropTable("drafts");

  pgm.sql(`DROP EXTENSION IF EXISTS vector`);
  pgm.sql(`DROP EXTENSION IF EXISTS pgcrypto`);
};
