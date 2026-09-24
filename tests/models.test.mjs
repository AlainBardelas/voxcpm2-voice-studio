import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceExcerpt, checkOutput, resultWarning} from '../site/models.mjs';
import {pcm16Wav} from '../site/audio.mjs';

test('a long recording sends only the selected three-minute excerpt', () => {
  const rate = 16000;
  const samples = new Float32Array(1200 * rate);
  samples[60 * rate] = 0.25;
  const excerpt = referenceExcerpt({samples, sampleRate:rate, duration:1200}, 60, 240);
  assert.equal(excerpt.duration, 180);
  assert.equal(excerpt.samples[0], 0.25);
  assert.equal(new DataView(pcm16Wav(excerpt.samples, rate)).getUint32(40, true), 180 * rate * 2);
  for (const range of [[-1, 30], [0, 181], [1190, 1201], [0, 0.5], [NaN, 10]]) {
    assert.throws(() => referenceExcerpt({samples, sampleRate:rate, duration:1200}, ...range));
  }
});

test('a Vox result cannot be displayed as Qwen during an old worker rollout', () => {
  const vox = {format:'flac', sample_rate:48000, audio_base64:'abc'};
  assert.equal(checkOutput(vox, 'voxcpm2').sampleRate, 48000);
  assert.throws(() => checkOutput(vox, 'qwen3-tts'), /different model/);
  const qwen = {...vox, model:'qwen3-tts', sample_rate:24000};
  assert.equal(checkOutput(qwen, 'qwen3-tts').sampleRate, 24000);
  assert.throws(() => checkOutput({...qwen, sample_rate:48000}, 'qwen3-tts'), /invalid audio/);
});

test('flags the observed long-reference duration outlier without rejecting normal speech', () => {
  const text = 'Hola, esta es una prueba para comparar las dos voces.';
  assert.match(resultWarning(99.8, text), /extra or repeated speech/);
  assert.equal(resultWarning(3.2, text), '');
  assert.equal(resultWarning(100, 'Una frase para leer. '.repeat(50)), '');
  assert.equal(resultWarning(100, ''), '');
});
