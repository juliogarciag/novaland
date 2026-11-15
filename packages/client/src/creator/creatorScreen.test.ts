import { MAX_NAME_CHARACTERS, type Character, type CharacterNameProblem } from '@novaland/sim';
import { describe, expect, it } from 'vitest';
import { __testing__, sameCharacter } from './creatorScreen';

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

describe('telling whether the creator changed anything', () => {
  it('calls two characters the same when the name and every colour match', () => {
    expect(sameCharacter(ADA, { name: 'Ada', look: { skin: 1, hair: 2, clothes: 3 } })).toBe(true);
  });

  it('calls them different when the name or any one colour differs', () => {
    expect(sameCharacter(ADA, { ...ADA, name: 'ada' })).toBe(false);
    expect(sameCharacter(ADA, { ...ADA, look: { ...ADA.look, skin: 0 } })).toBe(false);
    expect(sameCharacter(ADA, { ...ADA, look: { ...ADA.look, hair: 0 } })).toBe(false);
    expect(sameCharacter(ADA, { ...ADA, look: { ...ADA.look, clothes: 0 } })).toBe(false);
  });
});

// ---- Helpers ----

const ADA: Character = { name: 'Ada', look: { skin: 1, hair: 2, clothes: 3 } };


const { describeNameProblem } = __testing__;
