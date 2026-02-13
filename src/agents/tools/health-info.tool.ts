import { tool } from "langchain";
import { z } from "zod";
import logger from "../../logger";

/**
 * Healthcare information tool - provides general health information
 * This is an example tool that demonstrates the pattern for creating tools
 */
export const healthInfoTool = tool(
    async ({ topic }) => {
        try {
            logger.info("Health info tool invoked", { topic });

            // In a real implementation, this would query a medical database or API
            // For now, we'll return structured information based on the topic
            const healthInfo = getHealthInformation(topic);

            if (!healthInfo) {
                return `I don't have specific information about "${topic}". Please consult with a healthcare professional for accurate medical information.`;
            }

            logger.info("Health info retrieved successfully", { topic });
            return JSON.stringify(healthInfo, null, 2);
        } catch (error: any) {
            logger.error("Health info tool failed", { error: error.message, topic });
            throw new Error(`Failed to retrieve health information: ${error.message}`);
        }
    },
    {
        name: "get_health_info",
        description:
            "Retrieves general health information about common medical topics, conditions, or symptoms. Use this when users ask about general health topics. Do NOT use for diagnosis.",
        schema: z.object({
            topic: z
                .string()
                .describe("The health topic, condition, or symptom to get information about"),
        }),
    }
);

/**
 * Mock function to simulate retrieving health information
 * In production, this would query a real medical database or API
 */
function getHealthInformation(topic: string): any {
    const normalizedTopic = topic.toLowerCase();

    // Example health information database
    const healthDatabase: Record<string, any> = {
        diabetes: {
            condition: "Diabetes",
            description:
                "A chronic condition that affects how your body processes blood sugar (glucose).",
            types: ["Type 1", "Type 2", "Gestational"],
            commonSymptoms: [
                "Increased thirst",
                "Frequent urination",
                "Extreme hunger",
                "Unexplained weight loss",
                "Fatigue",
            ],
            management: [
                "Regular blood sugar monitoring",
                "Healthy diet",
                "Regular exercise",
                "Medication as prescribed",
            ],
            note: "This is general information. Consult a healthcare provider for personalized advice.",
        },
        hypertension: {
            condition: "Hypertension (High Blood Pressure)",
            description:
                "A condition in which the force of blood against artery walls is too high.",
            riskFactors: [
                "Age",
                "Family history",
                "Obesity",
                "High salt intake",
                "Lack of exercise",
            ],
            commonSymptoms: [
                "Often no symptoms (silent killer)",
                "Headaches",
                "Shortness of breath",
                "Nosebleeds (in severe cases)",
            ],
            management: [
                "Regular blood pressure monitoring",
                "Low-sodium diet",
                "Regular exercise",
                "Stress management",
                "Medication as prescribed",
            ],
            note: "This is general information. Consult a healthcare provider for personalized advice.",
        },
        flu: {
            condition: "Influenza (Flu)",
            description: "A contagious respiratory illness caused by influenza viruses.",
            commonSymptoms: [
                "Fever",
                "Cough",
                "Sore throat",
                "Body aches",
                "Fatigue",
                "Headache",
            ],
            prevention: [
                "Annual flu vaccination",
                "Frequent handwashing",
                "Avoid close contact with sick people",
                "Cover coughs and sneezes",
            ],
            treatment: [
                "Rest",
                "Fluids",
                "Over-the-counter pain relievers",
                "Antiviral medications (if prescribed)",
            ],
            note: "This is general information. Consult a healthcare provider for personalized advice.",
        },
    };

    // Try to find matching topic
    for (const [key, value] of Object.entries(healthDatabase)) {
        if (normalizedTopic.includes(key) || key.includes(normalizedTopic)) {
            return value;
        }
    }

    return null;
}
