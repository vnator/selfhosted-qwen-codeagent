/**
 * Preserve source-file layout independently from the LLM's envelope formatting.
 * This is not a generic formatter: it retains the original BOM, LF/CRLF style,
 * and exact trailing newline sequence. Reject mixed and CR-only newline files
 * rather than guessing and rewriting unrelated bytes.
 */
export function preserveFileLayout(original, proposed) {
  if (typeof original !== 'string' || typeof proposed !== 'string') {
    throw new TypeError('Original and proposed contents must be text');
  }
  if (proposed.includes('\0')) throw new Error('Binary replacement rejected');

  const withoutCrLf = original.replaceAll('\r\n', '');
  if (withoutCrLf.includes('\r')) throw new Error('CR-only or mixed line endings are not supported for EDIT');
  if (original.includes('\r\n') && withoutCrLf.includes('\n')) {
    throw new Error('Mixed LF/CRLF line endings are not supported for EDIT');
  }

  const crlf = original.includes('\r\n');
  const bom = original.startsWith('\uFEFF');
  const originalEnding = original.match(/(?:\r\n|\n)+$/)?.[0] ?? '';

  // The model may use a different line-ending style. Preserve the source's style.
  let body = proposed.replaceAll('\r\n', '\n');
  if (body.includes('\r')) throw new Error('CR-only or mixed replacement line endings rejected');
  body = body.replace(/^\uFEFF/, '').replace(/\n+$/, '');
  if (!body.trim()) throw new Error('Empty replacement rejected');
  if (crlf) body = body.replaceAll('\n', '\r\n');

  return (bom ? '\uFEFF' : '') + body + originalEnding;
}
