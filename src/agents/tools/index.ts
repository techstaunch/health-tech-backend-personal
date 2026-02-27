/**
 * Tool registry - exports all available tools for the agent
 */

import { summaryEditorTool } from "./summary-editor.tool";
import { createSectionTool } from "./create-section.tool";

/**
 * Array of all available tools for the healthcare agent
 * Add new tools to this array as they are created
 */
export const healthcareTools = [
    summaryEditorTool,
    createSectionTool,
    // Add more tools here as needed
];

/**
 * Export individual tools for direct access if needed
 */
export { summaryEditorTool, createSectionTool };
