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
    "isImplicit": true | false,
    "contentKeywords": ["keyword1", "keyword2"],
    "originalPhrase": "the specific substring from the instruction for this edit"
  }
]

NOTES:
- The user may provide multiple instructions (e.g., "Update observation 15 min to 16 min and remove suicidal ideation"). Extract EACH as a separate object in the array.
- 'originalPhrase' MUST be the exact or near-exact part of the user's input that relates to THIS specific edit (e.g. "remove suicidal ideation").
- Set 'isImplicit' to true if the user did NOT explicitly name a section or area (e.g. "Update observation 15 min to 16 min" has no section name — set isImplicit=true).
- Set 'isImplicit' to false only when the user names a specific section directly (e.g. "In the Course of Treatment section, change...").
- 'contentKeywords' MUST include all of the following that are present in the instruction:
    1. Verbatim phrases and clinical terms (e.g. "observation", "Effexor", "Penicillin")
    2. Numeric values and units as they appear (e.g. "15 min", "75mg", "twice daily")
    3. Clinical action verbs (e.g. "observation", "precautions", "assessment")
    4. Common synonyms that may appear in document sections (e.g. "anxiety" → also include "agitation")
  Aim for 3–7 specific, targeted tokens that would appear verbatim in the target section's content.`;

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
            isImplicit: Boolean(parsed.isImplicit),
            contentKeywords: Array.isArray(parsed.contentKeywords) ? parsed.contentKeywords : [],
            originalPhrase: String(parsed.originalPhrase || ""),
        };
    });

    logger.info("Intent parser: intents extracted", { count: results.length, results });
    return results;
}