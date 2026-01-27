import { Router } from "express";
import os from "os";
import process from "process";
import { checkDbHealth } from "../db/health";

const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const uptimeSeconds = process.uptime();
  const memoryUsage = process.memoryUsage();
  const dbHealth = await checkDbHealth();

  res.json({
    status: "ok",
    environment: process.env.NODE_ENV || "unknown",
    uptime: {
      seconds: Math.floor(uptimeSeconds),
      human: `${Math.floor(uptimeSeconds / 60)}m ${Math.floor(uptimeSeconds % 60)}s`,
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      cpuCores: os.cpus().length,
      loadAverage: os.loadavg(),
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
    },
    process: {
      pid: process.pid,
      memoryMB: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      },
    },
    database: {
      postgres: dbHealth,
    },
    timestamp: new Date().toISOString(),
  });
});

export default healthRouter;
