"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
const pg_1 = require("pg");
const logger_1 = __importDefault(require("../logger"));
const ssl = process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false;
exports.pool = new pg_1.Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl,
});
exports.pool.on("connect", () => {
    logger_1.default.info("DB connected");
});
exports.pool.on("remove", () => {
    logger_1.default.info("DB disconnected");
});
exports.pool.on("error", (err) => {
    logger_1.default.error(`DB connection error: ${err?.message || err}`);
});
