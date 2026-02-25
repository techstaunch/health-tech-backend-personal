import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AzureChatOpenAI } from "@langchain/openai";
import logger from "../../logger";

export interface ScoredSection {
  sectionId: number;
  title: string;
  content: string;
  embedding?: number[];
  score: number;
  confidence: number;
}

const PATCH_SYSTEM_PROMPT = `You are a clinical documentation editor.
Update ONLY the provided section content based on the instruction.

STRICT RULES:
- Modify only what is necessary
- Do NOT add explanations or commentary
- Keep medical wording professional
- Preserve all existing formatting and structure
- Return ONLY the updated section content as plain text — no JSON, no markdown`;

const ADD_SYSTEM_PROMPT = `You are a clinical documentation editor.
Append a new item to the provided section content based on the instruction.

STRICT RULES:
- Add ONLY the new item specified in the instruction
- Preserve all existing content exactly as-is
- Match the formatting style of existing items in the section
- Return the FULL updated section content as plain text — no JSON, no markdown`;

export async function patchSection(
  section: ScoredSection,
  instruction: string,
  model: AzureChatOpenAI,
): Promise<string> {
  logger.info("Patch editor: patching section", {
    sectionTitle: section.title,
    instruction,
  });

  const response = await model.invoke([
    new SystemMessage(PATCH_SYSTEM_PROMPT),
    new HumanMessage(
      `Instruction: ${instruction}\n\nCurrent Section (${section.title}):\n${section.content}`,
    ),
  ]);

  const updated =
    typeof response.content === "string"
      ? response.content.trim()
      : JSON.stringify(response.content);

  logger.info("Patch editor: section patched", { sectionTitle: section.title });
  return updated;
}

export async function addToSection(
  section: ScoredSection,
  instruction: string,
  model: AzureChatOpenAI,
): Promise<string> {
  logger.info("Patch editor: adding to section", {
    sectionTitle: section.title,
    instruction,
  });

  const response = await model.invoke([
    new SystemMessage(ADD_SYSTEM_PROMPT),
    new HumanMessage(
      `Instruction: ${instruction}\n\nCurrent Section (${section.title}):\n${section.content}`,
    ),
  ]);

  const updated =
    typeof response.content === "string"
      ? response.content.trim()
      : JSON.stringify(response.content);

  logger.info("Patch editor: item added to section", {
    sectionTitle: section.title,
  });
  return updated;
}
