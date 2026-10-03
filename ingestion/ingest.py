import os
import requests
import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
from langchain_text_splitters import RecursiveCharacterTextSplitter, Language

# Configurações
OLLAMA_URL = "http://localhost:11434/api/embeddings"
QDRANT_URL = "http://localhost:6333"
COLLECTION_NAME = "code_chunks"
KB_DIR = "./knowledge_base"

# Inicializa o cliente Qdrant
qdrant = QdrantClient(url=QDRANT_URL)

def get_embedding(text):
    """Chama o Ollama local para gerar o embedding (768 dimensões)"""
    payload = {
        "model": "nomic-embed-text:latest",
        "prompt": text
    }
    response = requests.post(OLLAMA_URL, json=payload)
    response.raise_for_status()
    return response.json()["embedding"]

def process_and_ingest():
    for root, _, files in os.walk(KB_DIR):
        for file in files:
            file_path = os.path.join(root, file)
            ext = file.split('.')[-1].lower()
            
            # Define o fatiador baseado na linguagem
            if ext == 'rs':
                splitter = RecursiveCharacterTextSplitter.from_language(
                    language=Language.RUST, chunk_size=800, chunk_overlap=100
                )
            elif ext in ['c', 'h']:
                splitter = RecursiveCharacterTextSplitter.from_language(
                    language=Language.C, chunk_size=800, chunk_overlap=100
                )
            else:
                continue # Ignora outros arquivos por enquanto

            print(f"Processando: {file_path}")
            
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

            chunks = splitter.create_documents([content])
            
            points = []
            for chunk in chunks:
                chunk_text = chunk.page_content
                vector = get_embedding(chunk_text)
                
                # Prepara o ponto para o Qdrant com metadados
                point_id = str(uuid.uuid4())
                points.append(
                    PointStruct(
                        id=point_id,
                        vector=vector,
                        payload={
                            "source": file_path,
                            "language": "rust" if ext == 'rs' else "c",
                            "content": chunk_text
                        }
                    )
                )
            
            # Insere no banco em lotes
            if points:
                qdrant.upsert(
                    collection_name=COLLECTION_NAME,
                    points=points
                )
                print(f"✅ {len(points)} chunks inseridos de {file}")

if __name__ == "__main__":
    print("Iniciando pipeline de ingestão...")
    process_and_ingest()
    print("Concluído!")
