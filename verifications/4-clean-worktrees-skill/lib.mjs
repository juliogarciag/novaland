import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
export const PROOF = path.join(HERE, 'proof');

export function summarize(results) {
  const failed = results.filter((r) => !r.pass);
  console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} OF ${results.length} CHECKS FAILED`);
  return failed.length === 0;
}

/** Writes proof with machine-specific paths replaced, so the file is stable across machines. */
export function writeProof(name, text, replacements = {}) {
  mkdirSync(PROOF, { recursive: true });
  let out = text.split(REPO).join('<repo>');
  for (const [from, to] of Object.entries(replacements)) out = out.split(from).join(to);
  writeFileSync(path.join(PROOF, name), out);
}
