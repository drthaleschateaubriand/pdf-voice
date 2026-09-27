import assert from 'node:assert/strict';
import {splitIpadSpeech,MAX_IPAD_SPEECH_CHARS} from '../lib/ipad-speech.ts';

const text='Dr. Silva avaliou a paciente. A pressão foi 120/80 mmHg. O exame mostrou melhora! Próxima conduta?';
assert.deepEqual(splitIpadSpeech(text),[
 'Dr. Silva avaliou a paciente.',
 'A pressão foi 120/80 mmHg.',
 'O exame mostrou melhora!',
 'Próxima conduta?'
]);
assert.deepEqual(splitIpadSpeech('A! B? Fim.'),['A!','B?','Fim.']);
const long='Uma frase extensa com todas as palavras preservadas '.repeat(125).trim()+'.';
const chunks=splitIpadSpeech(long);
assert.ok(chunks.length>1);
assert.ok(chunks.every(chunk=>chunk.length<=MAX_IPAD_SPEECH_CHARS));
assert.equal(chunks.join(' '),long);
assert.equal(splitIpadSpeech('  Primeira frase.   Segunda frase. ').join(' '),'Primeira frase. Segunda frase.');
console.log('PASS: iPad speech keeps every sentence and splits long text without loss.');
