import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import logger from "../../logger";

import { draftServiceProvider } from "../db/draft-service.provider";
import { DraftService, LOW_CONFIDENCE_THRESHOLD } from "../db/draft.service";

import { addToSection, patchSection } from "./patch-editor";

import { PatchResult, ToolOutput } from "../../agents/types/agent.types";

import { createAzureOpenAIModel } from "../../agents/config/azure-openai.config";
import { parseIntent } from "../../agents/tools/intent-parser";

const model = createAzureOpenAIModel();

const draftService: DraftService = draftServiceProvider.get();

export const summaryEditorTool = new DynamicStructuredTool({
    name: "edit_summary_sections",

    description: "Edit discharge summary sections using natural language.",

    schema: z.object({
        instruction: z.string(),
        userId: z.string(),
        patientId: z.string(),
        accountNumber: z.string(),
    }),

    func: async ({
        instruction,
        userId,
        patientId,
        accountNumber,
    }): Promise<string> => {
        try {
            logger.info("Summary editor invoked", {
                instruction,
                userId,
                patientId,
                accountNumber,
            });

            const intent = await parseIntent(instruction, model);

            const searchQuery = `${intent.target} ${instruction}`.trim();

            const topSections = await draftService.search({
                patientId,
                accountNumber,
                query: searchQuery,
                limit: 3,
            });

            if (!topSections.length) {
                return JSON.stringify({
                    message: "No matching sections found.",
                    edits: [],
                    needsClarification: false,
                });
            }

            const best = topSections[0];

            if (best.confidence < LOW_CONFIDENCE_THRESHOLD) {
                return JSON.stringify({
                    message: `Low confidence (${(best.confidence * 100).toFixed(
                        0,
                    )}%). Please clarify.`,
                    edits: [],
                    needsClarification: true,
                });
            }

            const isAdd = intent.action === "add";

            const original = best.content;

            const updated = isAdd
                ? await addToSection(best as any, instruction, model)
                : await patchSection(best as any, instruction, model);

            await draftService.updateSection({
                patientId,
                accountNumber,
                sectionId: best.sectionId,
                newContent: updated,
                newReferences: [],
            });

            const edits: PatchResult[] = [
                {
                    title: best.title,
                    original,
                    updated,
                    confidence: best.confidence,
                },
            ];

            const output: ToolOutput = {
                message: `Updated "${best.title}"`,
                edits,
                needsClarification: false,
            };

            logger.info("Edit completed", {
                section: best.title,
                userId,
            });

            return JSON.stringify(output);
        } catch (err: any) {
            logger.error("Summary tool failed", {
                error: err.message,
                stack: err.stack,
            });

            return JSON.stringify({
                message: err.message,
                edits: [],
                needsClarification: false,
            });
        }
    },
});