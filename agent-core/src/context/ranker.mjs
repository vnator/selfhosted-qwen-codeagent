// Deterministic hybrid re-ranking. Apply ONLY to already-authorized, current
// Qdrant hits: this module is presentation logic, not an access-control layer.
const CODE_FILE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|rs|c|cc|cpp|cxx|h|hpp|hxx|go|java|py|rb|sh|lua|zig|ex|exs)$/i;
const IMPLEMENTATION_QUESTION = /\b(?:implement(?:ed|ation|ing)?|function|method|handler|class|defined|definition|source\s+code|logic|mechanism|call\s*site)\b/i;
const STOP = new Set([
  'the', 'and', 'for', 'are', 'with', 'this', 'that', 'from', 'which',
  'where', 'what', 'how', 'does', 'please', 'cite', 'relevant', 'files',
  'file', 'line', 'lines', 'ranges', 'range', 'show', 'find', 'give', 'its',
  'into', 'within', 'about', 'using', 'used', 'code', 'there', 'here',
]);
function terms(text) {
  return [...new Set(
    (text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]*/g) || [])
      .filter((term) => term.length >= 3 && !STOP.has(term)),
  )];
}

function lexicalScore(entry, queryTerms) {
  if (!queryTerms.length) return { score: 0, matched: 0 };
  const pathTerms = terms(entry.relativePath);
  const textTerms = terms(entry.content);
  let total = 0;
  let matched = 0;
  for (const token of queryTerms) {
    // Limited plural / inflection matching; do not execute user-supplied regexes.
    const similar = (word) => word === token ||
      (word.length >= 5 && token.length >= 5 && word.startsWith(token.slice(0, 5)) && token.startsWith(word.slice(0, 5)));
    if (pathTerms.some(similar)) { total += 1.5; matched++; }
    else if (textTerms.some(similar)) { total += 1; matched++; }
  }
  return { score: total / queryTerms.length, matched };
}

function largelyOverlaps(entry, chosen) {
  if (entry.relativePath !== chosen.relativePath) return false;
  const overlap = Math.min(entry.endLine, chosen.endLine) - Math.max(entry.startLine, chosen.startLine) + 1;
  if (overlap <= 0) return false;
  const smallest = Math.min(entry.endLine - entry.startLine + 1, chosen.endLine - chosen.startLine + 1);
  return overlap / smallest >= 0.6;
}

/** Balance semantic similarity, literal matches and file diversity. */
export function selectContextSources(entries, question, { limit, maxContextBytes }) {
  const queryTerms = terms(question);
  const implementation = IMPLEMENTATION_QUESTION.test(question);
  const ranked = entries.map((entry) => {
    const lexical = lexicalScore(entry, queryTerms);
    const code = CODE_FILE.test(entry.relativePath);
    return {
      ...entry,
      _code: code,
      _matched: lexical.matched,
      _rank: entry.score + Math.min(0.4, lexical.score * 0.25) + (implementation && code ? 0.1 : 0),
    };
  }).sort((a, b) => b._rank - a._rank || a.relativePath.localeCompare(b.relativePath) || a.startLine - b.startLine);

  const selected = [];
  const counts = new Map();
  let usedBytes = 0;
  function include(candidate, cap) {
    if (selected.length >= limit || (counts.get(candidate.relativePath) || 0) >= cap) return false;
    if (selected.some((source) => largelyOverlaps(candidate, source))) return false;
    const bytes = Buffer.byteLength(`SOURCE: ${candidate.relativePath}:${candidate.startLine}-${candidate.endLine}\n${candidate.content}\n`, 'utf8');
    if (usedBytes + bytes > maxContextBytes) return false;
    const { _code, _matched, _rank, ...source } = candidate;
    selected.push(source);
    counts.set(candidate.relativePath, (counts.get(candidate.relativePath) || 0) + 1);
    usedBytes += bytes;
    return true;
  }

  // On implementation questions, reserve up to half the context for relevant
  // source-code hits so six highly similar docs chunks cannot hide the code.
  if (implementation) {
    const desired = Math.ceil(limit / 2);
    for (const candidate of ranked) {
      if (selected.length >= desired) break;
      if (candidate._code && candidate._matched > 0) include(candidate, 2);
    }
  }
  // Give distinct files room before admitting a third chunk from one file.
  for (const candidate of ranked) include(candidate, 2);
  if (selected.length < limit) {
    for (const candidate of ranked) include(candidate, Infinity);
  }
  return selected;
}
