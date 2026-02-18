import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { DraftService, LOW_CONFIDENCE_THRESHOLD } from "../services/draft.service";
import { createAzureOpenAIModel } from "../config/azure-openai.config";
import { parseIntent } from "./intent-parser";
import { patchSection, addToSection } from "./patch-editor";
import { PatchResult, ToolOutput } from "../types/agent.types";
import logger from "../../logger";

// Shared model instance — created once, reused for all sub-calls within the tool
const model = createAzureOpenAIModel();
const draftService = new DraftService();

/**
 * edit_summary_sections — Super Agent Tool
 *
 * Orchestrates the full edit pipeline:
 *   1. Intent Detection  → parseIntent()
 *   2. Hybrid Search     → draftService.hybridSearch()
 *   3. Confidence Check  → LOW_CONFIDENCE_THRESHOLD gate
 *   4. Patch / Add       → patchSection() | addToSection()
 *   5. Cache Update      → draftService.updateSection()
 */
export const summaryEditorTool = new DynamicStructuredTool({
    name: "edit_summary_sections",
    description:
        "Use this tool to edit specific sections of a discharge summary document based on a natural language instruction. " +
        "It detects intent, finds the relevant section via hybrid search, validates confidence, and applies a targeted patch. " +
        "Use for update, replace, add, and delete operations.",
    schema: z.object({
        instruction: z
            .string()
            .describe(
                "The user's editing instruction (e.g. 'Change Effexor dose to 75mg daily' or 'Add Penicillin allergy under Medical History')"
            ),
        userId: z.string().describe("The unique identifier for the user session"),
    }),
    func: async ({ instruction, userId }): Promise<string> => {
        try {
            logger.info("edit_summary_sections: tool invoked", { instruction, userId });

            // ── Step 1: Intent Detection ──────────────────────────────────────
            const intent = await parseIntent(instruction, model);
            logger.info("edit_summary_sections: intent detected", { intent });

            // ── Step 2: Hybrid Search ─────────────────────────────────────────
            // Combine the extracted target with the full instruction for richer search
            const searchQuery = `${intent.target} ${instruction}`.trim();
            const topSections = await draftService.hybridSearch(userId, searchQuery);

            if (topSections.length === 0) {
                const output: ToolOutput = {
                    message: "No sections found in the document. Please prepare the draft first.",
                    edits: [],
                    needsClarification: false,
                };
                return JSON.stringify(output);
            }

            // ── Step 3: Confidence Check ──────────────────────────────────────
            const bestMatch = topSections[0];
            logger.info("edit_summary_sections: best match", {
                title: bestMatch.title,
                confidence: bestMatch.confidence,
                threshold: LOW_CONFIDENCE_THRESHOLD,
            });

            if (bestMatch.confidence < LOW_CONFIDENCE_THRESHOLD) {
                logger.warn("edit_summary_sections: low confidence, requesting clarification", {
                    confidence: bestMatch.confidence,
                });
                const output: ToolOutput = {
                    message:
                        `I couldn't confidently identify which section to edit (best match: "${bestMatch.title}", ` +
                        `confidence: ${(bestMatch.confidence * 100).toFixed(0)}%). ` +
                        `Could you be more specific? For example, mention the section name directly.`,
                    edits: [],
                    needsClarification: true,
                };
                return JSON.stringify(output);
            }

            // ── Step 4: Patch / Add — best match only ────────────────────────
            // topSections is already sorted by confidence descending.
            // We take only the single highest-confidence section so the patch
            // target is unambiguous and easy to apply on the frontend.
            const bestSection = bestMatch; // already the top result
            const isAddOperation = intent.action === "add";

            const original = bestSection.content;
            const updatedContent = isAddOperation
                ? await addToSection(bestSection, instruction, model)
                : await patchSection(bestSection, instruction, model);

            // ── Step 5: Cache Update ──────────────────────────────────────────
            draftService.updateSection(userId, bestSection.id, updatedContent);

            const edits: PatchResult[] = [
                {
                    title: bestSection.title,
                    original,
                    updated: updatedContent,
                    confidence: bestSection.confidence,
                },
            ];

            const output: ToolOutput = {
                message: `Successfully ${isAddOperation ? "added to" : "updated"} section "${bestSection.title}".`,
                edits,
            };

            logger.info("edit_summary_sections: completed", {
                editCount: edits.length,
                sections: edits.map((e) => e.title),
            });

            return JSON.stringify(output);
        } catch (error: any) {
            logger.error("edit_summary_sections: tool failed", {
                error: error.message,
                stack: error.stack,
            });
            return JSON.stringify({
                message: `Error: ${error.message}`,
                edits: [],
            });
        }
    },
});
