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
  const performanceTimings = {};

  let stageStartedAt = performance.now();
  const localInput = copyBinaryInputToLocalUint8Array(inputBuffer);
  performanceTimings.inputCopyMs = performance.now() - stageStartedAt;

  stageStartedAt = performance.now();
  const zip = await JSZip.loadAsync(localInput);
  performanceTimings.zipLoadMs = performance.now() - stageStartedAt;

  const resolvedOptions = {
    printProfileMode: 'preserve',
    forcedProfileId: '0.20mm-standard',
    filamentPresetMode: 'preserve',
    forceExcludeObject: true,
    forceBrimOff: true,
    autoFixOrganicVariableLayer: true,
    fixMultiPlatePositioning: true,
    debugReport: true,
    deepDebugReport: false,
    smartProcessMerge: true,
    strictProcessMerge: false,

    ...(opts || {}),
    ...(opts.converterOptions || {}),
  };

  // ── 1. Parse original 3MF into project object ─────────────────────────────
  stageStartedAt = performance.now();

  const sourceProject = await parseProject(
    zip,
    resolvedOptions
  );

  performanceTimings.projectParseMs =
    performance.now() - stageStartedAt;

  sourceProject.options = {
    ...(sourceProject.options || {}),
    ...resolvedOptions,
  };

  // ── 2. Build converted U1 project settings ───────────────────────────────
  stageStartedAt = performance.now();
  const project = await buildU1Project(sourceProject, opts);
  performanceTimings.projectBuildMs = performance.now() - stageStartedAt;

  // ── 3. Rewrite 3MF metadata/model files ───────────────────────────────────
  stageStartedAt = performance.now();
  const metadata = await rewriteU13mfMetadata(zip, project);
  performanceTimings.metadataRewriteMs = performance.now() - stageStartedAt;

  project.metadata = {
    ...(project.metadata || {}),
    rewritten: metadata,
  };

  // ── 4. Write output ZIP ──────────────────────────────────────────────────
  const outZip = new JSZip();

  let copiedFileCount = 0;
  let rewrittenFileCount = 0;
  let directoryCount = 0;
  let skippedUnsafeFileCount = 0;

  stageStartedAt = performance.now();

  for (const name of Object.keys(zip.files)) {
    const entry = zip.file(name);

    if (!entry || entry.dir) {
      if (entry?.dir) {
        outZip.folder(name);
        directoryCount++;
      }

      continue;
    }

    const safe = name.replace(/\\/g, '/').replace(/^\/+/, '');

    if (safe.startsWith('..') || safe.includes('/../')) {
      skippedUnsafeFileCount++;
      continue;
    }

    if (name === 'Metadata/project_settings.config') {
      outZip.file(name, project.u1.settingsBytes);
      rewrittenFileCount++;
    } else if (
      name === 'Metadata/slice_info.config' &&
      metadata.modifiedSliceInfo
    ) {
      outZip.file(name, metadata.modifiedSliceInfo);
      rewrittenFileCount++;
    } else if (
      name === 'Metadata/model_settings.config' &&
      metadata.modifiedModelSettings
    ) {
      outZip.file(
        name,
        metadata.modifiedModelSettings
      );

      rewrittenFileCount++;
    } else if (
      name === '3D/3dmodel.model' &&
      metadata.modified3DModel
    ) {
      outZip.file(
        name,
        metadata.modified3DModel
      );

      rewrittenFileCount++;
    } else {
      outZip.file(
        name,
        await entry.async('uint8array')
      );

      copiedFileCount++;
    }
  }

  performanceTimings.zipEntryCopyMs =
    performance.now() - stageStartedAt;

  stageStartedAt = performance.now();

  const outputBytes = await outZip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 4,
    },
  });
  performanceTimings.zipGenerateMs =
    performance.now() - stageStartedAt;

  performanceTimings.totalMs =
    performance.now() - conversionStartedAt;

  project.converter = {
    version: getConverterVersion(),
    conversionMs: Math.round(performanceTimings.totalMs),

    performance: {
      timings: Object.fromEntries(
        Object.entries(performanceTimings).map(([key, value]) => [
          key,
          Math.round(value * 100) / 100,
        ])
      ),

      inputBytes: localInput.byteLength,
      outputBytes: outputBytes.byteLength,

      zipEntryCount: Object.keys(zip.files).length,
      copiedFileCount,
      rewrittenFileCount,
      directoryCount,
      skippedUnsafeFileCount,

      compression: 'DEFLATE',
    },
  };

  if (project.options?.debugReport !== false) {
    logU1ProjectReport(project);
  }

  return outputBytes;
}
