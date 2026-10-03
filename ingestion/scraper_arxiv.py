import os
import arxiv
from tqdm import tqdm

# Configurações
BASE_DIR = "./knowledge_base"
TARGET_DIR = os.path.join(BASE_DIR, "papers_quant_math")

# Aqui você define suas queries de busca.
# Exemplos: "quantitative finance", "mathematical modeling", "rust programming"
# Você também pode usar as categorias oficiais, ex: "cat:q-fin.CP" (Computational Finance)
QUERIES = [
    "quantitative finance algorithm",
    "stochastic calculus monte carlo",
    "rust language performance"
]

MAX_RESULTS_PER_QUERY = 10 # Quantos papers baixar por termo para testar

def fetch_papers():
    os.makedirs(TARGET_DIR, exist_ok=True)
    
    # Cliente do ArXiv
    client = arxiv.Client(
        page_size=10,
        delay_seconds=3, # Respeita o rate limit da API do ArXiv
        num_retries=3
    )

    for query in QUERIES:
        print(f"\nBuscando papers para a query: '{query}'")
        
        search = arxiv.Search(
            query=query,
            max_results=MAX_RESULTS_PER_QUERY,
            sort_by=arxiv.SortCriterion.Relevance
        )

        results = list(client.results(search))
        
        if not results:
            print("Nenhum resultado encontrado.")
            continue

        with tqdm(total=len(results), desc=f"Baixando PDFs") as pbar:
            for paper in results:
                # Cria um nome de arquivo limpo baseado no título
                safe_title = "".join([c for c in paper.title if c.isalpha() or c.isdigit() or c==' ']).rstrip()
                safe_title = safe_title.replace(" ", "_")[:50] # Limita o tamanho
                filename = f"{safe_title}.pdf"
                filepath = os.path.join(TARGET_DIR, filename)

                # LÓGICA DE RETOMADA: Pula se o PDF já existe
                if os.path.exists(filepath):
                    pbar.set_postfix_str(f"Pulando (já existe)")
                    pbar.update(1)
                    continue

                pbar.set_postfix_str(f"Baixando: {safe_title}")
                
                try:
                    # Faz o download do PDF
                    paper.download_pdf(dirpath=TARGET_DIR, filename=filename)
                except Exception as e:
                    print(f"\n[ERRO] Falha ao baixar {filename}: {e}")
                
                pbar.update(1)

if __name__ == "__main__":
    fetch_papers()
    print("\n✅ Extração acadêmica concluída!")
