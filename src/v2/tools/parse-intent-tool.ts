import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { parseIntent, validateIntent } from "./intent-parser";
import { createAzureOpenAIModel } from "../../agents/config/azure-openai.config";
import logger from "../../logger";

const model = createAzureOpenAIModel();

export const parseIntentTool = new DynamicStructuredTool({
    name: "parse_intent",
    description: "Parse the user's natural language instruction into one or more structured intents (action, target, value). Use this as the first step to understand what needs to be changed.",
    schema: z.object({
        instruction: z.string().describe("The user's raw instruction"),
        feedback: z.string().optional().describe("Feedback from a previous validation failure to help correct the parsing.")
    }),
    func: async ({ instruction, feedback }) => {
        try {
            logger.info("parse_intent tool: invoked", { instruction, hasFeedback: !!feedback });
            const intents = await parseIntent(instruction, model, feedback);
            return JSON.stringify({
                intents
            });
        } catch (error: any) {
            logger.error("parse_intent tool: failed", { error: error.message });
            return JSON.stringify({ error: error.message });
        }
    }
});
