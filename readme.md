# 🤖 Local AI Coding Agent

This project implements a self-hosted, autonomous coding assistant (Agentic AI) focused on high performance and low hardware costs. The architecture is fully containerized via Docker, utilizing inference engines and vector databases optimized to extract maximum performance from local machines.

## 📋 Prerequisites

Before starting the environment, ensure you have the following installed and configured on your host machine:

*   **Docker:** Engine installed and running.
*   **Docker Compose:** Version v2.0 or higher.
*   **NVIDIA Container Toolkit:** Required if you are using an NVIDIA GPU. This allows the Ollama container to access your GPU hardware via CUDA.
*   **Hardware Requirements:** At least 8GB of RAM for the 7B model, or 16GB+ of RAM/VRAM for the 14B model.

## 🏗️ System Architecture

The stack is designed to prioritize low RAM consumption and processing scalability:

*   **Inference Engine (Ollama / llama.cpp):** Manages dynamic model loading between VRAM (via NVIDIA CUDA) and system RAM. Enables the execution of heavily quantized 4-bit models (GGUF).
*   **Base LLM (Qwen 2.5 Coder):** State-of-the-art open-source language model focused on code generation, refactoring, and software architecture comprehension.
*   **Vector DB (Qdrant):** A vector database built in Rust, chosen for its minimal memory footprint compared to relational databases. It powers the RAG (Retrieval-Augmented Generation) system.
*   **Orchestrator (Open WebUI):** The graphical interface and RAG pipeline manager, connecting the user to the inference engine and vector database.

## 📂 Project Structure

The directory organization follows a clear separation of concerns for integrating and expanding the agent's capabilities:

```text
.
├── docker-compose.yml   # Infrastructure declaration (Ollama, Qdrant, Open WebUI)
├── /adapters            # Integration scripts and binaries for third-party tools (Neovim, VSCode, GitHub, GitLab, etc.)
├── /config              # Configuration and parameterization files for dependencies and environment scripts
└── /skills              # Behavioral definitions, system prompts, and logical interaction layers for the agent
```

### Directory Breakdown

*   **`adapters/`**: The communication layer. Contains the scripts, plugins, or webhooks needed to plug the coding agent directly into your workflow, whether reading buffers directly from Neovim/VSCode or analyzing Pull Requests on GitHub/GitLab.
*   **`config/`**: The parameterization layer. Centralizes environment variables, llama.cpp tuning configurations (such as context limits and GPU usage), and Qdrant persistence settings.
*   **`skills/`**: The domain intelligence layer. Stores the agent's behavioral definitions. This includes specific architectural instructions, desired design patterns, and decision workflows for long-term interactions.

## 🚀 Project Startup

### 1. Boot the Infrastructure
Run the following command in the root of the project to initialize the containers in the background:

```bash
docker compose up -d
```

### 2. Download the LLM
Once the containers are running, access the Ollama shell to download and compile the Qwen 2.5 Coder model.

*For machines with 8GB to 16GB of RAM (7B version):*
```bash
docker exec -it agent_ollama ollama run qwen2.5-coder:7b
```
*(If you have 16GB+ and dedicated VRAM, you can change the tag to `14b` for greater algorithmic complexity).*

### 3. Access the UI
After the model finishes downloading, access the agent's interface through your web browser:

🔗 **URL:** `http://localhost:3000`

1. Create a local administrator account (offline).
2. In the top menu, select the `qwen2.5-coder` model.
3. Navigate to **Settings > Documents (RAG)** and ensure the vector engine is correctly connected to Qdrant.

---
**RAG Note:** You can drag and drop documentation, error logs, or entire codebases directly into the chat. The orchestrator will handle the chunking, vectorization via the embedding model, and storage in Qdrant seamlessly.

### 4. Config Extenal Frameworks
Configuration about the LLM usage with a couple of distincts Frameworks.

#### 4.1 🔌 VSCode Integration (Continue.dev)
------------------------------------

To integrate the local AI agent directly into your editor, we use **Continue**, an open-source extension that serves as a high-performance alternative to GitHub Copilot.

##### a\. Installation and Model Setup

1.  Install the **Continue** extension from the VSCode Marketplace.

2.  Before configuring, ensure the required helper models are downloaded in your local Ollama container:

    Bash

    ```
    docker exec -it agent_ollama ollama run qwen2.5-coder:1.5b-base  # For fast autocomplete
    docker exec -it agent_ollama ollama run nomic-embed-text:latest  # For codebase vectorization

    ```

##### b\. Configuration (`config.yaml`)

1.  Open the Continue sidebar in VSCode.

2.  Click the **gear icon** (bottom right of the sidebar) to open your `config.yaml` file (located at `~/.continue/config.yaml`).

3.  Replace the contents with the following optimized configuration. This delegates heavy tasks (chat/refactoring) to the 7B model while reserving the lightning-fast 1.5B model strictly for typing autocomplete:

YAML

```
name: Main Config
version: 1.0.0
schema: v1

# Autocomplete tuning for local hardware performance
tabAutocompleteOptions:
  useCopyBuffer: true
  useSuffix: true
  maxPromptTokens: 1024
  debounceDelay: 400 # Prevents CPU spiking by waiting 400ms after you stop typing
  multilineCompletions: always

# Enables RAG and deep file reading
contextProviders:
  - name: codebase
    params:
      nRetrieve: 20
      nFinal: 5
  - name: folder
  - name: file

models:
  - name: Qwen 2.5 Coder 7B
    provider: ollama
    model: qwen2.5-coder:7b
    apiBase: http://localhost:11434
    roles:
      - chat
      - edit
      - apply
  - name: Qwen2.5-Coder 1.5B
    provider: ollama
    model: qwen2.5-coder:1.5b-base
    apiBase: http://localhost:11434
    roles:
      - autocomplete
  - name: Nomic Embed
    provider: ollama
    model: nomic-embed-text:latest
    roles:
      - embed

```

##### c\. Usage & Shortcuts

-   **Autocomplete:** Just start typing. The 1.5B model will suggest ghost text based on the 400ms debounce delay. Press `Tab` to accept.

-   **Chat (`Ctrl+L` / `Cmd+L`):** Select any code snippet and press this shortcut to send it to the Continue sidebar for explanation or refactoring.

-   **Inline Edit (`Ctrl+I` / `Cmd+I`):** Select code and press this shortcut to open a floating prompt. The agent will rewrite the code directly in your file with a diff view.

-   **Context Injection:** In the chat input, type `@` to attach context:

    -   `@Files`: Selects a specific file.

    -   `@Codebase`: Scans and vectorizes your entire open project to answer architectural questions based on the Nomic Embed model.


#### 4.2 🖱️ Cursor IDE Integration (Native Agent)

Cursor IDE possesses native agentic features (Chat, Composer, and Inline Edit) that can be seamlessly routed to your containerized Ollama infrastructure by leveraging Ollama's OpenAI-compatible API layer.

##### a. Override the OpenAI API Endpoint

Since the `agent_ollama` container exposes port `11434` to the host machine, you can redirect all AI requests from Cursor to your local inference engine.

1.  Open Cursor and navigate to **Settings > Models** (`Ctrl + Shift + J` or `Cmd + Shift + J`).

2.  Scroll down to the **OpenAI API Key** section.

3.  Enable the **Override OpenAI Base URL** toggle.

4.  Set the **Base URL** to exactly: `http://localhost:11434/v1` *(The `/v1` path is mandatory for the compatibility layer to work).*

5.  Insert any dummy text into the **API Key** field (e.g., `sk-local-ollama`), as the local container does not require authentication.

6.  Click **Verify**.

##### b. Register the Local Model

Cursor needs to match the exact model tag stored in your Docker registry to route prompts correctly.

1.  At the top of the **Settings > Models** page, locate the list of active models.

2.  Click **Add model**.

3.  Type the exact model identifier you downloaded earlier: `qwen2.5-coder:7b` (or `14b` if applicable).

4.  Press `Enter` to register it.

5.  **Crucial Step:** Disable the toggles for all default cloud models (such as `gpt-4o`, `claude-3.5-sonnet`, `cursor-small`). Ensure **only** your local `qwen2.5-coder:7b` is toggled on. This forces all agentic shortcuts (`Ctrl+L`, `Ctrl+I`) to utilize your local hardware.

##### c. Privacy and Codebase Context (RAG)

Cursor handles codebase vectorization internally rather than relying on the Qdrant container. To ensure maximum privacy and prevent code chunks from being sent to external servers for embedding:

1.  Navigate to **Settings > Features > Codebase Indexing**.

2.  Enable **Privacy Mode**.

3.  *Note:* When fully offline, Cursor will fall back to local lexical search (keyword matching) instead of cloud-based semantic vector search. You can still use the `@Files` command in the Cursor Chat to manually inject specific files directly into the 7B model's context window.
