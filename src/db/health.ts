import { pool } from "./index";

export type DbHealthStatus = {
  status: "up" | "down";
  error?: string;
};

export const checkDbHealth = async (): Promise<DbHealthStatus> => {
  try {
    await pool.query("SELECT 1");
    return { status: "up" };
  } catch (err) {
    return {
      status: "down",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
};
