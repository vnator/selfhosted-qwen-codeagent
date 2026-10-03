function stripSlash(url) { return url.replace(/\/+$/, ''); }
async function postJSON(fetchImpl, url, method, body, headers = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    const error = new Error(`HTTP ${response.status} at ${new URL(url).pathname}: ${details}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function createEmbedder({
  baseURL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model = process.env.EMBEDDING_MODEL || 'nomic-embed-text:latest',
  batchSize = 16,
  fetchImpl = fetch,
} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('Invalid embedding batch size');
  return {
    model,
    async embed(texts) {
      const results = [];
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        const data = await postJSON(fetchImpl, `${stripSlash(baseURL)}/api/embed`, 'POST', {
          model, input: batch, truncate: false,
        });
        if (!Array.isArray(data.embeddings) || data.embeddings.length !== batch.length) {
          throw new Error('Ollama returned an unexpected number of embedding vectors');
        }
        for (const vector of data.embeddings) {
          if (!Array.isArray(vector) || vector.length === 0 || !vector.every(Number.isFinite)) {
            throw new Error('Ollama returned an invalid embedding vector');
          }
          results.push(vector);
        }
      }
      if (results.length && results.some((vector) => vector.length !== results[0].length)) {
        throw new Error('Ollama returned vectors with inconsistent dimensions');
      }
      return results;
    },
  };
}

export function createQdrant({
  baseURL = process.env.QDRANT_URL || 'http://127.0.0.1:6333',
  collection = process.env.QDRANT_COLLECTION || 'code_chunks_node_v1',
  apiKey = process.env.QDRANT_API_KEY,
  fetchImpl = fetch,
} = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(collection)) throw new Error('Invalid Qdrant collection name');
  const prefix = `${stripSlash(baseURL)}/collections/${encodeURIComponent(collection)}`;
  const headers = apiKey ? { 'api-key': apiKey } : {};
  const call = (path, method, body) => postJSON(fetchImpl, `${prefix}${path}`, method, body, headers);
  return {
    collection,
    async info() {
      try { return (await call('', 'GET')).result; }
      catch (error) { if (error.status === 404) return null; throw error; }
    },
    async ensure(size) {
      const metadata = await this.info();
      if (!metadata) {
        await call('', 'PUT', { vectors: { size, distance: 'Cosine' } });
        return;
      }
      const vectors = metadata.config?.params?.vectors;
      if (!vectors || vectors.size !== size || String(vectors.distance).toLowerCase() !== 'cosine') {
        throw new Error(`Qdrant collection ${collection} has incompatible vector configuration; do not mix embedding models`);
      }
    },
    async existing(repositoryId) {
      if (!(await this.info())) return [];
      let offset;
      const all = [];
      do {
        const request = {
          limit: 256,
          with_payload: ['repository_id', 'relative_path', 'embedding_model'],
          with_vector: false,
          filter: { must: [{ key: 'repository_id', match: { value: repositoryId } }] },
        };
        if (offset != null) request.offset = offset;
        const { result } = await call('/points/scroll', 'POST', request);
        if (!result || !Array.isArray(result.points)) throw new Error('Invalid Qdrant scroll response');
        all.push(...result.points);
        offset = result.next_page_offset;
      } while (offset != null);
      return all;
    },
    async upsert(points) {
      for (let i = 0; i < points.length; i += 64) {
        await call('/points?wait=true', 'PUT', { points: points.slice(i, i + 64) });
      }
    },
    async queryPoints({ vector, repositoryId, embeddingModel, limit = 24 }) {
      if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) throw new Error('Invalid query vector');
      if (typeof repositoryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(repositoryId)) throw new Error('Invalid repository ID');
      if (typeof embeddingModel !== 'string' || !embeddingModel) throw new Error('Embedding model is required');
      if (!Number.isInteger(limit) || limit < 1 || limit > 48) throw new Error('Query limit must be 1–48');
      if (!(await this.info())) throw new Error(`Qdrant collection ${collection} does not exist; run ingestion first`);
      const { result } = await call('/points/query', 'POST', {
        query: vector,
        filter: { must: [
          { key: 'repository_id', match: { value: repositoryId } },
          { key: 'embedding_model', match: { value: embeddingModel } },
        ] },
        limit,
        with_payload: ['repository_id', 'relative_path', 'start_line', 'end_line', 'source_hash', 'chunk_hash', 'embedding_model', 'content'],
        with_vector: false,
      });
      if (!result || !Array.isArray(result.points)) throw new Error('Invalid Qdrant query response');
      return result.points;
    },
    async deleteIds(ids) {
      for (let i = 0; i < ids.length; i += 256) {
        await call('/points/delete?wait=true', 'POST', { points: ids.slice(i, i + 256) });
      }
    },
  };
}
