/**
 * Tool registry - exports all available tools for the agent
 */

import { healthInfoTool } from "./health-info.tool";

/**
 * Array of all available tools for the healthcare agent
 * Add new tools to this array as they are created
 */
export const healthcareTools = [
    healthInfoTool,
    // Add more tools here as needed
];

/**
 * Export individual tools for direct access if needed
 */
export { healthInfoTool };
