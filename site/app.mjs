import {pcm16Wav, toBase64, fromBase64, decodeMono} from './audio.mjs';

const $ = id => document.getElementById(id);
let key = '', endpoint = '', jobId = '', referenceUrl = '', resultUrl = '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const busy = value => { $('generate').disabled = value; $('cancel').hidden = !value || !jobId; $('logout').disabled = value; };
const savedJobKey = () => `voxcpm-job-${endpoint}`;

async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.runpod.ai/v2/${endpoint}/${path}`, {
    method, headers: {Authorization: `Bearer ${key}`, ...(body ? {'Content-Type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000), cache: 'no-store', credentials: 'omit',
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('The access key was rejected. Lock the studio and check your key.');
    if (response.status === 404) throw new Error('The endpoint or job was not found. This job may have expired.');
    throw new Error(`Runpod returned an error (${response.status}). Please try again later.`);
  }
  return response.json();
}

function rememberJob(id, submitted) {
  try { sessionStorage.setItem(savedJobKey(), JSON.stringify({id, submitted})); } catch {}
}
function forgetJob() { try { sessionStorage.removeItem(savedJobKey()); } catch {} }

async function showResult(output, executionTime, delayTime) {
  if (output?.error) throw new Error(output.error);
  if (!output || output.format !== 'flac' || output.sample_rate !== 48000 || typeof output.audio_base64 !== 'string' || output.audio_base64.length > 9_400_000) throw new Error('The worker returned an invalid result.');
  const decoded = await decodeMono(fromBase64(output.audio_base64), 48000);
  const wav = pcm16Wav(decoded.samples, decoded.sampleRate);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(new Blob([wav], {type:'audio/wav'}));
  $('result-player').src = resultUrl; $('result-player').hidden = false;
  $('download').href = resultUrl; $('download').download = `voice-${new Date().toISOString().replaceAll(':','-')}.wav`; $('download').hidden = false;
  $('result-hint').textContent = 'Ready. Listen to the accent and pronunciation, then save your WAV.';
  $('result-details').textContent = `${decoded.duration.toFixed(1)} seconds · ${decoded.sampleRate.toLocaleString()} Hz · Generation ${(Number(executionTime || 0) / 1000).toFixed(1)}s · Queue/startup wait ${(Number(delayTime || 0) / 1000).toFixed(1)}s`;
}

async function poll(id, submitted) {
  jobId = id; busy(true); let failures = 0;
  try {
    while (jobId === id) {
      if (Date.now() - submitted > 660000) throw new Error('The job has exceeded its time limit. Check your Runpod endpoint before submitting another generation.');
      let result;
      try { result = await api(`status/${encodeURIComponent(id)}`); failures = 0; }
      catch (error) {
        failures++;
        if (failures >= 6) throw new Error(`${error.message} Your submitted job may still finish; reload and unlock this tab to reconnect.`);
        status('Connection interrupted. Reconnecting to the existing job without submitting another one…');
        await sleep(5000); continue;
      }
      if (jobId !== id) return;
      const elapsed = Math.round((Date.now() - submitted) / 1000);
      if (result.status === 'COMPLETED') {
        if (result.output?.error) { forgetJob(); throw new Error(result.output.error); }
        await showResult(result.output, result.executionTime, result.delayTime); forgetJob();
        status('Your audio is ready. The GPU will shut down automatically after it becomes idle.'); return;
      }
      if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
        forgetJob(); throw new Error(result.error || `Generation ${result.status.toLowerCase().replace('_', ' ')}. You can try again.`);
      }
      status(result.status === 'IN_PROGRESS'
        ? `Generating your voice… ${elapsed}s elapsed.`
        : `Waiting for a GPU to start… ${elapsed}s elapsed. This can take longer after inactivity. Your request is already queued.`);
      await sleep(3000);
    }
  } catch (error) { status(error.message, true); }
  finally { if (jobId === id) { jobId = ''; busy(false); } }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-button').disabled = true;
  try {
    if (!/^[a-zA-Z0-9]{3,64}$/.test(endpoint)) throw new Error('The studio is being configured. Please check back after setup is complete.');
    key = $('access-key').value.trim();
    if (key.length < 16) throw new Error('Enter your complete private access key.');
    await api('health');
    $('access-key').value = ''; $('login-panel').hidden = true; $('studio').hidden = false; $('logout').hidden = false; status('Studio unlocked. No GPU is started until you submit a generation.');
    try {
      const saved = JSON.parse(sessionStorage.getItem(savedJobKey()) || 'null');
      if (saved && typeof saved.id === 'string' && Date.now() - saved.submitted < 660000) void poll(saved.id, saved.submitted);
    } catch {}
  } catch (error) { key = ''; status(error.message, true); }
  finally { $('login-button').disabled = false; }
});

$('logout').addEventListener('click', () => { key = ''; $('studio').hidden = true; $('login-panel').hidden = false; $('logout').hidden = true; status('Studio locked.'); });
$('text').addEventListener('input', () => { $('character-count').textContent = $('text').value.length; });
$('reference').addEventListener('change', () => {
  if (referenceUrl) URL.revokeObjectURL(referenceUrl);
  const file = $('reference').files[0];
  referenceUrl = file ? URL.createObjectURL(file) : '';
  $('reference-player').src = referenceUrl; $('reference-player').hidden = !file; $('clear-reference').hidden = !file;
});
$('clear-reference').addEventListener('click', () => { $('reference').value = ''; $('reference').dispatchEvent(new Event('change')); $('transcript').value = ''; });

$('generate').addEventListener('click', async () => {
  if (jobId) return;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(savedJobKey()) || 'null'); } catch {}
  if (saved && typeof saved.id === 'string' && Date.now() - saved.submitted < 660000) {
    await poll(saved.id, saved.submitted); return;
  }
  busy(true); status('Preparing your request…');
  try {
    const text = $('text').value.trim(), transcript = $('transcript').value.trim();
    if (!text || text.length > 1500) throw new Error('Enter between 1 and 1,500 characters to say.');
    const file = $('reference').files[0];
    if (transcript && !file) throw new Error('Upload the recording that matches the transcript.');
    const input = {text, transcript, steps:Number($('steps').value)};
    if (file) {
      if (file.size > 25 * 1024 * 1024) throw new Error('Use a recording smaller than 25 MB.');
      let decoded;
      try { decoded = await decodeMono(await file.arrayBuffer(), 16000); }
      catch { throw new Error('Your browser could not read this recording. Try a WAV, MP3 or M4A file.'); }
      if (decoded.duration < 1 || decoded.duration > 60.001) throw new Error('Use a recording between 1 and 60 seconds.');
      input.reference_audio_base64 = toBase64(pcm16Wav(decoded.samples, decoded.sampleRate));
    }
    status('Submitting one generation…');
    let result;
    try { result = await api('run', 'POST', {input, policy:{executionTimeout:300000, ttl:600000}}); }
    catch (error) { throw new Error(`${error.message} If the connection dropped during submission, check Runpod Requests before submitting again to avoid a duplicate.`); }
    if (!result.id) throw new Error('Runpod did not return a job ID. Check Runpod Requests before submitting again.');
    const submitted = Date.now(); rememberJob(result.id, submitted);
    await poll(result.id, submitted);
  } catch (error) { status(error.message, true); }
  finally { if (!jobId) busy(false); }
});

$('cancel').addEventListener('click', async () => {
  if (!jobId) return;
  $('cancel').disabled = true;
  try { await api(`cancel/${encodeURIComponent(jobId)}`, 'POST'); jobId = ''; forgetJob(); busy(false); status('Generation cancelled. The GPU will shut down after it becomes idle.'); }
  catch (error) { status(`Could not confirm cancellation: ${error.message}`, true); }
  finally { $('cancel').disabled = false; }
});

try { const config = await (await fetch('./config.json', {cache:'no-store'})).json(); endpoint = config.endpointId; }
catch { status('Could not load the studio configuration. Reload the page.', true); }
