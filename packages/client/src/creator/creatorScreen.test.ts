import { MAX_NAME_CHARACTERS, type CharacterNameProblem } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { __testing__ } from './creatorScreen';

describe('what the creator says about a name the sim refuses', () => {
  it('has a sentence for every problem, and the limit in the one about length', () => {
    const problems: CharacterNameProblem[] = ['not-text', 'empty', 'too-long', 'forbidden-character'];
    const sentences = problems.map((problem) => describeNameProblem(problem));
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(10);
    expect(describeNameProblem('empty')).toBe('Your character needs a name.');
    expect(describeNameProblem('too-long')).toContain(`${MAX_NAME_CHARACTERS} characters`);
    expect(new Set(sentences.slice(1)).size).toBe(3);
  });
});

// ---- Helpers ----

const { describeNameProblem } = __testing__;
