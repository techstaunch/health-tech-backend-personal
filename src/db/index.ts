import pg from "pg";
import logger from "../logger";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.on("connect", () => {
  logger.info("New database connection established");
});

pool.on("error", (err) => {
  logger.error("Unexpected database pool error", {
    error: err.message,
    stack: err.stack,
  });
});

pool
  .query("SELECT NOW()")
  .then(() => {
    logger.info("Database connection verified");
  })
  .catch((err) => {
    logger.error("Database connection failed on startup", {
      error: err.message,
    });
    process.exit(1);
  });

export default pool;
