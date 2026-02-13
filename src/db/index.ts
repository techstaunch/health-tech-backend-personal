import { Pool } from "pg";
import logger from "../logger";

const ssl =
  process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false;

export const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl,
});

pool.on("connect", () => {
  logger.info("DB connected");
});

pool.on("remove", () => {
  logger.info("DB disconnected");
});

pool.on("error", (err) => {
  logger.error(`DB connection error: ${err?.message || err}`);
});
