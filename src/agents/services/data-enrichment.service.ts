import { AzureChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { EnrichedData } from "../types/agent.types";
import logger from "../../logger";

/**
 * DataEnrichmentService
 *
 * Handles extraction of IDs from clinical text, fetching related documents,
 * and validating their relevance to the current edit instruction.
 */
export class DataEnrichmentService {
    /**
     * Extracts IDs like [T263517] from text.
     */
    extractIds(text: string): string[] {
        const regex = /\[(T\d+)\]/g;
        const matches = [...text.matchAll(regex)];
        const ids = [...new Set(matches.map(m => m[1]))];

        if (ids.length > 0) {
            logger.info("DataEnrichmentService: extracted IDs", { ids });
        }

        return ids;
    }

    /**
     * Fetches data for the given IDs from an external API.
     * 
     * NOTE: This is a placeholder implementation. Replace with actual API calls.
     */
    async fetchEnrichedData(ids: string[]): Promise<EnrichedData[]> {
        if (ids.length === 0) return [];

        logger.info("DataEnrichmentService: fetching data for IDs", { ids });

        // MOCK DATA: In a real implementation, you would use fetch() or an axios client here.
        return ids.map(id => ({
            id,
            title: `Document ${id}`,
            content: `This is the historical record for ${id}. It contains relevant details about the patient's previous treatment and laboratory results.`,
            found: true
        }));
    }

    /**
     * Validates whether feteched data is relevant to the user's instruction.
     */
    async validateRelevance(datas: EnrichedData[], instruction: string, model: AzureChatOpenAI): Promise<EnrichedData[]> {
        if (datas.length === 0) return [];

        logger.info("DataEnrichmentService: validating relevance for instruction", { instruction });

        const validatedResults: EnrichedData[] = [];

        for (const data of datas) {
            const prompt = `
            You are a medical data analyst. 
            Determine if the following historical document is relevant and helpful for applying this editing instruction to a clinical summary.

            Instruction: "${instruction}"
            
            Document ID: ${data.id}
            Document Content: "${data.content}"

            Respond with ONLY "YES" or "NO".
            `;

            const response = await model.invoke([
                new SystemMessage("You are a medical data analyst who determines relevance of documents."),
                new HumanMessage(prompt)
            ]);

            const result = typeof response.content === "string" ? response.content.trim().toUpperCase() : "";

            if (result === "YES") {
                logger.info("DataEnrichmentService: document validated as relevant", { id: data.id });
                validatedResults.push(data);
            } else {
                logger.info("DataEnrichmentService: document discarded as NOT relevant", { id: data.id });
            }
        }

        return validatedResults;
    }
}
