export const MODELS = Object.freeze({
  'qwen3-tts': {label:'Qwen3-TTS · 1.7B Base', sampleRate:24000},
  'voxcpm2': {label:'VoxCPM2', sampleRate:48000},
});
export const MAX_REFERENCE_SECONDS = 180;
export const JOB_LIFETIME_MS = 960000;

export function resultWarning(duration, text) {
  if (!text?.trim()) return '';
  const words = text.trim().split(/\s+/).length;
  const generousDuration = Math.max(30, words * 2 + 10, text.length / 5 + 10);
  return duration > generousDuration
    ? 'This result is unusually long for the text and may contain extra or repeated speech. Listen before using it, and try a shorter or different reference excerpt.'
    : '';
}

export function referenceExcerpt(decoded, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > decoded.duration + 0.001 || end - start < 1 || end - start > MAX_REFERENCE_SECONDS + 0.001) {
    throw new Error('Choose an excerpt between 1 second and 3 minutes, within your recording.');
  }
  const samples = decoded.samples.slice(Math.round(start * decoded.sampleRate), Math.round(end * decoded.sampleRate));
  if (samples.length > MAX_REFERENCE_SECONDS * decoded.sampleRate) throw new Error('The selected excerpt is longer than 3 minutes.');
  return {samples, sampleRate:decoded.sampleRate, duration:samples.length / decoded.sampleRate};
}

export function checkOutput(output, expectedModel) {
  if (output?.error) throw new Error(output.error);
  const actualModel = output?.model || 'voxcpm2';
  if (!MODELS[expectedModel] || actualModel !== expectedModel) throw new Error('The worker returned a different model. Reload the studio after the worker update finishes.');
  if (output.format !== 'flac' || output.sample_rate !== MODELS[expectedModel].sampleRate || typeof output.audio_base64 !== 'string' || output.audio_base64.length > 9_400_000) {
    throw new Error('The worker returned an invalid audio result.');
  }
  return MODELS[expectedModel];
}
