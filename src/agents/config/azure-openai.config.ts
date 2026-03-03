import { AzureChatOpenAI, AzureOpenAIEmbeddings } from "@langchain/openai";
import logger from "../../logger";

/**
 * Creates and configures an Azure OpenAI model instance for LangChain
 * @returns Configured AzureChatOpenAI instance
 * @throws Error if required environment variables are missing
 */
export const createAzureOpenAIModel = (): AzureChatOpenAI => {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview";

    // Validate required configuration
    if (!apiKey || !endpoint || !deploymentName) {
        const missing = [];
        if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
        if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
        if (!deploymentName) missing.push("AZURE_OPENAI_DEPLOYMENT_NAME");

        const errorMsg = `Missing required Azure OpenAI configuration: ${missing.join(", ")}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }

    const temperature = parseFloat(process.env.AGENT_TEMPERATURE || "0.7");
    const timeout = parseInt(process.env.AGENT_TIMEOUT_MS || "30000");

    logger.info("Initializing Azure OpenAI model", {
        endpoint,
        deploymentName,
        apiVersion,
        temperature,
        timeout,
    });

    return new AzureChatOpenAI({
        azureOpenAIApiKey: apiKey,
        azureOpenAIEndpoint: endpoint,
        azureOpenAIApiDeploymentName: deploymentName,
        azureOpenAIApiVersion: apiVersion,
        temperature,
        maxTokens: 2000,
        timeout,
    });
};

/**
 * Creates and configures an Azure OpenAI Embeddings instance
 * @returns Configured AzureOpenAIEmbeddings instance
 */
export const createAzureOpenAIEmbeddings = (): AzureOpenAIEmbeddings => {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const deploymentName = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME || "text-embedding-3-small";
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview";

    // Extract instance name from endpoint if not explicitly provided
    // Example: https://saince-ai-resource.cognitiveservices.azure.com/ -> saince-ai-resource
    const instanceName = process.env.AZURE_OPENAI_INSTANCE_NAME ||
        endpoint?.match(/https?:\/\/([^.]+)/)?.[1];

    if (!apiKey || !endpoint || !instanceName) {
        throw new Error("Missing required Azure OpenAI configuration for embeddings (apiKey, endpoint, or instanceName)");
    }

    return new AzureOpenAIEmbeddings({
        azureOpenAIApiKey: apiKey,
        azureOpenAIEndpoint: endpoint,
        azureOpenAIApiInstanceName: instanceName,
        azureOpenAIApiDeploymentName: deploymentName,
        azureOpenAIApiVersion: apiVersion,
    });
};