import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { validateIntent } from "./intent-parser";
import { createAzureOpenAIModel } from "../../agents/config/azure-openai.config";
import logger from "../../logger";

const model = createAzureOpenAIModel();

export const validateIntentTool = new DynamicStructuredTool({
    name: "validate_intent",
    description: "Briefly validate if the parsed intents (JSON) accurately and completely represent the user's natural language instruction. Call this AFTER parse_intent but BEFORE applying any edits.",
    schema: z.object({
        instruction: z.string().describe("The user's original raw instruction"),
        intents: z.array(z.object({
            action: z.string(),
            target: z.string(),
            value: z.string().optional()
        })).describe("The JSON array of intents returned by parse_intent")
    }),
    func: async ({ instruction, intents }) => {
        try {
            logger.info("validate_intent tool: invoked", { instruction, intentCount: intents.length });
            const validation = await validateIntent(instruction, intents as any, model);

            return JSON.stringify({
                isValid: validation.isValid,
                reason: validation.reason
            });
        } catch (error: any) {
            logger.error("validate_intent tool: failed", { error: error.message });
            return JSON.stringify({ error: error.message });
        }
    }
});
