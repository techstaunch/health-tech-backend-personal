import { AzureChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { IntentResult } from "../types/agent.types";
import logger from "../../logger";

const VALID_ACTIONS = ["replace", "add", "delete", "update", "change"] as const;

const INTENT_SYSTEM_PROMPT = `You are a specialized intent parser for a medical document editor.
Extract all edit requests from the user's instruction and return ONLY a valid JSON array of objects.

Output schema (no other text, no markdown, no explanation):
[
  {
    "action": "replace | add | delete | update | change",
    "target": "the section name or concept to change",
    "value": "the new value or content to apply",
    "sectionId": "optional UUID if the user specifically provided a section ID (e.g. --sectionId--UUID)"
  }
]

NOTES:
- The user may provide multiple instructions (e.g., "Update observation 15 min to 16 min and remove suicidal ideation"). Extract EACH as a separate object in the array.
- If the user provides an explicit section ID (often formatted as --sectionId-- followed by a UUID), extract it into the 'sectionId' field.
- If no section ID is provided, leave 'sectionId' as null or omit it.`;

const VALIDATION_SYSTEM_PROMPT = `You are a critical auditor for a medical document editor.
Your task is to verify if the extracted intents (JSON array) correctly and completely represent the user's natural language instruction.

User Instruction: "{instruction}"
Extracted Intents: {intents}

Rules for validation:
1. Every distinct edit requested by the user must be present in the intents.
2. The 'originalPhrase' in each intent must accurately reflect what the user said for that specific edit.
3. If the user's instruction is ambiguous or missing critical information (like what to change something TO), flag it.
4. If the intents contain hallucinations (actions or values not in the instruction), flag it.

Output MUST be a valid JSON object:
{{
  "isValid": true | false,
  "reason": "Clear, concise explanation of why it is invalid or what is missing. If valid, leave empty or 'OK'."
}}`;


/**
 * Parses a natural language instruction into one or more structured IntentResults.
 *
 * Uses temperature=0 for deterministic, consistent JSON extraction.
 *
 * @param instruction - The user's raw instruction (e.g. "Change Effexor dose to 75mg daily and add a check-in")
 * @param model - A shared AzureChatOpenAI instance
 * @returns Array of parsed IntentResults
 * @throws Error if the LLM response cannot be parsed as valid JSON
 */
export async function parseIntent(
    instruction: string,
    model: AzureChatOpenAI
): Promise<IntentResult[]> {
    logger.info("Intent parser: parsing instruction", { instruction });

    const response = await model.invoke([
        new SystemMessage(INTENT_SYSTEM_PROMPT),
        new HumanMessage(`Instruction: ${instruction}`),
    ]);

    const rawContent =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    // Extract the JSON array even if the model wraps it in markdown fences
    const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
        logger.error("Intent parser: no JSON array found in response", { rawContent });
        throw new Error(
            `Intent parser could not extract JSON array from model response. Raw: ${rawContent}`
        );
    }

    let parsedArray: any[];
    try {
        parsedArray = JSON.parse(jsonMatch[0]);
    } catch (e) {
        logger.error("Intent parser: JSON.parse failed", { jsonMatch: jsonMatch[0] });
        throw new Error(`Intent parser produced invalid JSON: ${jsonMatch[0]}`);
    }

    if (!Array.isArray(parsedArray)) {
        logger.error("Intent parser: response is not an array", { parsedArray });
        throw new Error("Intent parser expected an array of results.");
    }

    const results: IntentResult[] = parsedArray.map((parsed: any) => {
        const action = VALID_ACTIONS.includes(parsed.action) ? parsed.action : "update";

        return {
            action,
            target: String(parsed.target || ""),
            value: String(parsed.value ?? ""),
            sectionId: parsed.sectionId ? String(parsed.sectionId) : undefined,
        };
    });

    logger.info("Intent parser: intents extracted", { count: results.length, results });
    return results;
}

/**
 * Validates that the parsed intents correctly represent the user's instruction.
 *
 * @param instruction - The original user instruction
 * @param intents - The array of parsed IntentResults
 * @param model - A shared AzureChatOpenAI instance
 * @returns Object indicating if valid and the reason if not
 */
export async function validateIntent(
    instruction: string,
    intents: IntentResult[],
    model: AzureChatOpenAI
): Promise<{ isValid: boolean; reason?: string }> {
    logger.info("Intent parser: validating intents", { instruction, intentCount: intents.length });

    const prompt = VALIDATION_SYSTEM_PROMPT
        .replace("{instruction}", instruction)
        .replace("{intents}", JSON.stringify(intents, null, 2));

    const response = await model.invoke([
        new SystemMessage(prompt),
        new HumanMessage("Perform validation and return JSON object."),
    ]);

    const rawContent =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        logger.error("Intent validator: no JSON object found in response", { rawContent });
        return { isValid: true }; // Default to true if validation fails to avoid blocking if just a formatting error
    }

    try {
        const result = JSON.parse(jsonMatch[0]);
        logger.info("Intent validator: result", result);
        return {
            isValid: Boolean(result.isValid),
            reason: result.reason || undefined,
        };
    } catch (e) {
        logger.error("Intent validator: JSON.parse failed", { jsonMatch: jsonMatch[0] });
        return { isValid: true };
    }
}
