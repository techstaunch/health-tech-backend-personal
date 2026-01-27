import fs from "fs";
import path from "path";
import { createLogger, format, transports } from "winston";
import TransportStream from "winston-transport";

const { combine, timestamp, printf, errors } = format;

const isServerless =
  process.env.VERCEL === "1" || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const currentDate = new Date().toISOString().split("T")[0];

const safeStringify = (obj: Record<string, unknown>) => {
  try {
    return JSON.stringify(obj);
  } catch {
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

const levelColor = (level: string) => {
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

  const metaString =
    Object.keys(meta).length > 0
      ? ` ${COLORS.gray}${safeStringify(meta)}${COLORS.reset}`
      : "";

  if (stack) {
    return `${time} ${lvl}: ${COLORS.red}${stack}${COLORS.reset}${metaString}`;
  }

  return `${time} ${lvl}: ${msg}${metaString}`;
});

const loggerTransports: TransportStream[] = [
  new transports.Console({
    format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
  }),
];

if (!isServerless) {
  const baseLogDir = path.join(process.cwd(), "logs");
  const errorDir = path.join(baseLogDir, "errors");
  const infoDir = path.join(baseLogDir, "infos");

  [baseLogDir, errorDir, infoDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  loggerTransports.push(
    new transports.File({
      filename: path.join(infoDir, `${currentDate}-info.log`),
      level: "info",
      format: combine(
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        printf(
          ({ timestamp, level, message, ...meta }) =>
            `${timestamp} ${level.toUpperCase()}: ${message}${
              Object.keys(meta).length ? ` ${safeStringify(meta)}` : ""
            }`,
        ),
      ),
    }),
    new transports.File({
      filename: path.join(errorDir, `${currentDate}-error.log`),
      level: "error",
      format: combine(
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        printf(({ timestamp, level, message, stack, ...meta }) =>
          stack
            ? `${timestamp} ${level.toUpperCase()}: ${stack} ${safeStringify(
                meta,
              )}`
            : `${timestamp} ${level.toUpperCase()}: ${message} ${safeStringify(
                meta,
              )}`,
        ),
      ),
    }),
  );
}

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(errors({ stack: true })),
  transports: loggerTransports,
  exitOnError: false,
});

export default logger;
