import { AzureChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ScoredSection, EnrichedData } from "../types/agent.types";
import logger from "../../logger";

const PATCH_SYSTEM_PROMPT = `You are a clinical documentation editor.
Update ONLY the provided section content based on the instruction.

STRICT RULES:
- Modify only what is necessary
- Do NOT add explanations or commentary
- Keep medical wording professional
- Preserve all existing formatting and structure
- Return ONLY the updated section content as plain text — no JSON, no markdown

Use the ENRICHED CONTEXT (if provided) to ensure the accuracy of the modification. The ENRICHED CONTEXT contains historical records related to IDs mentioned in the section.`;

const ADD_SYSTEM_PROMPT = `You are a clinical documentation editor.
Append a new item to the provided section content based on the instruction.

STRICT RULES:
- Add ONLY the new item specified in the instruction
- Preserve all existing content exactly as-is
- Match the formatting style of existing items in the section
- Return the FULL updated section content as plain text — no JSON, no markdown

Use the ENRICHED CONTEXT (if provided) to ensure the accuracy of the new item being added.`;

/**
 * Updates (replaces/modifies) existing content within a section.
 *
 * @param section - The section to patch
 * @param instruction - The user's original instruction
 * @param model - A shared AzureChatOpenAI instance
 * @returns The full updated section content as a string
 */
export async function patchSection(
    section: ScoredSection,
    instruction: string,
    model: AzureChatOpenAI,
    enrichedData?: EnrichedData[]
): Promise<string> {
    logger.info("Patch editor: patching section", {
        sectionTitle: section.title,
        instruction,
        hasEnrichedData: !!enrichedData?.length
    });

    const enrichedContext = enrichedData?.length
        ? `\n\nENRICHED CONTEXT (Historical Records):\n${enrichedData.map(d => `[${d.id}]: ${d.content}`).join("\n")}`
        : "";

    const response = await model.invoke([
        new SystemMessage(PATCH_SYSTEM_PROMPT),
        new HumanMessage(
            `Instruction: ${instruction}\n\nCurrent Section (${section.title}):\n${section.content}${enrichedContext}`
        ),
    ]);

    const updated =
        typeof response.content === "string"
            ? response.content.trim()
            : JSON.stringify(response.content);

    logger.info("Patch editor: section patched", { sectionTitle: section.title });
    return updated;
}

/**
 * Appends a new structured item to a section (e.g. new allergy, new medication).
 *
 * @param section - The section to append to
 * @param instruction - The user's original instruction
 * @param model - A shared AzureChatOpenAI instance
 * @returns The full updated section content as a string
 */
export async function addToSection(
    section: ScoredSection,
    instruction: string,
    model: AzureChatOpenAI,
    enrichedData?: EnrichedData[]
): Promise<string> {
    logger.info("Patch editor: adding to section", {
        sectionTitle: section.title,
        instruction,
        hasEnrichedData: !!enrichedData?.length
    });

    const enrichedContext = enrichedData?.length
        ? `\n\nENRICHED CONTEXT (Historical Records):\n${enrichedData.map(d => `[${d.id}]: ${d.content}`).join("\n")}`
        : "";

    const response = await model.invoke([
        new SystemMessage(ADD_SYSTEM_PROMPT),
        new HumanMessage(
            `Instruction: ${instruction}\n\nCurrent Section (${section.title}):\n${section.content}${enrichedContext}`
        ),
    ]);

    const updated =
        typeof response.content === "string"
            ? response.content.trim()
            : JSON.stringify(response.content);

    logger.info("Patch editor: item added to section", { sectionTitle: section.title });
    return updated;
}
