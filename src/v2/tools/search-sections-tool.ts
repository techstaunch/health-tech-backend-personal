import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { draftServiceProvider } from "../db/draft-service.provider";
import { DraftService } from "../db/draft.service";
import logger from "../../logger";

const draftService: DraftService = draftServiceProvider.get();

export const searchSectionsTool = new DynamicStructuredTool({
    name: "search_sections",
    description: "Search for relevant sections in the medical document based on a query. Returns a list of candidate sections with their ID, title, content, and confidence score.",
    schema: z.object({
        patientId: z.string(),
        accountNumber: z.string(),
        sectionId: z.string().describe("The ID of the section to fetch context for. This is provided in the agent context."),
    }),
    func: async ({ patientId, accountNumber, sectionId }) => {
        try {
            logger.info("search_sections tool: invoked", { patientId, accountNumber, sectionId });

            const draft = await draftService.getDraft(patientId, accountNumber);
            if (!draft) {
                return "Error: Draft not found.";
            }

            const section = draft.getSection(sectionId);
            if (section) {
                logger.info("search_sections: match found", { sectionId });
                return JSON.stringify([{
                    id: section.id,
                    sectionId: section.id,
                    title: section.title,
                    content: section.content,
                    confidence: 1.0
                }]);
            }

            logger.warn("search_sections: sectionId not found", { sectionId });
            return `Error: Section with ID ${sectionId} not found in the current draft.`;
        } catch (error: any) {
            logger.error("search_sections tool: failed", { error: error.message });
            return JSON.stringify({ error: error.message });
        }
    }
});
