import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import logger from "../../logger";

import { draftServiceProvider } from "../db/draft-service.provider";
import { DraftService } from "../db/draft.service";
import { SectionEntity } from "../db/section.entity";

import { createAzureOpenAIModel } from "../../agents/config/azure-openai.config";
import { ToolOutput } from "../../agents/types/agent.types";

import crypto from "crypto";

const model = createAzureOpenAIModel();
const draftService: DraftService = draftServiceProvider.get();

export const createSectionTool = new DynamicStructuredTool({
  name: "create_new_section",

  description:
    "Use this tool ONLY when the user asks to add completely new data or a new section that does not logically fit into any existing section in the medical document. " +
    "It validates that the requested content doesn't already belong in any existing section and creates a new section if appropriate.",

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
      logger.info("create_new_section: invoked", {
        instruction,
        userId,
        patientId,
        accountNumber,
      });

      const draft = await draftService.getDraft(patientId, accountNumber);

      if (!draft) {
        const output: ToolOutput = {
          message: "Draft not found. Please prepare the draft first.",
          edits: [],
          needsClarification: false,
        };
        return JSON.stringify(output);
      }

      const existingSections = draft.sections;

      if (!existingSections.length) {
        const output: ToolOutput = {
          message: "No sections available in this draft.",
          edits: [],
          needsClarification: false,
        };
        return JSON.stringify(output);
      }

      const contextSummary = existingSections
        .map((s) => `- ${s.title}: ${s.content.substring(0, 150)}...`)
        .join("\n");

      const validationPrompt = `
You are a medical document editor.

The user wants to add NEW information:
"${instruction}"

Here is a summary of existing sections:
${contextSummary}

Return ONLY valid JSON:
{
  "isValid": boolean,
  "reason": "string",
  "generatedTitle": "string",
  "generatedContent": "string"
}
`;

      const response = await model.invoke(validationPrompt);

      const raw =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not parse validation response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.isValid) {
        logger.warn("create_new_section rejected", {
          reason: parsed.reason,
        });

        const output: ToolOutput = {
          message: `Cannot create section: ${parsed.reason}`,
          edits: [],
          needsClarification: false,
        };

        return JSON.stringify(output);
      }
 
      const [embedding] = await draftService["embeddings"].embedDocuments([
        parsed.generatedContent,
      ]);

      const newSection = new SectionEntity({
        id: crypto.randomUUID(),
        title: parsed.generatedTitle,
        content: parsed.generatedContent,
        referenceIds: [],
        embedding,
      });
 
      await draftService["repository"].upsertSections(draft.id, [newSection]);
 
      await draftService.getDraft(patientId, accountNumber);

      const output: ToolOutput = {
        message: `Successfully created new section "${newSection.title}".`,
        edits: [
          {
            title: newSection.title,
            original: "",
            updated: newSection.content,
            confidence: 1.0,
          },
        ],
        needsClarification: false,
      };

      logger.info("create_new_section completed", {
        title: newSection.title,
      });

      return JSON.stringify(output);
    } catch (err: any) {
      logger.error("create_new_section failed", {
        error: err.message,
        stack: err.stack,
      });

      return JSON.stringify({
        message: `Error: ${err.message}`,
        edits: [],
        needsClarification: false,
      });
    }
  },
});
