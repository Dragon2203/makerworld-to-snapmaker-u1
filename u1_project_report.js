// Developer/debug report for converted U1 projects.
//
// Summarizes parser results, filament mapping, process merge decisions,
// compatibility actions and optional deep diagnostics in the browser console.

function logU1ProjectReport(project) {
  if (!project) return;

  const options = project.options || {};
  const model = project.analysis?.model || {};
  const compatibility = project.compatibility || {};
  const deepDebugReport = options.deepDebugReport === true;
  const filamentSlotCount = Math.max(
    TARGET_FILAMENTS,
    project.filaments?.mapped?.ids?.length || 0,
    project.filaments?.source?.length || 0,
    project.original?.settings?.filament_settings_id?.length || 0
  );

  console.groupCollapsed('[U1 Project Report]');

  console.log('converter:', {
    version: project.converter?.version || 'unknown',
    status: project.converter?.status || 'unknown',
    conversionMs: project.converter?.conversionMs ?? null,
  });

  console.log('summary:', {
    files: project.stats?.fileCount ?? null,
    metadataFiles: project.stats?.metadataCount ?? null,
    modelFiles: project.stats?.modelCount ?? null,
    thumbnailFiles: project.stats?.thumbnailCount ?? null,

    objects: model.objectCount ?? null,
    buildItems: model.buildItemCount ?? null,
    meshObjects: model.meshObjectCount ?? null,
    componentObjects: model.componentObjectCount ?? null,

    baseMaterialGroups: model.baseMaterialGroupCount ?? null,
    baseMaterials: model.baseMaterialCount ?? null,
    colorGroups: model.colorGroupCount ?? null,
    colors: model.colorCount ?? null,

    vertices: model.totalVertices ?? null,
    triangles: model.totalTriangles ?? null,

    hasPaint: project.analysis?.features?.hasPaint ?? false,
    hasSupport: project.analysis?.features?.hasSupport ?? false,
    hasAdaptiveLayer: project.analysis?.features?.hasAdaptiveLayer ?? false,
    hasMultiColor: project.analysis?.features?.hasMultiColor ?? false,
    hasMultiMaterial: project.analysis?.features?.hasMultiMaterial ?? false,

    sourceFilaments: project.filaments?.source?.length || 0,
    finalFilamentSlots: filamentSlotCount,

    compatibilityActions: compatibility.actions?.length || 0,
    compatibilityWarnings: compatibility.warnings?.length || 0,
  });

  console.groupCollapsed('converter options');
  console.table(formatConverterOptionsForReport(options));
  console.groupEnd();

  console.groupCollapsed('filaments');

  console.log('source → mapped:', {
    source: project.filaments?.source || [],
    mapped: project.filaments?.mapped || {},
  });

  console.log('filament preset analysis:', project.analysis?.filamentPreset || null);

  console.table(
    Array.from({ length: filamentSlotCount }, (_, i) => ({
      slot: i + 1,

      source_settings_id:
        project.original?.settings?.filament_settings_id?.[i],

      final_settings_id:
        project.u1?.settings?.filament_settings_id?.[i],

      source_vendor:
        project.original?.settings?.filament_vendor?.[i],

      final_vendor:
        project.u1?.settings?.filament_vendor?.[i],

      source_type:
        project.original?.settings?.filament_type?.[i],

      final_type:
        project.u1?.settings?.filament_type?.[i],

      source_color:
        project.original?.settings?.filament_colour?.[i],

      final_color:
        project.u1?.settings?.filament_colour?.[i],

      source_diff:
        project.original?.settings?.different_settings_to_system?.[i + 1],

      final_diff:
        project.u1?.settings?.different_settings_to_system?.[i + 1],
    }))
  );

  console.groupEnd();

  console.groupCollapsed('custom printer profile');

  const customPrinterProfile = project.analysis?.customPrinterProfile || null;

  console.log('summary:', customPrinterProfile ? {
    mode: customPrinterProfile.mode || null,
    requested: customPrinterProfile.requested || null,
    enabled: customPrinterProfile.enabled,
    missing: customPrinterProfile.missing || false,
    selected: customPrinterProfile.selected || null,
    inheritedFrom: customPrinterProfile.inheritedFrom || null,
    overrideCount: customPrinterProfile.overrideCount || 0,
    machineIndex: customPrinterProfile.machineIndex ?? null,
  } : null);

  console.log('override keys:', customPrinterProfile?.overrideKeys || []);
  console.log('applied:', customPrinterProfile?.applied || []);
  console.log('skipped:', customPrinterProfile?.skipped || []);

  console.groupEnd();

  console.groupCollapsed('print profile');

  const processPreset = project.analysis?.processPreset || {};
  const processMerge = project.analysis?.processMerge || {};
  const lockedByForcedProfile = (processMerge.skipped || [])
    .filter(row => row.reason === 'locked-by-forced-print-profile');

  console.log('summary:', formatPrintProfileSummaryForReport(processPreset));

  if (lockedByForcedProfile.length) {
    console.table(
      lockedByForcedProfile.map(row => ({
        key: row.key,
        sourceValue: row.sourceValue,
        keptProfileValue: row.finalValue,
        reason: row.reason,
      }))
    );
  }

  console.groupEnd();

  console.groupCollapsed('process merge');

  console.log('summary:', {
    mode: processMerge.mode || null,
    strict: processMerge.strict ?? null,
    candidates: processMerge.candidates?.length || 0,
    mergedSettings: processMerge.merged?.length || 0,
    lockedByForcedProfile: lockedByForcedProfile.length,
    blockedSettings: processMerge.blocked?.length || 0,
    skippedSettings: Math.max(
      0,
      (processMerge.skipped?.length || 0) - lockedByForcedProfile.length
    ),
  });

  console.groupEnd();

  console.groupCollapsed('automatic compatibility fixes');

  console.log('applied actions:', compatibility.actions || []);
  console.log('warnings:', compatibility.warnings || []);

  console.groupEnd();

  if (deepDebugReport) {
    logU1DeepDiagnostics(project);
  }

  console.groupEnd();
}

function formatConverterOptionsForReport(options = {}) {
  const out = {};

  for (const [key, value] of Object.entries(options || {})) {
    if (value === undefined || value === null) continue;

    const type = typeof value;

    if (
      type === 'string' ||
      type === 'number' ||
      type === 'boolean'
    ) {
      out[key] = value;
    }
  }

  return out;
}

function formatPrintProfileSummaryForReport(processPreset = {}) {
  const mode = processPreset.mode === 'force' ? 'force' : 'preserve';

  if (mode === 'force') {
    return {
      mode: 'Force U1 print profile',
      forcedProfile: processPreset.resolved_u1_profile || null,
      forcedProfileId: processPreset.forcedProfileId || null,
      ignoredSource:
        processPreset.source_ignored ||
        processPreset.source_default_print_profile ||
        processPreset.source_print_settings_id ||
        null,
      resolvedU1Profile: processPreset.resolved_u1_profile || null,
      reason: 'User selected Force U1 print profile',
    };
  }

  return {
    mode: 'Preserve source print profile',
    detectedSource:
      processPreset.selected_source_profile ||
      processPreset.source_default_print_profile ||
      processPreset.source_print_settings_id ||
      null,
    resolvedU1Profile: processPreset.resolved_u1_profile || null,
    detection:
      processPreset.selection_reason === 'default_print_profile'
        ? 'default_print_profile'
        : processPreset.selection_reason === 'print_settings_id'
          ? 'print_settings_id'
          : processPreset.selection_reason || null,
    fallback: processPreset.fallback === true,
  };
}

function logU1DeepDiagnostics(project) {
  console.groupCollapsed('[U1 Deep Diagnostics]');

  const processMerge  = project.analysis?.processMerge || {};

  console.groupCollapsed('bambu diagnostics');

  const bambuSummary = project.analysis?.bambu?.summary || {};
  const bambuFiles = project.analysis?.bambu?.files || [];

  console.log('summary:', {
    metadataFiles: bambuSummary.metadataFiles?.length || 0,
    relationshipFiles: bambuSummary.relationshipFiles?.length || 0,
    modelFiles: bambuSummary.modelFiles?.length || 0,
    filesWithNamespaces: bambuSummary.filesWithNamespaces?.length || 0,
    filesWithBambuAttributes: bambuSummary.filesWithBambuAttributes?.length || 0,
    xmlFiles: bambuSummary.xmlFiles?.length || 0,
    jsonFiles: bambuSummary.jsonFiles?.length || 0,
  });

  console.log(`bambu files: ${bambuFiles.length}`, bambuFiles);

  console.log(
    'interesting XML attributes:',
    (project.analysis?.bambu?.files || [])
      .filter(f => f.interestingAttributes?.length)
      .map(f => ({
        path: f.path,
        attributes: f.interestingAttributes,
      }))
  );

  console.log(
    'paint_color analysis:',
    (project.analysis?.bambu?.files || [])
      .filter(f => f.paintColorAnalysis?.paintedTriangleCount)
      .map(f => ({
        path: f.path,
        ...f.paintColorAnalysis,
      }))
  );

  console.groupEnd();

  console.groupCollapsed('process merge details');

  console.log('process merge statistics', {
      candidates: processMerge.candidates?.length || 0,
      merged: processMerge.merged?.length || 0,
      blocked: processMerge.blocked?.length || 0,
      skipped: processMerge.skipped?.length || 0,
  });

  console.log('process merge:', processMerge);

  console.groupEnd();

  console.groupCollapsed('model_settings filament metadata');

  console.log(readModelSettingsExtruderMetadata(project));

  console.groupEnd();

  console.groupCollapsed('filament slot differences');

  logFilamentSlotDifferences(project);

  console.groupEnd();

  console.groupEnd();
}

function readModelSettingsExtruderMetadata(project) {
  const xml = project.metadata?.rewritten?.modifiedModelSettings;
  const doc = xml ? parseXml(xml) : project.original?.modelSettingsDoc;

  if (!doc) return null;

  const rows = [];

  doc.querySelectorAll('metadata').forEach(meta => {
    const key = meta.getAttribute('key') || '';

    if (
      key.includes('filament') ||
      key === 'extruder'
    ) {
      rows.push({
        key,
        value: meta.getAttribute('value') || '',
        parent: meta.parentElement?.tagName || '',
        parentId: meta.parentElement?.getAttribute('id') || '',
        parentName: meta.parentElement?.getAttribute('name') || '',
      });
    }
  });

  return rows;
}

function logFilamentSlotDifferences(project) {
  const filamentKeys = Object.keys(project.u1?.settings || {})
    .filter(k => k.startsWith('filament_'))
    .sort();

  function slotValue(settings, key, slot) {
    const value = settings?.[key];
    return Array.isArray(value) ? value[slot] : undefined;
  }

  const filamentSlotCount = Math.max(
    TARGET_FILAMENTS,
    project.filaments?.mapped?.ids?.length || 0,
    project.filaments?.source?.length || 0,
    project.original?.settings?.filament_settings_id?.length || 0
  );

  for (let a = 0; a < filamentSlotCount; a += 2) {
    const b = a + 1;

    console.groupCollapsed(
      b < filamentSlotCount
        ? `Slot ${a + 1} ↔ Slot ${b + 1}`
        : `Slot ${a + 1}`
    );

    const rows = [];

    for (const key of filamentKeys) {
      const sourceA = slotValue(project.original?.settings, key, a);
      const sourceB = b < filamentSlotCount ? slotValue(project.original?.settings, key, b) : undefined;

      const finalA = slotValue(project.u1?.settings, key, a);
      const finalB = b < filamentSlotCount ? slotValue(project.u1?.settings, key, b) : undefined;

      if (
        sourceA !== sourceB ||
        finalA !== finalB
      ) {
        rows.push({
          key,
          sourceLength: Array.isArray(project.original?.settings?.[key])
            ? project.original.settings[key].length
            : null,

          finalLength: Array.isArray(project.u1?.settings?.[key])
            ? project.u1.settings[key].length
            : null,
          sourceA,
          sourceB,
          finalA,
          finalB,
        });
      }
    }

    console.table(rows);

    console.groupEnd();
  }
}