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
    sectionId: z.string().optional(),
  }),

  func: async ({
    instruction,
    userId,
    patientId,
    accountNumber,
    sectionId
  }): Promise<string> => {
    try {
      logger.info("Summary editor invoked", {
        instruction,
        userId,
        patientId,
        accountNumber,
        sectionId
      });

      const intents = await parseIntent(instruction, model);

      const validation = await validateIntent(instruction, intents, model);

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

      const synthesizeInstruction = (intent: any): string => {
        const { action, target, value } = intent;
        switch (action) {
          case "add":
            return `Add the following to the section: ${value}`;
          case "delete":
            return `Delete the following from the section: ${target}`;
          case "replace":
          case "update":
          case "change":
            return `Update the section regarding "${target}" with the following: ${value}`;
          default:
            return `Apply changes to the section: ${target} -> ${value}`;
        }
      };

      const draft = await draftService.getDraft(patientId, accountNumber);
      if (!draft) {
        throw new Error("Draft not found");
      }

      for (const intent of intents) {
        let targetSections: any[] = [];

        if (sectionId) {
          const section = draft.getSection(sectionId);
          if (section) {
            targetSections = [
              {
                id: section.id,
                sectionId: section.id,
                title: section.title,
                content: section.content,
                score: 1.0,
                confidence: 1.0,
              },
            ];
          } else {
            logger.warn("Provided sectionId not found in draft", { sectionId });
          }
        }

        if (targetSections.length === 0) {
          const searchQuery = `${intent.target} ${intent.value}`.trim();

          const candidateSections = await draftService.search({
            patientId,
            accountNumber,
            query: searchQuery,
            limit: 5,
          });

          if (!candidateSections.length) {
            clarificationMessages.push(
              `No sections found for "${intent.target}".`,
            );
            continue;
          }

          const normalizeTarget = (name: string) =>
            name.trim().toLowerCase().replace(/\s+section$/i, "");

          const targetNormalized = normalizeTarget(intent.target);

          const exactMatch = candidateSections.find(
            (s) => normalizeTarget(s.title) === targetNormalized,
          );

          if (exactMatch) {
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
        }

        let intentHandled = false;
        const instructionToApply = synthesizeInstruction(intent);

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
            ? await addToSection(section as any, instructionToApply, model)
            : await patchSection(section as any, instructionToApply, model);

          if (updated.trim() !== original.trim()) {
            await draftService.updateSection({
              patientId,
              accountNumber,
              sectionId: section.sectionId || section.id,
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
