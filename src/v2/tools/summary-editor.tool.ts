import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import logger from "../../logger";

import { DataEnrichmentService } from "../db/data-enrichment.service";
import { draftServiceProvider } from "../db/draft-service.provider";
import { DraftService, LOW_CONFIDENCE_THRESHOLD } from "../db/draft.service";

import { addToSection, patchSection } from "./patch-editor";

import { PatchResult, ToolOutput } from "../../agents/types/agent.types";

import { createAzureOpenAIModel } from "../../agents/config/azure-openai.config";
import { parseIntent, validateIntent } from "./intent-parser";

const model = createAzureOpenAIModel();
const draftService: DraftService = draftServiceProvider.get();
const enrichmentService = new DataEnrichmentService();

export const summaryEditorTool = new DynamicStructuredTool({
  name: "edit_summary_sections",

  description:
    "Edit discharge summary sections using natural language with hybrid search and multi-intent support.",

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

      const intents = await parseIntent(instruction, model);

      const validation = await validateIntent(instruction, intents, model);
      console.log("validation", validation);
      if (!validation.isValid) {
        logger.warn("edit_summary_sections: intent validation failed", {
          reason: validation.reason,
          instruction,
        });

        return JSON.stringify({
          message: `I'm not sure I correctly understood your instruction: ${validation.reason || "I couldn't clarify the specific edits needed."}
                        Could you please rephrase or provide more details?`,
          edits: [],
          needsClarification: true,
        } as ToolOutput);
      }

      const allEdits: PatchResult[] = [];
      const clarificationMessages: string[] = [];
      const successMessages: string[] = [];
      let needsClarification = false;
      console.log("intents", intents);

      for (const intent of intents) {
        const searchQuery =
          intent.isImplicit && intent.contentKeywords?.length
            ? `${intent.contentKeywords.join(" ")} ${intent.originalPhrase}`.trim()
            : `${intent.target} ${intent.originalPhrase}`.trim();

        const candidateSections = await draftService.search({
          patientId,
          accountNumber,
          query: searchQuery,
          contentKeywords: intent.isImplicit
            ? intent.contentKeywords
            : undefined,
          limit: 5,
        });
        console.log("intent", intent);
        console.log("candidateSections", candidateSections);

        if (!candidateSections.length) {
          clarificationMessages.push(
            `No sections found for "${intent.target}".`,
          );
          continue;
        }

        const exactMatch = !intent.isImplicit
          ? candidateSections.find(
              (s) =>
                s.title.trim().toLowerCase() ===
                intent.target.trim().toLowerCase(),
            )
          : null;

        let targetSections = [];

        if (exactMatch) {
          logger.info("Exact match found for non-implicit intent", {
            target: intent.target,
            sectionId: exactMatch.sectionId,
          });
          targetSections = [exactMatch];
        } else {
          const topConfidence = candidateSections[0].confidence;

          targetSections = candidateSections.filter((s, idx) => {
            if (s.confidence < LOW_CONFIDENCE_THRESHOLD) return false;

            if (idx === 0) return true;

            return topConfidence - s.confidence < 0.15 || s.confidence > 0.6;
          });
        }

        if (!targetSections.length) {
          needsClarification = true;
          clarificationMessages.push(
            `Low confidence for "${intent.target}" (best: "${candidateSections[0].title}" ${(candidateSections[0].confidence * 100).toFixed(0)}%).`,
          );
          continue;
        }

        let intentHandled = false;

        for (const section of targetSections) {
          const isAdd = intent.action === "add";
          const original = section.content;

          // const extractedIds = enrichmentService.extractIds(original);
          // let enrichedData = undefined;

          // if (extractedIds.length > 0) {
          //   const rawEnrichedData = await enrichmentService.fetchEnrichedData(extractedIds);
          //   enrichedData = await enrichmentService.validateRelevance(rawEnrichedData, intent.originalPhrase, model);
          // }

          const updated = isAdd
            ? await addToSection(section as any, intent.originalPhrase, model)
            : await patchSection(section as any, intent.originalPhrase, model);

          if (updated.trim() !== original.trim()) {
            await draftService.updateSection({
              patientId,
              accountNumber,
              sectionId: section.sectionId,
              newContent: updated,
              newReferences: [],
            });

            allEdits.push({
              title: section.title,
              original,
              updated,
              confidence: section.confidence,
            });

            successMessages.push(
              `${isAdd ? "Added to" : "Updated"} "${section.title}".`,
            );

            intentHandled = true;
          }
        }

        if (!intentHandled && targetSections.length === 1) {
          clarificationMessages.push(
            `Identified "${targetSections[0].title}" but no changes applied.`,
          );
        }
      }

      const message = [...successMessages, ...clarificationMessages].join(" ");

      const output: ToolOutput = {
        message: message || "No actions performed.",
        edits: allEdits,
        needsClarification:
          needsClarification ||
          (allEdits.length === 0 && clarificationMessages.length > 0),
      };

      logger.info("Summary editor completed", {
        editCount: allEdits.length,
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
