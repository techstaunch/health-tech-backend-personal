# AI Agent Lifecycle & Hybrid Search Workflow

This document provides a technical breakdown of how the LangChain agent processes voice commands and performs targeted edits on the discharge summary draft.

## Phase 1: Preparation (One-Time)
When the draft summary is loaded, the frontend calls `/api/agent/prepare-draft`.

1.  **JSON Sectioning**: The raw JSON is split into independent sections (e.g., "Medications", "Prognosis").
2.  **Indexing**: 
    *   **FlexSearch**: Builds a high-speed keyword index for each section's title and content.
    *   **Embeddings**: Generates semantic vectors for each section using Azure OpenAI (`text-embedding-3-small`).
3.  **Caching**: The indexed sections are stored in memory, linked to the user's session.

## Phase 2: Runtime Voice Command
When the user starts the mic and speaks, the following steps occur:

1.  **Transcription**: 
    *   Audio is sent to `/api/agent/voice-command`.
    *   `gpt-4o-transcribe` converts audio to text (e.g., *"Change Effexor dose to 75mg daily"*).
2.  **Intent Parsing**: 
    *   A specialized LLM prompt extracts the core intent:
        ```json
        { "action": "replace", "target": "Effexor dose", "value": "75mg daily" }
        ```
3.  **Hybrid Search**:
    *   **Keyword Match**: FlexSearch finds sections matching "Effexor dose".
    *   **Semantic Match**: Cosine similarity finds sections related to the concept "Effexor dose".
    *   **Scoring**: Both scores are combined to find the top 3 most relevant chunks.
4.  **Targeted Edit**:
    *   The LLM is given **ONLY** the relevant sections + the instruction.
    *   It returns the updated text for just those sections, ensuring accuracy and low token usage.
5.  **Final Response**:
    *   If `autoProcess: true`, the edit is returned immediately.
    *   Otherwise, the transcription is returned for client-side preview.

## Observability & Debugging
To monitor the agent's internal reasoning and tool calls in real-time:

### 1. LangSmith (Recommended)
Add the following to your `.env` to see every trace:
```bash
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_key
LANGCHAIN_PROJECT=health-tech-backend
```

### 2. LangGraph Studio
Use the LangGraph Studio app to visualize the graph layout and step through transactions node-by-node.
