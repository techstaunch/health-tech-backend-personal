"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const os_1 = __importDefault(require("os"));
const process_1 = __importDefault(require("process"));
const health_1 = require("../db/health");
const healthRouter = (0, express_1.Router)();
healthRouter.get("/", async (_req, res) => {
    const uptimeSeconds = process_1.default.uptime();
    const memoryUsage = process_1.default.memoryUsage();
    const dbHealth = await (0, health_1.checkDbHealth)();
    res.json({
        status: "ok",
        environment: process_1.default.env.NODE_ENV || "unknown",
        uptime: {
            seconds: Math.floor(uptimeSeconds),
            human: `${Math.floor(uptimeSeconds / 60)}m ${Math.floor(uptimeSeconds % 60)}s`,
        },
        system: {
            platform: process_1.default.platform,
            arch: process_1.default.arch,
            cpuCores: os_1.default.cpus().length,
            loadAverage: os_1.default.loadavg(),
            totalMemoryMB: Math.round(os_1.default.totalmem() / 1024 / 1024),
            freeMemoryMB: Math.round(os_1.default.freemem() / 1024 / 1024),
        },
        process: {
            pid: process_1.default.pid,
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
exports.default = healthRouter;
