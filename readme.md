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
