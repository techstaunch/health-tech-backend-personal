/**
 * Middleware registry - exports all middleware for the agent
 */

import { errorHandlerMiddleware } from "./error-handler.middleware";
import { loggingMiddleware } from "./logging.middleware";

/**
 * Creates and returns the middleware array in the correct order
 * Order matters: logging should come before error handling
 */
export const createAgentMiddleware = () => [
    loggingMiddleware,
    errorHandlerMiddleware,
];

/**
 * Export individual middleware for direct access if needed
 */
export { errorHandlerMiddleware, loggingMiddleware };
