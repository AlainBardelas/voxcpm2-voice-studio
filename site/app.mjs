import {pcm16Wav, toBase64, fromBase64, decodeMono} from './audio.mjs';
import {MODELS, MAX_REFERENCE_SECONDS, JOB_LIFETIME_MS, referenceExcerpt, checkOutput, resultWarning} from './models.mjs?v=3';

const $ = id => document.getElementById(id);
let key = '', endpoint = '', jobId = '', referenceUrl = '', referenceData = null;
let working = false, referenceLoading = false, uploadVersion = 0, previewEnd = null;
const resultUrls = {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const savedJobKey = () => `voxcpm-job-${endpoint}`;
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const selectedModel = () => $('model').value;

function busy(value) {
  working = value;
  for (const id of ['generate','logout','model','reference','reference-start','reference-end','transcript','text','steps','audio-only','clear-reference']) $(id).disabled = value;
  $('generate').disabled = value || referenceLoading;
  $('cancel').hidden = !value || !jobId;
}

function updateModel() {
  const qwen = selectedModel() === 'qwen3-tts';
  $('model-hint').textContent = qwen
    ? 'Clones your recording with the 1.7B Base model. Add an exact transcript for the fuller voice-cloning mode.'
    : 'Clones from audio alone, or uses audio and its exact transcript together for Ultimate Cloning.';
  $('reference-hint').textContent = qwen ? 'A voice recording is required for Qwen Base.' : 'You can leave the recording empty to try a generated voice.';
  $('transcript-hint').textContent = qwen
    ? ($('audio-only').checked ? 'Audio-only mode uses the voice embedding and can reduce cloning fidelity. The transcript is ignored in this mode.' : 'Required for the fuller Qwen cloning mode. It must match the selected excerpt, including Cuban words and expressions.')
    : 'Optional. With a recording, an exact transcript enables Ultimate Cloning. It must match the selected excerpt.';
  $('audio-only-label').hidden = !qwen;
  $('vox-settings').hidden = qwen;
  $('generate').textContent = qwen ? 'Generate with Qwen3-TTS' : 'Generate with VoxCPM2';
}

function getExcerpt() {
  if (!referenceData) return null;
  if ($('reference-start').value === '' || $('reference-end').value === '') throw new Error('Enter the excerpt start and end in seconds.');
  return referenceExcerpt(referenceData, Number($('reference-start').value), Number($('reference-end').value));
}
function updateExcerpt() {
  if (!referenceData) return;
  try {
    const excerpt = getExcerpt();
    $('excerpt-info').textContent = `Using ${clock(Number($('reference-start').value))}–${clock(Number($('reference-end').value))} (${excerpt.duration.toFixed(1)} seconds) from your ${clock(referenceData.duration)} recording. Your transcript must cover this selection only.`;
  } catch (error) { $('excerpt-info').textContent = error.message; }
}

async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.runpod.ai/v2/${endpoint}/${path}`, {
    method, headers: {Authorization: `Bearer ${key}`, ...(body ? {'Content-Type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000), cache: 'no-store', credentials: 'omit',
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('The access key was rejected. Lock the studio and check your key.');
    if (response.status === 404) throw new Error('The endpoint or job was not found. This job may have expired.');
    if (response.status === 413) throw new Error('The selected recording exceeds the upload limit. Choose a shorter excerpt.');
    throw new Error(`Runpod returned an error (${response.status}). Please try again later.`);
  }
  return response.json();
}

function rememberJob(id, submitted, model) {
  try { sessionStorage.setItem(savedJobKey(), JSON.stringify({id, submitted, model})); } catch {}
}
function forgetJob() { try { sessionStorage.removeItem(savedJobKey()); } catch {} }
function savedJob() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(savedJobKey()) || 'null');
    if (saved && typeof saved.id === 'string' && Number.isFinite(saved.submitted) && Date.now() - saved.submitted < JOB_LIFETIME_MS) {
      saved.model ||= 'voxcpm2';
      if (MODELS[saved.model]) return saved;
    }
  } catch {}
  return null;
}

async function showResult(output, executionTime, delayTime, model, submittedText = '') {
  const description = checkOutput(output, model);
  const decoded = await decodeMono(fromBase64(output.audio_base64), description.sampleRate);
  const wav = pcm16Wav(decoded.samples, decoded.sampleRate);
  if (resultUrls[model]) URL.revokeObjectURL(resultUrls[model]);
  resultUrls[model] = URL.createObjectURL(new Blob([wav], {type:'audio/wav'}));
  $(`${model}-player`).src = resultUrls[model]; $(`${model}-player`).hidden = false;
  $(`${model}-download`).href = resultUrls[model]; $(`${model}-download`).download = `${model}-${new Date().toISOString().replaceAll(':','-')}.wav`; $(`${model}-download`).hidden = false;
  $(`${model}-hint`).textContent = `Ready · ${output.cloning_mode || 'voice generation'}${output.reference_seconds ? ` · ${output.reference_seconds.toFixed(1)}s reference` : ''}`;
  $(`${model}-details`).textContent = `${decoded.duration.toFixed(1)} seconds · ${decoded.sampleRate.toLocaleString()} Hz · Generation ${(Number(executionTime || 0) / 1000).toFixed(1)}s · Queue/startup ${(Number(delayTime || 0) / 1000).toFixed(1)}s`;
  $(`${model}-text`).textContent = submittedText || 'Result restored after reconnecting. The original text is not saved in this tab.';
  const warning = resultWarning(decoded.duration, submittedText);
  $(`${model}-warning`).textContent = warning; $(`${model}-warning`).hidden = !warning;
  return Boolean(warning);
}

async function poll(id, submitted, model, submittedText = '') {
  jobId = id; busy(true); let failures = 0;
  try {
    while (jobId === id) {
      if (Date.now() - submitted > JOB_LIFETIME_MS) throw new Error('The job has exceeded its time limit. Check your Runpod endpoint before submitting another generation.');
      let result;
      try { result = await api(`status/${encodeURIComponent(id)}`); failures = 0; }
      catch (error) {
        if (++failures >= 6) throw new Error(`${error.message} Your submitted job may still finish; reload and unlock this tab to reconnect.`);
        status('Connection interrupted. Reconnecting to the existing job without submitting another one…');
        await sleep(5000); continue;
      }
      if (jobId !== id) return;
      const elapsed = Math.round((Date.now() - submitted) / 1000);
      if (result.status === 'COMPLETED') {
        if (result.output?.error) { forgetJob(); throw new Error(result.output.error); }
        const warning = await showResult(result.output, result.executionTime, result.delayTime, model, submittedText); forgetJob();
        status(warning ? 'Audio returned, but it is unusually long for the text. Check the warning beside its player before using it.' : `${MODELS[model].label} audio is ready. Switch models to compare with the same inputs. The GPU shuts down automatically when idle.`); return;
      }
      if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) {
        forgetJob(); throw new Error(result.error || `Generation ${result.status.toLowerCase().replace('_', ' ')}. You can try again.`);
      }
      status(result.status === 'IN_PROGRESS'
        ? `${MODELS[model].label}: loading the model and generating… ${elapsed}s elapsed.`
        : `Waiting for a GPU to start… ${elapsed}s elapsed. Your ${MODELS[model].label} request is already queued.`);
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
    $('access-key').value = ''; $('login-panel').hidden = true; $('studio').hidden = false; $('logout').hidden = false; status('Studio unlocked. Both models use the same access key.');
    const saved = savedJob();
    if (saved) { $('model').value = saved.model; updateModel(); void poll(saved.id, saved.submitted, saved.model); }
  } catch (error) { key = ''; status(error.message, true); }
  finally { $('login-button').disabled = false; }
});

$('logout').addEventListener('click', () => {
  key = ''; $('studio').hidden = true; $('login-panel').hidden = false; $('logout').hidden = true;
  $('reference').value = ''; $('reference').dispatchEvent(new Event('change'));
  $('text').value = ''; $('transcript').value = ''; $('character-count').textContent = '0';
  for (const model of Object.keys(MODELS)) {
    if (resultUrls[model]) URL.revokeObjectURL(resultUrls[model]); delete resultUrls[model];
    $(`${model}-player`).pause(); $(`${model}-player`).removeAttribute('src'); $(`${model}-player`).hidden = true;
    $(`${model}-download`).removeAttribute('href'); $(`${model}-download`).hidden = true;
    $(`${model}-hint`).textContent = 'No result yet.'; $(`${model}-details`).textContent = ''; $(`${model}-text`).textContent = '';
    $(`${model}-warning`).textContent = ''; $(`${model}-warning`).hidden = true;
  }
  status('Studio locked.');
});
$('model').addEventListener('change', updateModel);
$('audio-only').addEventListener('change', updateModel);
$('text').addEventListener('input', () => { $('character-count').textContent = $('text').value.length; });
for (const id of ['reference-start', 'reference-end']) $(id).addEventListener('input', updateExcerpt);
$('reference').addEventListener('change', async () => {
  const version = ++uploadVersion;
  referenceData = null; previewEnd = null; referenceLoading = false;
  $('reference-player').pause();
  if (referenceUrl) URL.revokeObjectURL(referenceUrl);
  referenceUrl = ''; $('reference-player').removeAttribute('src'); $('reference-player').hidden = true; $('excerpt-controls').hidden = true;
  const file = $('reference').files[0];
  if (!file) { $('reference-info').textContent = 'Open a recording up to 20 minutes / 100 MB, then choose an excerpt of up to 3 minutes.'; busy(working); return; }
  referenceLoading = true; busy(working); $('reference-info').textContent = 'Reading your recording locally…';
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('Open a recording smaller than 100 MB.');
    let decoded;
    try { decoded = await decodeMono(await file.arrayBuffer(), 16000); }
    catch { throw new Error('Your browser could not read this recording. Try a WAV, MP3 or M4A file.'); }
    if (version !== uploadVersion) return;
    if (decoded.duration < 1 || decoded.duration > 1200) throw new Error('Open a recording between 1 second and 20 minutes. Longer collections are better prepared as a separate fine-tuning dataset.');
    referenceData = decoded;
    referenceUrl = URL.createObjectURL(file);
    $('reference-player').src = referenceUrl; $('reference-player').hidden = false; $('excerpt-controls').hidden = false;
    $('reference-start').value = '0';
    $('reference-end').value = String(Math.floor(Math.min(decoded.duration, MAX_REFERENCE_SECONDS) * 1000) / 1000);
    $('reference-start').max = String(decoded.duration - 1); $('reference-end').max = String(decoded.duration);
    $('reference-info').textContent = `${file.name} · ${clock(decoded.duration)} total. Choose the excerpt below. Only the selected audio will be sent.`;
    updateExcerpt();
  } catch (error) {
    if (version === uploadVersion) { $('reference').value = ''; $('reference-info').textContent = error.message; status(error.message, true); }
  } finally { if (version === uploadVersion) { referenceLoading = false; busy(working); } }
});
$('clear-reference').addEventListener('click', () => { $('reference').value = ''; $('reference').dispatchEvent(new Event('change')); $('transcript').value = ''; });
$('preview-reference').addEventListener('click', async () => {
  try { getExcerpt(); previewEnd = Number($('reference-end').value); $('reference-player').currentTime = Number($('reference-start').value); await $('reference-player').play(); }
  catch (error) { status(error.message, true); }
});
$('reference-player').addEventListener('timeupdate', () => {
  if (previewEnd !== null && $('reference-player').currentTime >= previewEnd) { $('reference-player').pause(); previewEnd = null; }
});

$('generate').addEventListener('click', async () => {
  if (working || referenceLoading || jobId) return;
  const saved = savedJob();
  if (saved) { await poll(saved.id, saved.submitted, saved.model); return; }
  busy(true); status('Preparing your request…');
  try {
    const model = selectedModel(), text = $('text').value.trim(), transcript = $('transcript').value.trim();
    const audioOnly = model === 'qwen3-tts' && $('audio-only').checked;
    if (!text || text.length > 1500) throw new Error('Enter between 1 and 1,500 characters to say.');
    if (transcript && !referenceData) throw new Error('Upload the recording that matches the transcript.');
    if (model === 'qwen3-tts' && !referenceData) throw new Error('Qwen3-TTS Base needs a voice recording to clone.');
    if (model === 'qwen3-tts' && !audioOnly && !transcript) throw new Error('Add the exact transcript of the selected excerpt. To test without it, explicitly enable the lower-fidelity audio-only mode.');
    const input = {model, text, transcript, audio_only:audioOnly, steps:Number($('steps').value)};
    const excerpt = getExcerpt();
    if (excerpt) input.reference_audio_base64 = toBase64(pcm16Wav(excerpt.samples, excerpt.sampleRate));
    status(`Submitting one ${MODELS[model].label} generation…`);
    let result;
    try { result = await api('run', 'POST', {input, policy:{executionTimeout:600000, ttl:900000}}); }
    catch (error) { throw new Error(`${error.message} If the connection dropped during submission, check Runpod Requests before submitting again to avoid a duplicate.`); }
    if (!result.id) throw new Error('Runpod did not return a job ID. Check Runpod Requests before submitting again.');
    const submitted = Date.now(); rememberJob(result.id, submitted, model);
    await poll(result.id, submitted, model, text);
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

updateModel();
try { const config = await (await fetch('./config.json', {cache:'no-store'})).json(); endpoint = config.endpointId; }
catch { status('Could not load the studio configuration. Reload the page.', true); }
