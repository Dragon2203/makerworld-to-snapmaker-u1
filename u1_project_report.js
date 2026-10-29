// Developer/debug report for converted U1 projects.
//
// Summarizes parser results, filament mapping, process merge decisions,
// compatibility actions and optional deep diagnostics in the browser console.

function logU1ProjectReport(project) {
  if (!project) return;

  const options = project.options || {};
  const model = project.analysis?.model || {};
  const compatibility = project.compatibility || {};

  const printerProfile =
    project.analysis?.customPrinterProfile || null;

  const orcaCompatibilityEnabled =
    options.orcaCompatibility === true ||
    printerProfile?.compatibilityMode === 'orca';

  const targetSlicer =
    orcaCompatibilityEnabled
      ? 'OrcaSlicer'
      : 'Snapmaker Orca';

  const multiPlatePositioning =
    project.analysis?.multiPlatePositioning || null;

  const deepDebugReport =
    options.deepDebugReport === true;
  const filamentSlotCount = Math.max(
    TARGET_FILAMENTS,
    project.filaments?.mapped?.ids?.length || 0,
    project.filaments?.source?.length || 0,
    project.original?.settings?.filament_settings_id?.length || 0
  );

  console.groupCollapsed('[U1 Project Report]');

  const conversionMs =
    project.converter?.conversionMs;

  const conversionTime =
    Number.isFinite(conversionMs)
      ? conversionMs >= 1000
        ? `${(conversionMs / 1000).toFixed(2)} s`
        : `${conversionMs.toFixed(0)} ms`
      : null;

  const diagnosticsMetadata =
    project.options?.u1Diagnostics
      ?.metadata ||
    {};

  console.log('converter:', {
    version:
      project.converter?.version ||
      'unknown',

    conversionTime,

    makerWorldCapture:
      diagnosticsMetadata
        .makerWorldCaptureTransport ||
      'unknown',

    captureHttpStatus:
      diagnosticsMetadata
        .makerWorldCaptureHttpStatus ??
      null,
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

    hasSupport: project.analysis?.features?.hasSupport ?? false,
    hasAdaptiveLayer: project.analysis?.features?.hasAdaptiveLayer ?? false,
    hasMultiColor: project.analysis?.features?.hasMultiColor ?? false,
    hasMultiMaterial: project.analysis?.features?.hasMultiMaterial ?? false,

    sourceFilaments: project.filaments?.source?.length || 0,
    finalFilamentSlots: filamentSlotCount,

    targetSlicer,
    orcaCompatibility: orcaCompatibilityEnabled,

    multiPlateDetected: multiPlatePositioning?.detected ?? false,
    multiPlatePositioningApplied: multiPlatePositioning?.applied ?? false,

    compatibilityActions: compatibility.actions?.length || 0,
    compatibilityWarnings: compatibility.warnings?.length || 0,
  });

  logU1PerformanceReport(
    project.converter?.performance,

    deepDebugReport
      ? project.analysis?.parserPerformance
      : null,

    multiPlatePositioning
  );

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

  console.groupCollapsed('printer profile');

  const targetNozzle =
    project.analysis?.targetNozzle || null;

  const requestedPrinterProfile =
    printerProfile?.requested ||
    U1_CUSTOM_PRINTER_STANDARD_ID;

  const standardPrinterProfileSelected =
    requestedPrinterProfile ===
    U1_CUSTOM_PRINTER_STANDARD_ID;

  console.log('summary:', printerProfile ? {
    targetSlicer,
    mode:
      standardPrinterProfileSelected
        ? 'standard'
        : 'custom',

    requested:
      requestedPrinterProfile,

    selected:
      printerProfile.selected ||
      project.u1?.settings?.printer_settings_id ||
      null,

    inheritedFrom:
      printerProfile.inheritedFrom || null,

    targetNozzle:
      targetNozzle?.nozzleDiameter
        ? `${targetNozzle.nozzleDiameter} mm`
        : null,

    targetNozzleSource:
      targetNozzle?.source || null,

    processProfileAsset:
      targetNozzle?.processProfileId || null,

    customProfileApplied:
      !standardPrinterProfileSelected &&
      (printerProfile.overrideCount || 0) > 0,

    customOverrideCount:
      printerProfile.overrideCount || 0,

    missing:
      printerProfile.missing || false,

    machineIndex:
      printerProfile.machineIndex ?? null,
  } : null);

  console.log(
    'custom override keys:',
    printerProfile?.overrideKeys || []
  );

  console.log(
    'custom overrides applied:',
    printerProfile?.applied || []
  );

  console.log(
    'skipped:',
    printerProfile?.skipped || []
  );

  console.groupEnd();

  if (orcaCompatibilityEnabled) {
    console.groupCollapsed('orca compatibility');

    const finalSettings =
      project.u1?.settings || {};

    const targetExtruders =
      printerProfile?.targetExtruderCount ??
      finalSettings.printer_extruder_id?.length ??
      null;

    const customOverrideKeys =
      printerProfile?.overrideKeys || [];

    const printerDirtyKeys =
      printerProfile?.printerDirtyKeys || [];

    const printerDirtyKeySet =
      new Set(printerDirtyKeys);

    const customOverridesAlsoPrinterDirtyKeys =
      customOverrideKeys.filter(key =>
        printerDirtyKeySet.has(key)
      );

    const additionalCustomOverrideKeys =
      customOverrideKeys.filter(key =>
        !printerDirtyKeySet.has(key)
      );

    console.log('summary:', {
      enabled: true,
      targetSlicer: 'OrcaSlicer',

      profileMode:
        standardPrinterProfileSelected
          ? 'standard'
          : 'custom',

      printerProfileType:
        standardPrinterProfileSelected
          ? 'Standard'
          : 'Custom',

      printerProfile:
        finalSettings.printer_settings_id || null,

      sourceFilaments:
        project.filaments?.source?.length || 0,

      projectFilamentCount:
        printerProfile?.projectFilamentCount ?? null,

      customProfileExtruders:
        printerProfile?.customProfileExtruderCount ?? null,

      targetExtruders,

      machineIndex:
        printerProfile?.machineIndex ?? null,

      normalizedExtruderArrays:
        printerProfile?.normalizedArrayCount || 0,

      printerDirtyKeys:
        printerProfile?.printerDirtyKeyCount ||
        printerProfile?.printerDirtyKeys?.length ||
        0,

      customPrinterOverrides:
        printerProfile?.overrideCount || 0,

      customOverridesAlsoPrinterDirtyKeys:
        customOverridesAlsoPrinterDirtyKeys.length,

      additionalCustomOverrides:
        additionalCustomOverrideKeys.length,

      nozzleDiameterSlots:
        Array.isArray(finalSettings.nozzle_diameter)
          ? finalSettings.nozzle_diameter.length
          : 0,

      nozzleVolumeSlots:
        Array.isArray(finalSettings.nozzle_volume)
          ? finalSettings.nozzle_volume.length
          : 0,

      nozzleTypeSlots:
        Array.isArray(finalSettings.nozzle_type)
          ? finalSettings.nozzle_type.length
          : 0,

      retractionLengthSlots:
        Array.isArray(finalSettings.retraction_length)
          ? finalSettings.retraction_length.length
          : 0,

      printerExtruderIdSlots:
        Array.isArray(finalSettings.printer_extruder_id)
          ? finalSettings.printer_extruder_id.length
          : 0,
    });

    console.log(
      'normalized array keys:',
      printerProfile?.normalizedArrayKeys || []
    );

    console.log(
      'printer dirty keys:',
      printerProfile?.printerDirtyKeys || []
    );

    if (
      !standardPrinterProfileSelected &&
      customOverrideKeys.length
    ) {
      console.log(
        'selected custom Orca profile override keys:',
        customOverrideKeys
      );

      console.log(
        'custom overrides also used as printer dirty keys:',
        customOverridesAlsoPrinterDirtyKeys
      );

      if (additionalCustomOverrideKeys.length) {
        console.log(
          'additional custom Orca override keys:',
          additionalCustomOverrideKeys
        );
      }
    }

    console.groupEnd();
  }


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

  console.groupCollapsed('multi-plate positioning');

  if (!multiPlatePositioning) {
    console.log('summary:', {
      available: false,
      reason: 'No multi-plate positioning analysis was recorded.',
    });
  } else {
    console.log('summary:', {
      enabled:
        multiPlatePositioning.enabled,

      detected:
        multiPlatePositioning.detected,

      applied:
        multiPlatePositioning.applied,

      reason:
        multiPlatePositioning.reason || null,

      plateCount:
        multiPlatePositioning.plateCount ?? null,

      adjustedPlates:
        multiPlatePositioning.adjustedPlateCount ?? 0,

      adjustedInstances:
        multiPlatePositioning.adjustedInstanceCount ?? 0,

      unresolvedInstances:
        multiPlatePositioning.unresolvedInstanceCount ?? 0,

      skippedPlates:
        multiPlatePositioning.skippedPlateCount ?? 0,

      skippedInstances:
        multiPlatePositioning.skippedInstanceCount ?? 0,

      gridFactor:
        multiPlatePositioning.gridFactor ?? null,

      sourcePrinter:
        multiPlatePositioning.source?.printerModel || null,

      sourceBed:
        multiPlatePositioning.source
          ? `${multiPlatePositioning.source.width} × ${multiPlatePositioning.source.height} mm`
          : null,

      sourceGridStep:
        multiPlatePositioning.source
          ? `${multiPlatePositioning.source.gridStepX} × ${multiPlatePositioning.source.gridStepY} mm`
          : null,

      targetPrinter:
        multiPlatePositioning.target?.printerModel || null,

      targetBed:
        multiPlatePositioning.target
          ? `${multiPlatePositioning.target.width} × ${multiPlatePositioning.target.height} mm`
          : null,

      targetGridStep:
        multiPlatePositioning.target
          ? `${multiPlatePositioning.target.gridStepX} × ${multiPlatePositioning.target.gridStepY} mm`
          : null,

      centerOffset:
        multiPlatePositioning.centerOffset
          ? {
              x: `${multiPlatePositioning.centerOffset.x} mm`,
              y: `${multiPlatePositioning.centerOffset.y} mm`,
            }
          : null,

      gridDifference:
        multiPlatePositioning.gridDifference
          ? {
              x: `${multiPlatePositioning.gridDifference.x} mm`,
              y: `${multiPlatePositioning.gridDifference.y} mm`,
            }
          : null,

      detectedGrid:
        multiPlatePositioning.grid
          ? {
              columns:
                multiPlatePositioning.grid.minColumn !== null &&
                multiPlatePositioning.grid.maxColumn !== null
                  ? `${multiPlatePositioning.grid.minColumn} → ${multiPlatePositioning.grid.maxColumn}`
                  : null,

              rows:
                multiPlatePositioning.grid.minRow !== null &&
                multiPlatePositioning.grid.maxRow !== null
                  ? `${multiPlatePositioning.grid.minRow} → ${multiPlatePositioning.grid.maxRow}`
                  : null,

              cells:
                multiPlatePositioning.grid.detectedCells ?? 0,
            }
          : null,

      maximumMovement:
        multiPlatePositioning.movement
          ? {
              x:
                `${multiPlatePositioning.movement.maxAbsDeltaX || 0} mm`,

              y:
                `${multiPlatePositioning.movement.maxAbsDeltaY || 0} mm`,
            }
          : null,

      duration:
        Number.isFinite(multiPlatePositioning.durationMs)
          ? `${multiPlatePositioning.durationMs} ms`
          : null,
    });

    if (multiPlatePositioning.problemPlateIds?.length) {
      console.log(
        'problem plates:',
        multiPlatePositioning.problemPlateIds
      );
    }

    if (multiPlatePositioning.warnings?.length) {
      console.log(
        'warnings:',
        multiPlatePositioning.warnings
      );
    }
  }

  console.groupEnd();

  console.groupCollapsed('automatic project adjustments');

  console.log(
    'applied actions:',
    compatibility.actions || []
  );

  console.log(
    'warnings:',
    compatibility.warnings || []
  );

  console.groupEnd();

  if (deepDebugReport) {
    logU1DeepDiagnostics(project);
  }

  console.groupEnd();
}

function logU1PerformanceReport(
  performanceData,
  parserPerformance,
  multiPlatePositioning = null
) {
  if (!performanceData) return;

  const timings = performanceData.timings || {};

  const formatMs = value => {
    if (!Number.isFinite(value)) return null;

    return value >= 1000
      ? `${(value / 1000).toFixed(2)} s`
      : `${value.toFixed(2)} ms`;
  };

  const formatBytes = value => {
    if (!Number.isFinite(value)) return null;

    const units = ['B', 'KB', 'MB', 'GB'];

    let size = value;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
  };

  console.groupCollapsed('performance');

  console.table([
    {
      stage: 'Project parse',
      duration: formatMs(timings.projectParseMs),
    },
    {
      stage: 'Build U1 project',
      duration: formatMs(timings.projectBuildMs),
    },
    {
      stage: 'Metadata rewrite',
      duration: formatMs(timings.metadataRewriteMs),
    },
    {
      stage: 'Multi-plate positioning',
      duration: formatMs(multiPlatePositioning?.durationMs),
    },
    {
      stage: 'Copy ZIP entries',
      duration: formatMs(timings.zipEntryCopyMs),
    },
    {
      stage: 'Generate output ZIP',
      duration: formatMs(timings.zipGenerateMs),
    },
    {
      stage: 'Total',
      duration: formatMs(timings.totalMs),
    },
  ]);

  console.log('ZIP statistics:', {
    inputSize: formatBytes(performanceData.inputBytes),
    outputSize: formatBytes(performanceData.outputBytes),

    zipEntries: performanceData.zipEntryCount ?? null,
    copiedFiles: performanceData.copiedFileCount ?? null,
    rewrittenFiles: performanceData.rewrittenFileCount ?? null,
    directories: performanceData.directoryCount ?? null,

    skippedUnsafeFiles:
      performanceData.skippedUnsafeFileCount ?? null,

    compression: performanceData.compression || null,
  });

  if (parserPerformance) {
    const parserTimings = parserPerformance.timings || {};
    const bambuStatistics = parserPerformance.bambu || {};

    console.groupCollapsed('parser performance');

    console.table([
      {
        stage: 'Collect ZIP entries',
        duration: formatMs(parserTimings.collectEntriesMs),
      },
      {
        stage: 'Group ZIP entries',
        duration: formatMs(parserTimings.collectGroupsMs),
      },
      {
        stage: 'Project settings',
        duration: formatMs(parserTimings.projectSettingsMs),
      },
      {
        stage: 'Slice info',
        duration: formatMs(parserTimings.sliceInfoMs),
      },
      {
        stage: 'Model settings',
        duration: formatMs(parserTimings.modelSettingsMs),
      },
      {
        stage: 'Main 3D model',
        duration: formatMs(parserTimings.mainModelMs),
      },
      {
        stage: 'Layer heights profile',
        duration: formatMs(parserTimings.layerHeightsProfileMs),
      },
      {
        stage: 'Link model objects',
        duration: formatMs(parserTimings.linkObjectsMs),
      },
      {
        stage: 'Model analysis',
        duration: formatMs(parserTimings.modelAnalysisMs),
      },
      {
        stage: 'Bambu diagnostics',
        duration: formatMs(parserTimings.bambuDiagnosticsMs),
      },
      {
        stage: 'Source filament parsing',
        duration: formatMs(parserTimings.sourceFilamentsMs),
      },
      {
        stage: 'Feature analysis',
        duration: formatMs(parserTimings.featureAnalysisMs),
      },
      {
        stage: 'Assemble project object',
        duration: formatMs(parserTimings.assembleProjectMs),
      },
      {
        stage: 'Parser total',
        duration: formatMs(parserTimings.totalMs),
      },
    ]);

    console.log('Bambu diagnostics statistics:', {
      candidateFiles: bambuStatistics.candidateFiles ?? null,
      parsedFiles: bambuStatistics.parsedFiles ?? null,
      textLikeFiles: bambuStatistics.textLikeFiles ?? null,
      xmlFiles: bambuStatistics.xmlFiles ?? null,
      jsonFiles: bambuStatistics.jsonFiles ?? null,

      textSize:
        formatBytes(bambuStatistics.textCharacters),

      textCharacters:
        bambuStatistics.textCharacters ?? null,

      filesWithPaint:
        bambuStatistics.filesWithPaint ?? null,

      filesWithInterestingAttributes:
        bambuStatistics.filesWithInterestingAttributes ?? null,
    });

    console.groupEnd();
  }

  console.groupEnd();
}

function buildU1OutputDownloadReportText(downloadReport) {
  return [
    'Output download:',
    `Configured method: ${downloadReport.configuredDownloadMethod}`,
    `Actual transport: ${downloadReport.downloadMethod}`,
    `Status: ${downloadReport.status}`,
    `Expected filename: ${downloadReport.finalFilename}`,
    `Filename forcing applied: ${downloadReport.filenameForced ? 'yes' : 'no'}`,
    'Download completion is not confirmed; check browser downloads.',
    'Attempts:',
    JSON.stringify(downloadReport.attempts, null, 2),
  ].join('\n');
}

function logU1OutputDownloadReport(
  downloadReport
) {
  if (!downloadReport) return;

  const attempts =
    Array.isArray(
      downloadReport.attempts
    )
      ? downloadReport.attempts
      : [];

  const successfulAttempt =
    attempts.find(
      attempt =>
        attempt.result === 'accepted'
    ) ||
    null;

  console.groupCollapsed(
    '[U1 Project Report] output download'
  );

  console.log('summary:', {
    browser:
      downloadReport.browser ||
      null,

    configuredDownloadMethod:
      downloadReport.configuredDownloadMethod || null,

    downloadMethod:
      downloadReport.downloadMethod || null,

    status:
      downloadReport.status || null,

    // null means a native click was initiated without an acceptance receipt.
    // true means API acceptance, never confirmed completion on disk.
    success:
      downloadReport.success ?? null,

    expectedFilename:
      downloadReport.finalFilename ||
      downloadReport.originalFilename ||
      null,

    forceFilename:
      downloadReport.forceFilename ===
      true,

    filenameForced:
      downloadReport.filenameForced ===
      true,

    downloadId:
      successfulAttempt?.downloadId ??
      null,
  });

  console.log('attempts:', attempts);

  if (
    downloadReport.fallbackUsed ===
    true
  ) {
    console.log(
      'filename normalization:',
      {
        original:
          downloadReport.originalFilename ||
          null,

        normalized:
          downloadReport.fallbackFilename ||
          null,
      }
    );
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

      sourcePrintSettingsId:
        processPreset.source_print_settings_id ||
        null,

      sourceDefaultPrintProfile:
        processPreset.source_default_print_profile ||
        null,

      forcedProfile:
        processPreset.resolved_u1_profile ||
        null,

      forcedProfileId:
        processPreset.forcedProfileId ||
        null,

      ignoredSource:
        processPreset.source_ignored ||
        processPreset.source_default_print_profile ||
        processPreset.source_print_settings_id ||
        null,

      resolvedU1Profile:
        processPreset.resolved_u1_profile ||
        null,

      reason:
        'User selected Force U1 print profile',
    };
  }

  return {
    mode: 'Preserve source print profile',

    sourcePrintSettingsId:
      processPreset.source_print_settings_id ||
      null,

    sourceDefaultPrintProfile:
      processPreset.source_default_print_profile ||
      null,

    selectedSource:
      processPreset.selected_source_profile ||
      null,

    resolvedU1Profile:
      processPreset.resolved_u1_profile ||
      null,

    detection:
      processPreset.selection_reason ||
      null,

    layerFallback:
      processPreset.layer_fallback === true,

    fallback:
      processPreset.fallback === true,
  };
}

function logU1DeepDiagnostics(project) {
  console.groupCollapsed('[U1 Deep Diagnostics]');

  const processMerge  = project.analysis?.processMerge || {};

  console.groupCollapsed('bambu diagnostics');

  const bambuSummary = project.analysis?.bambu?.summary || {};
  const bambuFiles = project.analysis?.bambu?.files || [];

  console.log('summary:', {
    hasPaint:
      project.analysis?.features?.hasPaint ?? false,

    metadataFiles:
      bambuSummary.metadataFiles?.length || 0,

    relationshipFiles:
      bambuSummary.relationshipFiles?.length || 0,

    modelFiles:
      bambuSummary.modelFiles?.length || 0,

    filesWithNamespaces:
      bambuSummary.filesWithNamespaces?.length || 0,

    filesWithBambuAttributes:
      bambuSummary.filesWithBambuAttributes?.length || 0,

    xmlFiles:
      bambuSummary.xmlFiles?.length || 0,

    jsonFiles:
      bambuSummary.jsonFiles?.length || 0,
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

// -----------------------------------------------------------------------------
// Copy-ready project report
// -----------------------------------------------------------------------------

function buildU1ProjectReportText(project, context = {}) {
  if (!project) return '';

  const model = project.analysis?.model || {};
  const features = project.analysis?.features || {};
  const compatibility = project.compatibility || {};
  const printerProfile =
    project.analysis?.customPrinterProfile || {};

  const processPreset =
    project.analysis?.processPreset || {};

  const processMerge =
    project.analysis?.processMerge || {};

  const multiPlate =
    project.analysis?.multiPlatePositioning || null;

  const performance =
    project.converter?.performance || {};

  const options = project.options || {};

  const targetSlicer =
    options.orcaCompatibility === true ||
    printerProfile.compatibilityMode === 'orca'
      ? 'OrcaSlicer'
      : 'Snapmaker Orca';

  const lines = [
    'MakerWorld to Snapmaker U1 — Project Report',
    '',
    `Extension version: ${project.converter?.version || 'unknown'}`,
    `Source: ${context.source || 'unknown'}`,
    `Filename: ${context.filename || 'unknown'}`,
    `Target slicer: ${targetSlicer}`,
    '',
    '=== Project Summary ===',

    `Files: ${project.stats?.fileCount ?? 'unknown'}`,
    `Metadata files: ${project.stats?.metadataCount ?? 'unknown'}`,
    `Model files: ${project.stats?.modelCount ?? 'unknown'}`,
    `Thumbnail files: ${project.stats?.thumbnailCount ?? 'unknown'}`,

    '',
    `Objects: ${model.objectCount ?? 'unknown'}`,
    `Build items: ${model.buildItemCount ?? 'unknown'}`,
    `Mesh objects: ${model.meshObjectCount ?? 'unknown'}`,
    `Component objects: ${model.componentObjectCount ?? 'unknown'}`,

    '',
    `Base material groups: ${model.baseMaterialGroupCount ?? 'unknown'}`,
    `Base materials: ${model.baseMaterialCount ?? 'unknown'}`,
    `Color groups: ${model.colorGroupCount ?? 'unknown'}`,
    `Colors: ${model.colorCount ?? 'unknown'}`,

    '',
    `Vertices: ${model.totalVertices ?? 'unknown'}`,
    `Triangles: ${model.totalTriangles ?? 'unknown'}`,

    '',
    `Supports: ${features.hasSupport === true}`,
    `Variable layer height: ${features.hasAdaptiveLayer === true}`,
    `Multi-color: ${features.hasMultiColor === true}`,
    `Multi-material: ${features.hasMultiMaterial === true}`,
    '',
    '=== Converter Settings ===',
  ];

  const reportOptions =
    formatConverterOptionsForReport(options);

  for (const [key, value] of Object.entries(reportOptions)) {
    lines.push(`${key}: ${value}`);
  }

  lines.push(
    '',
    '=== Filaments ===',
    `Source filaments: ${project.filaments?.source?.length || 0}`,
    `Final filament slots: ${project.filaments?.mapped?.ids?.length || 0}`,
    `Filament preset mode: ${options.filamentPresetMode || 'preserve'}`
  );

  const sourceSettings =
    project.original?.settings || {};

  const finalSettings =
    project.u1?.settings || {};

  const sourceFilamentCount =
    project.filaments?.source?.length || 0;

  const filamentCount = Math.max(
    typeof TARGET_FILAMENTS === 'number' ? TARGET_FILAMENTS : 0,
    sourceFilamentCount,
    project.filaments?.mapped?.ids?.length || 0,
    sourceSettings.filament_settings_id?.length || 0,
    finalSettings.filament_settings_id?.length || 0
  );

  const formatFilamentValue = value => {
    if (value === undefined || value === null || value === '') {
      return 'not specified';
    }

    return String(value);
  };

  for (let i = 0; i < filamentCount; i++) {
    const isAdditionalSlot =
      i >= sourceFilamentCount;

    const presetAnalysis =
      project.analysis?.filamentPreset?.slots?.find(
        entry => entry.slot === i + 1
      );

    lines.push(
      '',
      `Filament slot ${i + 1}:`,
      `  Slot type: ${isAdditionalSlot ? 'Additional target slot' : 'Source filament'}`,
      `  Preset action: ${presetAnalysis?.action || 'not recorded'}`,

      `  Source preset: ${
        isAdditionalSlot
          ? 'not applicable'
          : formatFilamentValue(sourceSettings.filament_settings_id?.[i])
      }`,

      `  Final preset: ${formatFilamentValue(finalSettings.filament_settings_id?.[i])}`,

      `  Source vendor: ${
        isAdditionalSlot
          ? 'not applicable'
          : formatFilamentValue(sourceSettings.filament_vendor?.[i])
      }`,

      `  Final vendor: ${formatFilamentValue(finalSettings.filament_vendor?.[i])}`,

      `  Source type: ${
        isAdditionalSlot
          ? 'not applicable'
          : formatFilamentValue(sourceSettings.filament_type?.[i])
      }`,

      `  Final type: ${formatFilamentValue(finalSettings.filament_type?.[i])}`,

      `  Source color: ${
        isAdditionalSlot
          ? 'not applicable'
          : formatFilamentValue(sourceSettings.filament_colour?.[i])
      }`,

      `  Final color: ${formatFilamentValue(finalSettings.filament_colour?.[i])}`
    );
  }

  // Printer profile details
  const targetNozzle =
    project.analysis?.targetNozzle || {};

  const requestedPrinterProfile =
    printerProfile.requested ||
    (typeof U1_CUSTOM_PRINTER_STANDARD_ID !== 'undefined'
      ? U1_CUSTOM_PRINTER_STANDARD_ID
      : 'standard');

  const standardPrinterProfileSelected =
    typeof U1_CUSTOM_PRINTER_STANDARD_ID !== 'undefined' &&
    requestedPrinterProfile === U1_CUSTOM_PRINTER_STANDARD_ID;

  const printerProfileMode =
    standardPrinterProfileSelected
      ? 'standard'
      : 'custom';

  lines.push(
    '',
    '=== Printer Profile ===',

    `Mode: ${printerProfileMode}`,
    `Requested: ${requestedPrinterProfile}`,
    `Selected: ${printerProfile.selected || finalSettings.printer_settings_id || 'unknown'}`,
    `Inherited from: ${printerProfile.inheritedFrom || 'none'}`,

    '',
    `Target nozzle: ${
      targetNozzle.nozzleDiameter != null
        ? `${targetNozzle.nozzleDiameter} mm`
        : 'unknown'
    }`,
    `Target nozzle source: ${targetNozzle.source || 'unknown'}`,
    `Process profile asset: ${targetNozzle.processProfileId || 'unknown'}`,

    '',
    `Machine index: ${printerProfile.machineIndex ?? 'unknown'}`,
    `Custom profile applied: ${
      !standardPrinterProfileSelected &&
      (printerProfile.overrideCount || 0) > 0
    }`,
    `Custom overrides: ${printerProfile.overrideCount || 0}`,
    `Missing profile: ${printerProfile.missing === true}`
  );

  // Custom printer profile override diagnostics
  const appliedPrinterOverrides =
    printerProfile.applied || [];

  const skippedPrinterOverrides =
    printerProfile.skipped || [];

  lines.push(
    '',
    `Applied overrides: ${appliedPrinterOverrides.length}`,
    `Skipped overrides: ${skippedPrinterOverrides.length}`
  );

  if (appliedPrinterOverrides.length) {
    lines.push(
      '',
      'Applied override details:'
    );

    for (const entry of appliedPrinterOverrides) {
      if (typeof entry === 'string') {
        lines.push(`  - ${entry}`);
        continue;
      }

      lines.push(
        `  - ${entry.key || 'unknown'} (${entry.valueType || 'unknown'})`
      );
    }
  }

  if (skippedPrinterOverrides.length) {
    lines.push(
      '',
      'Skipped override details:'
    );

    for (const entry of skippedPrinterOverrides) {
      if (typeof entry === 'string') {
        lines.push(`  - ${entry}`);
        continue;
      }

      lines.push(
        `  - ${entry.key || 'unknown'}`,
        `    Reason: ${entry.reason || 'not specified'}`
      );

      if (entry.valueType) {
        lines.push(
          `    Value type: ${entry.valueType}`
        );
      }
    }
  }

  lines.push(
    '',
    '=== Print Profile ==='
  );

  const printSummary =
    formatPrintProfileSummaryForReport(processPreset);

  for (const [key, value] of Object.entries(printSummary)) {
    lines.push(`${key}: ${value}`);
  }

  // Process settings protected by a forced print profile.
  const lockedByForcedProfile =
    (processMerge.skipped || []).filter(
      entry => entry.reason === 'locked-by-forced-print-profile'
    );

  const otherSkippedSettings =
    (processMerge.skipped || []).filter(
      entry => entry.reason !== 'locked-by-forced-print-profile'
    );

  lines.push(
    '',
    '=== Process Merge ===',
    `Mode: ${processMerge.mode || 'unknown'}`,
    `Strict: ${processMerge.strict === true}`,
    `Candidates: ${processMerge.candidates?.length || 0}`,
    `Merged settings: ${processMerge.merged?.length || 0}`,
    `Locked by forced profile: ${lockedByForcedProfile.length}`,
    `Blocked settings: ${processMerge.blocked?.length || 0}`,
    `Skipped settings: ${otherSkippedSettings.length}`
  );

  // Format process merge entries as readable text instead of JSON.
  const appendProcessMergeDetails = (title, entries) => {
    if (!entries?.length) return;

    lines.push('', title);

    for (const entry of entries) {
      lines.push(
        '',
        `  ${entry.key || 'Unknown setting'}:`,
        `    Source value: ${entry.sourceValue ?? 'not specified'}`,
        `    Final value: ${entry.finalValue ?? 'not specified'}`,
        `    Category: ${entry.category || 'unknown'}`,
        `    Reason: ${entry.reason || 'not specified'}`
      );

      if (entry.blocked !== undefined) {
        lines.push(
          `    Blocked: ${entry.blocked}`
        );
      }

      if (entry.existsInU1Template !== undefined) {
        lines.push(
          `    Exists in U1 template: ${entry.existsInU1Template}`
        );
      }

      if (entry.portableByHeuristic !== undefined) {
        lines.push(
          `    Portable by heuristic: ${entry.portableByHeuristic}`
        );
      }
    }
  };

  appendProcessMergeDetails(
    'Merged setting details:',
    processMerge.merged
  );

  appendProcessMergeDetails(
    'Blocked setting details:',
    processMerge.blocked
  );

  appendProcessMergeDetails(
    'Locked by forced print profile:',
    lockedByForcedProfile
  );

  appendProcessMergeDetails(
    'Other skipped setting details:',
    otherSkippedSettings
  );

  lines.push(
    '',
    '=== Multi-Plate Positioning ===',

    `Available: ${multiPlate !== null}`,
    `Enabled: ${multiPlate?.enabled ?? 'unknown'}`,
    `Detected: ${multiPlate?.detected ?? 'unknown'}`,
    `Applied: ${multiPlate?.applied ?? 'unknown'}`,
    `Reason: ${multiPlate?.reason || 'none'}`,

    '',
    `Plates: ${multiPlate?.plateCount ?? 'unknown'}`,
    `Adjusted plates: ${multiPlate?.adjustedPlateCount ?? 0}`,
    `Adjusted instances: ${multiPlate?.adjustedInstanceCount ?? 0}`,
    `Unresolved instances: ${multiPlate?.unresolvedInstanceCount ?? 0}`,
    `Skipped plates: ${multiPlate?.skippedPlateCount ?? 0}`,
    `Skipped instances: ${multiPlate?.skippedInstanceCount ?? 0}`
  );

  // Source printer and build plate
  if (multiPlate?.source) {
    lines.push(
      '',
      'Source printer:',
      `  Model: ${multiPlate.source.printerModel || 'unknown'}`,
      `  Bed size: ${multiPlate.source.width ?? 'unknown'} × ${multiPlate.source.height ?? 'unknown'} mm`,
      `  Grid step: ${multiPlate.source.gridStepX ?? 'unknown'} × ${multiPlate.source.gridStepY ?? 'unknown'} mm`
    );
  }

  // Target printer and build plate
  if (multiPlate?.target) {
    lines.push(
      '',
      'Target printer:',
      `  Model: ${multiPlate.target.printerModel || 'unknown'}`,
      `  Bed size: ${multiPlate.target.width ?? 'unknown'} × ${multiPlate.target.height ?? 'unknown'} mm`,
      `  Grid step: ${multiPlate.target.gridStepX ?? 'unknown'} × ${multiPlate.target.gridStepY ?? 'unknown'} mm`
    );
  }

  // Grid calculations
  if (multiPlate) {
    lines.push(
      '',
      `Grid factor: ${multiPlate.gridFactor ?? 'unknown'}`
    );
  }

  if (multiPlate?.centerOffset) {
    lines.push(
      '',
      'Center offset:',
      `  X: ${multiPlate.centerOffset.x ?? 0} mm`,
      `  Y: ${multiPlate.centerOffset.y ?? 0} mm`
    );
  }

  if (multiPlate?.gridDifference) {
    lines.push(
      '',
      'Grid difference:',
      `  X: ${multiPlate.gridDifference.x ?? 0} mm`,
      `  Y: ${multiPlate.gridDifference.y ?? 0} mm`
    );
  }

  // Detected plate grid
  if (multiPlate?.grid) {
    const grid = multiPlate.grid;

    lines.push(
      '',
      'Detected grid:',
      `  Columns: ${
        grid.minColumn != null && grid.maxColumn != null
          ? `${grid.minColumn} → ${grid.maxColumn}`
          : 'unknown'
      }`,
      `  Rows: ${
        grid.minRow != null && grid.maxRow != null
          ? `${grid.minRow} → ${grid.maxRow}`
          : 'unknown'
      }`,
      `  Cells: ${grid.detectedCells ?? 0}`
    );
  }

  // Maximum movement applied to instances
  if (multiPlate?.movement) {
    lines.push(
      '',
      'Maximum movement:',
      `  X: ${multiPlate.movement.maxAbsDeltaX ?? 0} mm`,
      `  Y: ${multiPlate.movement.maxAbsDeltaY ?? 0} mm`
    );
  }

  // Processing duration
  if (Number.isFinite(multiPlate?.durationMs)) {
    lines.push(
      '',
      `Processing duration: ${multiPlate.durationMs.toFixed(2)} ms`
    );
  }

  // Plates that could not be processed correctly
  if (multiPlate?.problemPlateIds?.length) {
    lines.push(
      '',
      'Problem plates:',
      ...multiPlate.problemPlateIds.map(
        plateId => `  - ${plateId}`
      )
    );
  }

  // Multi-plate-specific warnings
  if (multiPlate?.warnings?.length) {
    lines.push(
      '',
      'Multi-plate warnings:',
      ...multiPlate.warnings.map(
        warning =>
          `  - ${
            typeof warning === 'string'
              ? warning
              : JSON.stringify(warning)
          }`
      )
    );
  }

  lines.push(
    '',
    '=== Automatic Project Adjustments ===',
    `Applied actions: ${compatibility.actions?.length || 0}`,
    `Warnings: ${compatibility.warnings?.length || 0}`
  );

  // Format automatic adjustments and warnings as readable text.
  const appendCompatibilityDetails = (title, entries) => {
    if (!entries?.length) return;

    lines.push('', title);

    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') {
        lines.push('', `  - ${String(entry)}`);
        continue;
      }

      lines.push(
        '',
        `  ${entry.id || entry.code || 'Entry'}:`
      );

      for (const [key, value] of Object.entries(entry)) {
        if (key === 'id' || key === 'code') continue;

        const label = key
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/_/g, ' ')
          .replace(/^./, char => char.toUpperCase());

        const formattedValue =
          value !== null && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);

        lines.push(`    ${label}: ${formattedValue}`);
      }
    }
  };

  appendCompatibilityDetails(
    'Applied action details:',
    compatibility.actions
  );

  appendCompatibilityDetails(
    'Warning details:',
    compatibility.warnings
  );

  // Human-readable file sizes.
  const formatReportBytes = value => {
    if (!Number.isFinite(value)) return 'unknown';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
  };

  lines.push(
    '',
    '=== Performance ===',

    `Conversion time: ${project.converter?.conversionMs ?? 'unknown'} ms`,

    '',
    'ZIP statistics:',
    `  Input size: ${formatReportBytes(performance.inputBytes)} (${performance.inputBytes ?? 'unknown'} bytes)`,
    `  Output size: ${formatReportBytes(performance.outputBytes)} (${performance.outputBytes ?? 'unknown'} bytes)`,

    '',
    `  ZIP entries: ${performance.zipEntryCount ?? 'unknown'}`,
    `  Copied files: ${performance.copiedFileCount ?? 'unknown'}`,
    `  Rewritten files: ${performance.rewrittenFileCount ?? 'unknown'}`,
    `  Directories: ${performance.directoryCount ?? 'unknown'}`,
    `  Skipped unsafe files: ${performance.skippedUnsafeFileCount ?? 'unknown'}`,
    `  Compression: ${performance.compression || 'unknown'}`
  );

  if (performance.timings) {
    const stageNames = {
      projectParseMs: 'Project parse',
      projectBuildMs: 'Build U1 project',
      metadataRewriteMs: 'Metadata rewrite',
      zipEntryCopyMs: 'Copy ZIP entries',
      zipGenerateMs: 'Generate output ZIP',
      totalMs: 'Total'
    };

    lines.push('', 'Stage timings:');

    for (const [stage, duration] of Object.entries(performance.timings)) {
      const stageName = stageNames[stage] || stage;

      const formattedDuration =
        Number.isFinite(duration)
          ? duration >= 1000
            ? `${(duration / 1000).toFixed(2)} s`
            : `${duration.toFixed(2)} ms`
          : 'unknown';

      lines.push(`  ${stageName}: ${formattedDuration}`);
    }
  }

  return lines.join('\n');
}