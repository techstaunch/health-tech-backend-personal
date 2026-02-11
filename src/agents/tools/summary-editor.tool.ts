import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { DraftService } from "../services/draft.service";
import { createAzureOpenAIModel } from "../config/azure-openai.config";
import logger from "../../logger";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const draftService = new DraftService();

/**
 * Tool for parsing intent and performing hybrid search + edit on summary sections
 */
export const summaryEditorTool = new DynamicStructuredTool({
    name: "edit_summary_sections",
    description: "Use this tool to edit specific sections of a summary document based on a natural language instruction. It performs intent parsing, hybrid search to find relevant sections, and then updates only those sections.",
    schema: z.object({
        instruction: z.string().describe("The user's voice command or instruction (e.g., 'change effexor dose to 75 mg daily')"),
        userId: z.string().describe("The unique identifier for the user session"),
    }),
    func: async ({ instruction, userId }) => {
        try {
            logger.info("Summary editor tool called", { instruction, userId });

            // 1. Intent Parser (Small LLM call to extract target and action)
            const model = createAzureOpenAIModel();
            const intentPrompt = `Extract edit command as JSON.
Example output:
{
  "action": "replace",
  "target": "effexor dose",
  "value": "75 mg daily"
}
Instruction: ${instruction}`;

            const intentResponse = await model.invoke([
                new SystemMessage("You are a specialized intent parser. Extract the action, target, and value from the instruction as JSON."),
                new HumanMessage(intentPrompt)
            ]);

            let intent;
            try {
                // Try to parse JSON from the response
                const content = typeof intentResponse.content === 'string' ? intentResponse.content : JSON.stringify(intentResponse.content);
                const jsonMatch = content.match(/\{.*\}/s);
                intent = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
            } catch (e) {
                logger.error("Failed to parse intent JSON", { content: intentResponse.content });
                throw new Error("Could not parse intent from instruction.");
            }

            logger.info("Intent parsed", { intent });

            // 2. Hybrid Search (Find relevant sections)
            const relevantSections = await draftService.hybridSearch(userId, intent.target || instruction);
            logger.info("Hybrid search results", { count: relevantSections.length });

            if (relevantSections.length === 0) {
                return "No relevant sections found to edit.";
            }

            // 3. Edit only those sections (LLM)
            const editedSections = await Promise.all(relevantSections.map(async (section) => {
                const editPrompt = `Send:
Instruction: ${instruction}

Text:
${section.content}

Return ONLY the updated text for this section.`;

                const editResponse = await model.invoke([
                    new SystemMessage("You are a medical scribe editor. Edit the provided text based on the instruction. Return ONLY the updated content."),
                    new HumanMessage(editPrompt)
                ]);

                return {
                    ...section,
                    content: typeof editResponse.content === 'string' ? editResponse.content : JSON.stringify(editResponse.content)
                };
            }));

            // Ideally, we would update the cached sections here if needed, 
            // but for now we return the results to the agent.
            return JSON.stringify({
                message: "Successfully edited relevant sections.",
                edits: editedSections.map(s => ({
                    title: s.title,
                    original: relevantSections.find(rs => rs.id === s.id)?.content,
                    updated: s.content
                }))
            });

        } catch (error: any) {
            logger.error("Summary editor tool failed", { error: error.message });
            return `Error: ${error.message}`;
        }
    }
});
