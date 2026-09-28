import assert from 'node:assert/strict';
import {splitIpadSpeech,MAX_IPAD_SPEECH_CHARS,MAX_IPAD_SENTENCES_PER_CLIP} from '../lib/ipad-speech.ts';

const text='Dr. Silva avaliou a paciente. A pressão foi 120/80 mmHg. O exame mostrou melhora! Próxima conduta?';
assert.deepEqual(splitIpadSpeech(text),[
 'Dr. Silva avaliou a paciente. A pressão foi 120/80 mmHg. O exame mostrou melhora! Próxima conduta?'
]);

const six='Um. Dois. Três. Quatro. Cinco. Seis.';
assert.deepEqual(splitIpadSpeech(six),[six]);

const seven='Um. Dois. Três. Quatro. Cinco. Seis. Sete.';
assert.deepEqual(splitIpadSpeech(seven),[
 'Um. Dois. Três. Quatro. Cinco. Seis.',
 'Sete.'
]);

assert.equal(MAX_IPAD_SENTENCES_PER_CLIP,6);
assert.deepEqual(splitIpadSpeech('Dose 20 mg. ao dia. Depois continuar.'),[
 'Dose 20 mg. ao dia. Depois continuar.'
]);

const long='Uma frase extensa com todas as palavras preservadas '.repeat(125).trim()+'.';
const chunks=splitIpadSpeech(long);
assert.ok(chunks.length>1);
assert.ok(chunks.every(chunk=>chunk.length<=MAX_IPAD_SPEECH_CHARS));
assert.equal(chunks.join(' '),long);

const many=Array.from({length:18},(_,i)=>'Frase '+(i+1)+'.').join(' ');
const grouped=splitIpadSpeech(many);
assert.equal(grouped.length,3);
assert.ok(grouped.every(chunk=>chunk.split('.').filter(Boolean).length<=MAX_IPAD_SENTENCES_PER_CLIP));
assert.equal(grouped.join(' '),many);

assert.equal(splitIpadSpeech('  Primeira frase.   Segunda frase. ').join(' '),'Primeira frase. Segunda frase.');
console.log('PASS: iPad speech groups up to six sentences per clip without losing text.');
