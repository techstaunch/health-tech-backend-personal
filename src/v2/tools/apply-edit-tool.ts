import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { draftServiceProvider } from "../db/draft-service.provider";
import { DraftService } from "../db/draft.service";
import { addToSection, patchSection } from "./patch-editor";
import { createAzureOpenAIModel } from "../../agents/config/azure-openai.config";
import logger from "../../logger";

const model = createAzureOpenAIModel();
const draftService: DraftService = draftServiceProvider.get();

export const applyEditTool = new DynamicStructuredTool({
    name: "apply_edit",
    description: "Applies a clinical edit to a specific section of the medical document. Requires the section ID, the action (add/update/delete/replace/change), and the instruction for the edit.",
    schema: z.object({
        patientId: z.string(),
        accountNumber: z.string(),
        sectionId: z.string().describe("The UUID of the section to edit"),
        action: z.enum(["replace", "add", "delete", "update", "change"]).describe("The type of edit operation. Use 'update' if there are multiple types of changes for this section."),
        instruction: z.string().describe("The specific instruction or combined instructions for this section (e.g., 'Update pulse to 82 AND marked as stable in observation')"),
    }),
    func: async ({ patientId, accountNumber, sectionId, action, instruction }) => {
        try {
            logger.info("apply_edit tool: invoked", { sectionId, action, instruction });

            const draft = await draftService.getDraft(patientId, accountNumber);
            if (!draft) {
                return "Error: Draft not found.";
            }

            const section = draft.getSection(sectionId);
            if (!section) {
                return `Error: Section with ID ${sectionId} not found.`;
            }

            const original = section.content;
            const isAdd = action === "add";

            const updated = isAdd
                ? await addToSection(section as any, instruction, model)
                : await patchSection(section as any, instruction, model);

            if (updated.trim() !== original.trim()) {
                await draftService.updateSection({
                    patientId,
                    accountNumber,
                    sectionId,
                    newContent: updated,
                    newReferences: [],
                });

                return JSON.stringify({
                    success: true,
                    title: section.title,
                    original,
                    updated,
                });
            }

            return JSON.stringify({
                success: false,
                message: "No changes were applied to the section content.",
                title: section.title
            });
        } catch (error: any) {
            logger.error("apply_edit tool: failed", { error: error.message });
            return JSON.stringify({ error: error.message });
        }
    }
});
