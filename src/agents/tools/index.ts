/**
 * Tool registry - exports all available tools for the agent
 */

import { summaryEditorTool } from "./summary-editor.tool";

/**
 * Array of all available tools for the healthcare agent
 * Add new tools to this array as they are created
 */
export const healthcareTools = [
    summaryEditorTool,
    // Add more tools here as needed
];

/**
 * Export individual tools for direct access if needed
 */
// export { healthInfoTool, summaryEditorTool };
export { summaryEditorTool };
