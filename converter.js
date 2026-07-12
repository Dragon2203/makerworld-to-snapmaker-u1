// Main conversion orchestrator for MakerWorld/Bambu 3MF → Snapmaker U1 3MF.
//
// Keeps the high-level workflow in one place:
// parse source project → build U1 project → rewrite metadata → write output ZIP.

const TARGET_FILAMENTS = 4;

function getConverterVersion() {
  try {
    return chrome.runtime.getManifest().version || 'unknown';
  } catch (error) {
    console.warn(
      '[U1 Converter] Could not read extension version from manifest:',
      error
    );
    return 'unknown';
  }
}

function parseXml(str) {
  return new DOMParser().parseFromString(str, 'application/xml');
}

function serializeXml(doc) {
  return new XMLSerializer().serializeToString(doc);
}

function padArray(arr, length, fillValue) {
  const out = arr.slice(0, length);
  while (out.length < length) out.push(fillValue ?? arr[arr.length - 1]);
  return out;
}

// Copy binary input into this script's own JavaScript realm.
//
// Firefox content scripts can expose fetched TypedArrays through an isolated
// cross-compartment wrapper. JSZip then fails while detecting the input type.
// A byte-by-byte copy avoids constructor, iterator and TypedArray species access
// on the wrapped source object.
function copyBinaryInputToLocalUint8Array(input) {
  const length = Number(input?.byteLength);

  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new TypeError('Invalid or empty 3MF input');
  }

  const localBytes = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    localBytes[i] = input[i];
  }

  return localBytes;
}

async function convertToU1(inputBuffer, opts = {}) {
  const conversionStartedAt = performance.now();

  const localInput = copyBinaryInputToLocalUint8Array(inputBuffer);
  const zip = await JSZip.loadAsync(localInput);

  // ── 1. Parse original 3MF into project object ─────────────────────────────
  const sourceProject = await parseProject(zip);

  sourceProject.options = {
    printProfileMode: 'preserve',
    forcedProfileId: '0.20mm-standard',
    filamentPresetMode: 'preserve',
    forceExcludeObject: true,
    forceBrimOff: true,
    autoFixOrganicVariableLayer: true,
    debugReport: true,
    smartProcessMerge: true,
    strictProcessMerge: false,

    ...(sourceProject.options || {}),
    ...(opts || {}),
    ...(opts.converterOptions || {}),
  };

  // ── 2. Build converted U1 project settings ───────────────────────────────
  const project = await buildU1Project(sourceProject, opts);

  // ── 3. Rewrite 3MF metadata/model files ───────────────────────────────────
  const metadata = await rewriteU13mfMetadata(zip, project);

  project.metadata = {
    ...(project.metadata || {}),
    rewritten: metadata,
  };

  project.converter = {
    version: getConverterVersion(),
    conversionMs: Math.round(performance.now() - conversionStartedAt),
  };

  if (project.options?.debugReport !== false) {
    logU1ProjectReport(project);
  }

  // ── 4. Write output ZIP ──────────────────────────────────────────────────
  const outZip = new JSZip();
  for (const name of Object.keys(zip.files)) {
    const entry = zip.file(name);
    if (!entry || entry.dir) { if (entry?.dir) outZip.folder(name); continue; }

    const safe = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (safe.startsWith('..') || safe.includes('/../')) continue;

    if (name === 'Metadata/project_settings.config') {
      outZip.file(name, project.u1.settingsBytes);
    } else if (name === 'Metadata/slice_info.config' && metadata.modifiedSliceInfo) {
      outZip.file(name, metadata.modifiedSliceInfo);
    } else if (name === 'Metadata/model_settings.config' && metadata.modifiedModelSettings) {
      outZip.file(name, metadata.modifiedModelSettings);
    } else {
      outZip.file(name, await entry.async('uint8array'));
    }
  }

  return outZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
