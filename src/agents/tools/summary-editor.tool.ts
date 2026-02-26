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
            const intents = await parseIntent(instruction, model);
            logger.info("edit_summary_sections: intents detected", { count: intents.length });

            const allEdits: PatchResult[] = [];
            let needsClarification = false;
            const clarificationMessages: string[] = [];
            const successMessages: string[] = [];

            for (const intent of intents) {
                // ── Step 2: Hybrid Search ─────────────────────────────────────────
                const searchQuery =
                    intent.isImplicit && intent.contentKeywords?.length
                        ? `${intent.contentKeywords.join(" ")} ${intent.originalPhrase}`.trim()
                        : `${intent.target} ${intent.originalPhrase}`.trim();

                const candidateSections = await draftService.hybridSearch(
                    userId,
                    searchQuery,
                    intent.isImplicit ? intent.contentKeywords : undefined
                );

                if (candidateSections.length === 0) {
                    clarificationMessages.push(`No sections found for target "${intent.target}".`);
                    continue;
                }

                // ── Step 3: Confidence & Selection ────────────────────────────────
                // We consider multiple sections if they have sufficient confidence
                const topConfidence = candidateSections[0].confidence;

                // Filter sections to those that are likely relevant:
                // 1. Must be above LOW_CONFIDENCE_THRESHOLD
                // 2. Must be within a reasonable margin of the top match OR have high absolute confidence
                const targetSections = candidateSections.filter((s, idx) => {
                    if (s.confidence < LOW_CONFIDENCE_THRESHOLD) return false;
                    if (idx === 0) return true; // Always include the top match if above threshold

                    // Include subsequent matches if they are close to the top match or highly confident
                    return (topConfidence - s.confidence < 0.15) || (s.confidence > 0.6);
                });

                if (targetSections.length === 0) {
                    needsClarification = true;
                    clarificationMessages.push(
                        `I couldn't confidently identify which section to edit for "${intent.target}" (best match: "${candidateSections[0].title}", ` +
                        `confidence: ${(candidateSections[0].confidence * 100).toFixed(0)}%).`
                    );
                    continue;
                }

                // ── Step 4: Patch / Add ──────────────────────────────────────────
                let intentHandled = false;

                for (const section of targetSections) {
                    const isAddOperation = intent.action === "add";
                    const original = section.content;

                    const updatedContent = isAddOperation
                        ? await addToSection(section, intent.originalPhrase, model)
                        : await patchSection(section, intent.originalPhrase, model);

                    // Check if a change actually occurred
                    if (updatedContent.trim() !== original.trim()) {
                        // ── Step 5: Cache Update ──────────────────────────────────────
                        draftService.updateSection(userId, section.id, updatedContent);

                        allEdits.push({
                            title: section.title,
                            original,
                            updated: updatedContent,
                            confidence: section.confidence,
                        });

                        successMessages.push(`Successfully ${isAddOperation ? "added to" : "updated"} section "${section.title}".`);
                        intentHandled = true;
                    } else {
                        logger.info("edit_summary_sections: no change detected for section", {
                            title: section.title,
                            intent: intent.originalPhrase
                        });
                    }
                }

                if (!intentHandled) {
                    // If no sections were actually changed, we might need clarification if clarify was intended
                    // but for entity updates across sections, it's normal if some candidates don't match.
                    // If it's the ONLY candidate and no change, then it's a failure to apply.
                    if (targetSections.length === 1) {
                        clarificationMessages.push(`I identified "${targetSections[0].title}" as the target, but the instruction didn't seem to require any changes.`);
                    }
                }
            }

            // Consolidate final output
            let finalMessage = "";
            if (successMessages.length > 0) {
                finalMessage = successMessages.join(" ");
            }
            if (clarificationMessages.length > 0) {
                finalMessage += (finalMessage ? " " : "") + clarificationMessages.join(" ");
            }

            const output: ToolOutput = {
                message: finalMessage || "No actions were performed.",
                edits: allEdits,
                needsClarification: needsClarification || (allEdits.length === 0 && clarificationMessages.length > 0),
            };

            logger.info("edit_summary_sections: completed", {
                editCount: allEdits.length,
                sections: allEdits.map((e) => e.title),
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