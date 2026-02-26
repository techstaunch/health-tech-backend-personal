import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { DraftService } from "../services/draft.service";
import { createAzureOpenAIModel } from "../config/azure-openai.config";
import { ToolOutput } from "../types/agent.types";
import logger from "../../logger";

const model = createAzureOpenAIModel();
const draftService = new DraftService();

export const createSectionTool = new DynamicStructuredTool({
    name: "create_new_section",
    description:
        "Use this tool ONLY when the user asks to add completely new data or a new section that does not logically fit into any existing section in the medical document. " +
        "It validates that the requested content doesn't already belong in an existing section, prevents hallucinations, and then creates the new section.",
    schema: z.object({
        instruction: z
            .string()
            .describe("The user's instruction to add a new section or new data (e.g. 'Add a new section for patient precautions saying they should avoid heavy lifting')"),
        userId: z.string().describe("The unique identifier for the user session"),
    }),
    func: async ({ instruction, userId }): Promise<string> => {
        try {
            logger.info("create_new_section: tool invoked", { instruction, userId });

            const existingSections = DraftService.getSections(userId);
            if (!existingSections || existingSections.length === 0) {
                const output: ToolOutput = {
                    message: "No draft context found. Please prepare the draft first.",
                    edits: [],
                    needsClarification: false,
                };
                return JSON.stringify(output);
            }

            // Provide context of existing section titles and content summaries (to keep prompt size reasonable)
            const contextSummary = existingSections.map(s => `- ${s.title}: ${s.content.substring(0, 150)}...`).join("\\n");

            const validationPrompt = `
You are a medical document editor agent.
The user wants to add NEW information: "${instruction}"

Here is a summary of the existing sections in the document:
${contextSummary}

Your task evaluates this request. Return MUST be valid JSON, with no other text:
{
  "isValid": boolean,          // false if the info seems hallucinated/irrelevant, OR if it belongs in one of the existing sections. true ONLY if it's genuinely new valid clinical info that needs its own section.
  "reason": "string",          // Why it's valid or invalid (if invalid, explain why or which existing section it belongs to)
  "generatedTitle": "string",  // If isValid is true, provide an appropriate medical section title (e.g., "Precautions", "Follow-up")
  "generatedContent": "string" // If isValid is true, generate the polished clinical content for this new section based on the user's instruction.
}
`;

            const response = await model.invoke(validationPrompt);
            const rawContent = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

            const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("Could not parse validation response");
            }

            const parsed = JSON.parse(jsonMatch[0]);

            if (!parsed.isValid) {
                logger.warn("create_new_section: validation failed or instruction belongs to existing section", { reason: parsed.reason });
                const output: ToolOutput = {
                    message: `I couldn't create a new section: ${parsed.reason}`,
                    edits: [],
                    needsClarification: false,
                };
                return JSON.stringify(output);
            }

            // Create the new section
            const newSection = await draftService.addSection(userId, parsed.generatedTitle, parsed.generatedContent);

            const output: ToolOutput = {
                message: `Successfully created a new section: "${newSection.title}".`,
                edits: [
                    {
                        title: newSection.title,
                        original: "",
                        updated: newSection.content,
                        confidence: 1.0,
                    }
                ],
            };

            logger.info("create_new_section: completed", { title: newSection.title });
            return JSON.stringify(output);

        } catch (error: any) {
            logger.error("create_new_section: tool failed", {
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