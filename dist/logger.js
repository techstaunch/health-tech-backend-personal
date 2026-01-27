"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const winston_1 = require("winston");
const { combine, timestamp, printf, errors } = winston_1.format;
const isServerless = process.env.VERCEL === "1" || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const currentDate = new Date().toISOString().split("T")[0];
const safeStringify = (obj) => {
    try {
        return JSON.stringify(obj);
    }
    catch {
        return "[unserializable]";
    }
};
const COLORS = {
    reset: "\x1b[0m",
    gray: "\x1b[90m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    blue: "\x1b[36m",
};
const levelColor = (level) => {
    switch (level) {
        case "error":
            return COLORS.red;
        case "warn":
            return COLORS.yellow;
        case "info":
            return COLORS.green;
        case "debug":
            return COLORS.blue;
        default:
            return COLORS.reset;
    }
};
const logFormat = printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;
    const time = `${COLORS.gray}${timestamp}${COLORS.reset}`;
    const lvl = `${levelColor(level)}${level.toUpperCase()}${COLORS.reset}`;
    const msg = `${message}`;
    const metaString = Object.keys(meta).length > 0
        ? ` ${COLORS.gray}${safeStringify(meta)}${COLORS.reset}`
        : "";
    if (stack) {
        return `${time} ${lvl}: ${COLORS.red}${stack}${COLORS.reset}${metaString}`;
    }
    return `${time} ${lvl}: ${msg}${metaString}`;
});
const loggerTransports = [
    new winston_1.transports.Console({
        format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
    }),
];
if (!isServerless) {
    const baseLogDir = path_1.default.join(process.cwd(), "logs");
    const errorDir = path_1.default.join(baseLogDir, "errors");
    const infoDir = path_1.default.join(baseLogDir, "infos");
    [baseLogDir, errorDir, infoDir].forEach((dir) => {
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
    });
    loggerTransports.push(new winston_1.transports.File({
        filename: path_1.default.join(infoDir, `${currentDate}-info.log`),
        level: "info",
        format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), printf(({ timestamp, level, message, ...meta }) => `${timestamp} ${level.toUpperCase()}: ${message}${Object.keys(meta).length ? ` ${safeStringify(meta)}` : ""}`)),
    }), new winston_1.transports.File({
        filename: path_1.default.join(errorDir, `${currentDate}-error.log`),
        level: "error",
        format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), printf(({ timestamp, level, message, stack, ...meta }) => stack
            ? `${timestamp} ${level.toUpperCase()}: ${stack} ${safeStringify(meta)}`
            : `${timestamp} ${level.toUpperCase()}: ${message} ${safeStringify(meta)}`)),
    }));
}
const logger = (0, winston_1.createLogger)({
    level: process.env.LOG_LEVEL || "info",
    format: combine(errors({ stack: true })),
    transports: loggerTransports,
    exitOnError: false,
});
exports.default = logger;
