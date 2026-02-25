import {
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import {
  Annotation,
  CompiledStateGraph,
  END,
  MessagesAnnotation,
  StateGraph,
} from "@langchain/langgraph";

import { HEALTHCARE_SYSTEM_PROMPT } from "../../agents/config/agent.config";
import { createAzureOpenAIModel } from "../../agents/config/azure-openai.config";
import { AgentMessage } from "../../agents/types/agent.types";

import logger from "../../logger";
import { LOW_CONFIDENCE_THRESHOLD } from "./draft.service";
import { healthcareTools } from "../tools";

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>(),
  patientId: Annotation<string>(),
  accountNumber: Annotation<string>(),
});

export class AgentService {
  private agent!: CompiledStateGraph<any, any, any>;

  constructor() {
    this.initializeAgent();
  }

  private initializeAgent() {
    try {
      const model = createAzureOpenAIModel();
      const modelWithTools = model.bindTools(healthcareTools);

      const callModel = async (state: typeof AgentState.State) => {
        const systemPrompt = [
          HEALTHCARE_SYSTEM_PROMPT,
          `CURRENT USER ID: ${state.userId}`,
          `PATIENT ID: ${state.patientId}`,
          `ACCOUNT NUMBER: ${state.accountNumber}`,
          `Use userId, patientId, and accountNumber for all tools.`,
          `If confidence is below ${LOW_CONFIDENCE_THRESHOLD}, ask for clarification.`,
        ].join("\n");

        const messages = [new SystemMessage(systemPrompt), ...state.messages];

        const response = await modelWithTools.invoke(messages);

        return { messages: [response] };
      };

      const shouldContinue = (state: typeof AgentState.State) => {
        const last = state.messages[state.messages.length - 1];

        if (
          last?._getType?.() === "ai" &&
          (last as AIMessage)?.tool_calls?.length
        ) {
          return "tools";
        }

        return END;
      };

      const toolNode = async (state: typeof AgentState.State) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;

        const toolCalls = last?.tool_calls ?? [];

        const results = await Promise.all(
          toolCalls.map(async (call) => {
            const tool = healthcareTools.find((t) => t.name === call.name);

            if (!tool) {
              logger.error("Tool not found", {
                tool: call.name,
              });

              return new ToolMessage({
                tool_call_id: call.id!,
                content: `Tool ${call.name} not found`,
              });
            }

            try {
              const args = {
                ...call.args,
                userId: state.userId,
                patientId: state.patientId,
                accountNumber: state.accountNumber,
              };

              logger.info("Tool call started", {
                tool: call.name,
                args,
              });

              const result = await (tool as any).invoke(args);

              return new ToolMessage({
                tool_call_id: call.id!,
                content:
                  typeof result === "string" ? result : JSON.stringify(result),
              });
            } catch (err: any) {
              logger.error("Tool failed", {
                tool: call.name,
                error: err?.message,
              });

              return new ToolMessage({
                tool_call_id: call.id!,
                content: `Tool error: ${err?.message}`,
              });
            }
          }),
        );

        return { messages: results };
      };

      const workflow = new StateGraph(AgentState)
        .addNode("agent", callModel)
        .addNode("tools", toolNode)
        .addEdge("__start__", "agent")
        .addConditionalEdges("agent", shouldContinue, {
          tools: "tools",
          [END]: END,
        })
        .addEdge("tools", "agent");

      this.agent = workflow.compile();

      logger.info("Agent initialized");
    } catch (err: any) {
      logger.error("Agent init failed", {
        error: err?.message,
        stack: err?.stack,
      });
      throw err;
    }
  }

  private extractToolResult(result: any) {
    const messages = result?.messages ?? [];

    const toolMsg = [...messages]
      .reverse()
      .find((m) => m?._getType?.() === "tool");

    if (toolMsg) {
      try {
        return JSON.parse(toolMsg.content);
      } catch {
        return {
          message: toolMsg.content,
          edits: [],
          needsClarification: false,
        };
      }
    }

    const aiMsg = [...messages].reverse().find((m) => m?._getType?.() === "ai");

    if (aiMsg) {
      const text =
        typeof aiMsg.content === "string"
          ? aiMsg.content
          : JSON.stringify(aiMsg.content);

      return {
        message: text,
        edits: [],
        needsClarification: false,
      };
    }

    return {
      message: null,
      edits: [],
      needsClarification: false,
    };
  }

  async invoke(
    messages: AgentMessage[],
    userId: string,
    identity: {
      patientId: string;
      accountNumber: string;
    },
  ) {
    const result = await this.agent.invoke({
      messages: messages as any,
      userId,
      patientId: identity.patientId,
      accountNumber: identity.accountNumber,
    });

    const toolData = this.extractToolResult(result);

    return {
      success: true,
      message: toolData.message,
      edits: toolData.edits,
      needsClarification: toolData.needsClarification,
      dirty: (toolData.edits?.length ?? 0) > 0,
    };
  }
}
