import os
import requests
import subprocess
from tqdm import tqdm

# Configurações
ORG_NAME = "rust-lang"
BASE_DIR = "./knowledge_base"
# Cria uma subpasta para não misturar com seus outros códigos
TARGET_DIR = os.path.join(BASE_DIR, ORG_NAME)

# Se você tomar Rate Limit (limite de requisições) da API do GitHub, 
# cole um Personal Access Token aqui.
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

headers = {"Accept": "application/vnd.github.v3+json"}
if GITHUB_TOKEN:
    headers["Authorization"] = f"token {GITHUB_TOKEN}"

def get_total_repos():
    """Busca o número total de repositórios públicos da org para calibrar a barra de progresso."""
    url = f"https://api.github.com/orgs/{ORG_NAME}"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json().get("public_repos", 0)

def fetch_and_clone():
    os.makedirs(TARGET_DIR, exist_ok=True)
    
    print(f"Buscando informações da organização '{ORG_NAME}' no GitHub...")
    total_repos = get_total_repos()
    print(f"Total de repositórios encontrados: {total_repos}")
    
    repos_to_clone = []
    page = 1
    per_page = 100 # Máximo permitido pela API do GitHub por página
    
    # Paginação para buscar todos os links de repositórios
    while True:
        url = f"https://api.github.com/orgs/{ORG_NAME}/repos?type=public&per_page={per_page}&page={page}"
        response = requests.get(url, headers=headers)
        
        if response.status_code == 403 and "rate limit" in response.text.lower():
            print("\n[ERRO] Limite de requisições anônimas do GitHub atingido! Use um GITHUB_TOKEN.")
            break
            
        response.raise_for_status()
        repos = response.json()
        
        if not repos: # Fim das páginas
            break
            
        repos_to_clone.extend(repos)
        page += 1

    print("\nIniciando clonagem (Depth 1 para economizar espaço e tempo)...")
    
    # Barra de progresso visual
    with tqdm(total=len(repos_to_clone), desc="Baixando Repos") as pbar:
        for repo in repos_to_clone:
            repo_name = repo["name"]
            clone_url = repo["clone_url"]
            repo_path = os.path.join(TARGET_DIR, repo_name)
            
            # LÓGICA DE RETOMADA (RESUME)
            # Se a pasta já existe e tem algo dentro, ele pula o clone
            if os.path.exists(repo_path) and os.listdir(repo_path):
                pbar.set_postfix_str(f"Pulando {repo_name} (já baixado)")
                pbar.update(1)
                continue
                
            pbar.set_postfix_str(f"Clonando {repo_name}...")
            
            try:
                # Chama o git clone silenciosamente
                subprocess.run(
                    ["git", "clone", "--depth", "1", clone_url, repo_path],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True
                )
            except subprocess.CalledProcessError:
                print(f"\n[AVISO] Falha ao clonar o repositório {repo_name}")
                
            pbar.update(1)

if __name__ == "__main__":
    fetch_and_clone()
    print("\n✅ Processo concluído com sucesso!")
