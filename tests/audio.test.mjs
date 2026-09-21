import test from 'node:test';
import assert from 'node:assert/strict';
import {pcm16Wav, toBase64, fromBase64} from '../site/audio.mjs';

test('WAV encodes the declared rate, length and clipped PCM values', () => {
  const data = pcm16Wav(new Float32Array([-2, -1, 0, 0.5, 1, 2]), 16000);
  const view = new DataView(data);
  assert.equal(new TextDecoder().decode(data.slice(0,4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), -32768);
  assert.equal(view.getInt16(48, true), 0);
  assert.equal(view.getInt16(50, true), 16384);
  assert.equal(view.getInt16(52, true), 32767);
  assert.equal(view.getInt16(54, true), 32767);
});

test('base64 transport preserves a full 60-second reference', () => {
  const values = new Float32Array(60 * 16000);
  for (let i = 0; i < values.length; i++) values[i] = Math.sin(i / 100);
  const raw = pcm16Wav(values, 16000);
  const encoded = toBase64(raw);
  assert.ok(encoded.length < 10_000_000);
  assert.deepEqual(new Uint8Array(fromBase64(encoded)), new Uint8Array(raw));
});
