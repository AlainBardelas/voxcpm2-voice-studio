export function pcm16Wav(samples, sampleRate) {
  const data = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(data);
  const str = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true);
  }
  return data;
}

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}

export function fromBase64(value) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer;
}

export async function decodeMono(buffer, sampleRate) {
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const decoded = await context.decodeAudioData(buffer);
  const mono = new Float32Array(decoded.length);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const values = decoded.getChannelData(ch);
    for (let i = 0; i < mono.length; i++) mono[i] += values[i] / decoded.numberOfChannels;
  }
  return {samples: mono, sampleRate: decoded.sampleRate, duration: decoded.duration};
}
