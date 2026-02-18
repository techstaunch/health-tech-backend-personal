import { AzureChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { IntentResult } from "../types/agent.types";
import logger from "../../logger";

const VALID_ACTIONS = ["replace", "add", "delete", "update", "change"] as const;

const INTENT_SYSTEM_PROMPT = `You are a specialized intent parser for a medical document editor.
Extract the edit request from the user's instruction and return ONLY valid JSON.

Output schema (no other text, no markdown, no explanation):
{
  "action": "replace | add | delete | update | change",
  "target": "the section name or concept to change",
  "value": "the new value or content to apply"
}`;

/**
 * Parses a natural language instruction into a structured IntentResult.
 *
 * Uses temperature=0 for deterministic, consistent JSON extraction.
 *
 * @param instruction - The user's raw instruction (e.g. "Change Effexor dose to 75mg daily")
 * @param model - A shared AzureChatOpenAI instance
 * @returns Parsed IntentResult
 * @throws Error if the LLM response cannot be parsed as valid JSON
 */
export async function parseIntent(
    instruction: string,
    model: AzureChatOpenAI
): Promise<IntentResult> {
    logger.info("Intent parser: parsing instruction", { instruction });

    const response = await model.invoke([
        new SystemMessage(INTENT_SYSTEM_PROMPT),
        new HumanMessage(`Instruction: ${instruction}`),
    ]);

    const rawContent =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    // Extract the JSON object even if the model wraps it in markdown fences
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        logger.error("Intent parser: no JSON object found in response", { rawContent });
        throw new Error(
            `Intent parser could not extract JSON from model response. Raw: ${rawContent}`
        );
    }

    let parsed: any;
    try {
        parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
        logger.error("Intent parser: JSON.parse failed", { jsonMatch: jsonMatch[0] });
        throw new Error(`Intent parser produced invalid JSON: ${jsonMatch[0]}`);
    }

    // Validate required fields
    if (!parsed.action || !parsed.target) {
        logger.error("Intent parser: missing required fields", { parsed });
        throw new Error(
            `Intent parser response is missing required fields. Got: ${JSON.stringify(parsed)}`
        );
    }

    // Normalise action to a known value
    const action = VALID_ACTIONS.includes(parsed.action) ? parsed.action : "update";

    const intent: IntentResult = {
        action,
        target: String(parsed.target),
        value: String(parsed.value ?? ""),
    };

    logger.info("Intent parser: intent extracted", { intent });
    return intent;
}
