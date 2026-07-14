// Parses the source 3MF into the shared Project object.
// Read-only: no conversion or rewriting happens here.

function normalize3mfPath(name) {
  return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isSafe3mfPath(name) {
  const safe = normalize3mfPath(name);
  return safe && !safe.startsWith('..') && !safe.includes('/../');
}

function collect3mfEntries(zip) {
  const entries = {};

  for (const name of Object.keys(zip.files)) {
    const entry = zip.file(name);
    if (!entry || entry.dir) continue;

    const safe = normalize3mfPath(name);
    if (!isSafe3mfPath(safe)) continue;

    entries[safe] = {
      name,
      safe,
      entry,
      ext: safe.split('.').pop().toLowerCase(),
      folder: safe.includes('/') ? safe.split('/')[0] : '',
    };
  }

  return entries;
}

function collect3mfGroups(entries) {
  const groups = {
    metadata: [],
    models: [],
    thumbnails: [],
    relationships: [],
    other: [],
  };

  for (const item of Object.values(entries)) {
    if (item.safe.startsWith('Metadata/')) {
      groups.metadata.push(item);
    } else if (item.safe.startsWith('3D/')) {
      groups.models.push(item);
    } else if (item.safe.startsWith('Thumbnails/')) {
      groups.thumbnails.push(item);
    } else if (item.safe.startsWith('_rels/') || item.safe.endsWith('.rels')) {
      groups.relationships.push(item);
    } else {
      groups.other.push(item);
    }
  }

  return groups;
}

async function readTextEntry(entry) {
  return entry ? await entry.async('string') : null;
}

async function parseProjectSettings(files) {
  const entry = files.projectSettings?.entry || null;

  if (!entry) {
    throw new Error('Missing Metadata/project_settings.config');
  }

  const settingsStr = await readTextEntry(entry);

  return {
    entry,
    settingsStr,
    settings: JSON.parse(settingsStr),
  };
}

async function parseSliceInfo(files) {
  const entry = files.sliceInfo?.entry || null;

  if (!entry) {
    return {
      entry: null,
      sliceInfoStr: null,
      sliceInfoDoc: null,
      filaments: [],
    };
  }

  const sliceInfoStr = await readTextEntry(entry);
  const sliceInfoDoc = parseXml(sliceInfoStr);

  return {
    entry,
    sliceInfoStr,
    sliceInfoDoc,
    filaments: parseFilamentsFromSliceInfo(sliceInfoStr),
  };
}

async function parseModelSettings(files) {
  const entry = files.modelSettings?.entry || null;

  if (!entry) {
    return {
      entry: null,
      modelSettingsStr: null,
      modelSettingsDoc: null,
      objects: [],
    };
  }

  const modelSettingsStr = await readTextEntry(entry);
  const modelSettingsDoc = parseXml(modelSettingsStr);

  return {
    entry,
    modelSettingsStr,
    modelSettingsDoc,
    objects: parseModelSettingsObjects(modelSettingsDoc),
  };
}

function parseModelSettingsObjects(modelSettingsDoc) {
  if (!modelSettingsDoc) return [];

  const objects = [];

  modelSettingsDoc.querySelectorAll('object').forEach((objectNode, objectIndex) => {
    const object = {
      index: objectIndex,
      id: objectNode.getAttribute('id'),
      name: objectNode.getAttribute('name') || '',
      metadata: {},
      parts: [],
    };

    objectNode.querySelectorAll(':scope > metadata').forEach(meta => {
      const key = meta.getAttribute('key');
      if (!key) return;
      object.metadata[key] = meta.getAttribute('value');
    });

    objectNode.querySelectorAll(':scope > part').forEach((partNode, partIndex) => {
      const part = {
        index: partIndex,
        id: partNode.getAttribute('id'),
        name: partNode.getAttribute('name') || '',
        metadata: {},
      };

      partNode.querySelectorAll(':scope > metadata').forEach(meta => {
        const key = meta.getAttribute('key');
        if (!key) return;
        part.metadata[key] = meta.getAttribute('value');
      });

      object.parts.push(part);
    });

    objects.push(object);
  });

  return objects;
}

function linkModelSettingsTo3DModel(model, modelSettings) {
  const settingsObjects = modelSettings?.objects || [];
  const modelObjects    = model?.resources?.objects || [];
  const buildItems      = model?.build || [];

  return settingsObjects.map((settingsObject, index) => {
    const modelObject =
      modelObjects.find(o => o.id === settingsObject.id) ||
      modelObjects[index] ||
      null;

    const buildItem =
      buildItems.find(b => b.objectId === settingsObject.id) ||
      (modelObject ? buildItems.find(b => b.objectId === modelObject.id) : null) ||
      buildItems[index] ||
      null;

    return {
      ...settingsObject,

      modelObjectId: modelObject?.id || null,
      buildObjectId: buildItem?.objectId || null,

      modelObject,
      buildItem,

      linked: !!modelObject || !!buildItem,
    };
  });
}

function analyzeParsedProjectModel(model, linkedObjects) {
  const modelObjects = model?.resources?.objects || [];
  const buildItems   = model?.build || [];
  const linked       = linkedObjects || [];

  const meshObjects      = modelObjects.filter(o => o.hasMesh);
  const componentObjects = modelObjects.filter(o => o.hasComponents);
  const unlinkedSettings = linked.filter(o => !o.linked);
  const basematerials = model?.resources?.basematerials || [];
  const colorgroups   = model?.resources?.colorgroups || [];

  return {
    objectCount: modelObjects.length,
    buildItemCount: buildItems.length,
    meshObjectCount: meshObjects.length,
    componentObjectCount: componentObjects.length,

    baseMaterialGroupCount: basematerials.length,
    baseMaterialCount: basematerials.reduce((sum, group) => sum + (group.bases?.length || 0), 0),

    colorGroupCount: colorgroups.length,
    colorCount: colorgroups.reduce((sum, group) => sum + (group.colors?.length || 0), 0),

    hasComponents: componentObjects.length > 0,
    hasBaseMaterials: basematerials.length > 0,
    hasColorGroups: colorgroups.length > 0,
    hasBuildItems: buildItems.length > 0,
    hasUnlinkedSettingsObjects: unlinkedSettings.length > 0,

    unlinkedSettingsObjectIds: unlinkedSettings.map(o => o.id).filter(Boolean),

    totalVertices: meshObjects.reduce((sum, o) => sum + (o.mesh?.vertexCount || 0), 0),
    totalTriangles: meshObjects.reduce((sum, o) => sum + (o.mesh?.triangleCount || 0), 0),
  };
}

function analyzeProjectFeatures(projectLike) {
  const model = projectLike.model || {};
  const modelAnalysis = projectLike.modelAnalysis || {};
  const settings = projectLike.projectSettings?.settings || {};
  const modelSettings = projectLike.modelSettings || {};
  const bambuDiagnostics = projectLike.bambuDiagnostics || {};
  const layerHeightsProfile = projectLike.layerHeightsProfile || {};

  const bambuFiles = bambuDiagnostics.files || [];
  const paintInfo = bambuFiles
    .map(f => f.paintColorAnalysis)
    .find(p => p && p.paintedTriangleCount > 0);

  const interestingAttributes = bambuFiles
    .flatMap(f => f.interestingAttributes || []);

  const hasSupport =
    String(settings.enable_support || '') === '1' ||
    String(settings.support_type || '').length > 0;

  const hasAdaptiveLayer =
    settings.adaptive_layer_height === '1' ||
    settings.enable_adaptive_layer_height === '1' ||
    settings.variable_layer_height === '1' ||
    settings.layer_height_table !== undefined ||
    layerHeightsProfile.hasVariableLayerHeights === true;

  const definedFilaments = projectLike.sourceFilaments || [];
  const usedFilamentsKnown = definedFilaments.some(f => f.used !== null);
  const usedFilaments = usedFilamentsKnown
    ? definedFilaments.filter(f => f.used)
    : definedFilaments;

  const usedTypes = Array.from(new Set(
    usedFilaments.map(f => String(f.type || '').trim()).filter(Boolean)
  ));

  const usedColors = Array.from(new Set(
    usedFilaments.map(f => String(f.color || '').trim()).filter(Boolean)
  ));

  const hasMultiColor = usedFilaments.length > 1 || !!paintInfo;
  const hasMultiMaterial = usedTypes.length > 1;

  const hasPaint =
    !!paintInfo ||
    interestingAttributes.some(a =>
      String(a.attribute || '').toLowerCase().includes('paint')
    );

  const hasModifierHints =
    interestingAttributes.some(a =>
      String(a.attribute || '').toLowerCase().includes('modifier') ||
      String(a.attribute || '').toLowerCase().includes('negative')
    );

  return {
    hasPaint,
    hasMultiColor,
    hasMultiMaterial,
    hasSupport,
    hasAdaptiveLayer,
    hasComponents: !!modelAnalysis.hasComponents,
    hasBaseMaterials: !!modelAnalysis.hasBaseMaterials,
    hasColorGroups: !!modelAnalysis.hasColorGroups,
    hasModifierHints,

    paint: paintInfo ? {
      paintedTriangleCount: paintInfo.paintedTriangleCount,
      paintCoveragePercent: paintInfo.paintCoveragePercent,
      uniqueChars: paintInfo.uniqueChars,
    } : null,

    filaments: {
      definedCount: definedFilaments.length,
      usedKnown: usedFilamentsKnown,
      usedCount: usedFilaments.length,
      usedIds: usedFilaments.map(f => f.id),
      usedTypes,
      usedColors,
      multiColor: hasMultiColor,
      multiMaterial: hasMultiMaterial,
    },

    layerHeightsProfile: layerHeightsProfile.exists ? {
      objectCount: layerHeightsProfile.objectCount,
      uniqueValueCount: layerHeightsProfile.uniqueValueCount,
      minValue: layerHeightsProfile.minValue,
      maxValue: layerHeightsProfile.maxValue,
      hasVariableLayerHeights: layerHeightsProfile.hasVariableLayerHeights,
    } : null,

    notes: [
      hasPaint ? 'Bambu paint data detected and preserved as-is.' : null,
      hasMultiColor ? 'Multi-color project detected.' : null,
      hasMultiMaterial ? 'Multi-material project detected.' : null,
      hasAdaptiveLayer ? 'Adaptive/variable layer height detected.' : null,
      hasModifierHints ? 'Modifier/negative-part related XML hints detected.' : null,
    ].filter(Boolean),
  };
}

async function parseProject(zip, options = {}) {
  const parserStartedAt = performance.now();
  const parserTimings = {};

  const measureAsync = async (key, fn) => {
    const startedAt = performance.now();

    try {
      return await fn();
    } finally {
      parserTimings[key] = performance.now() - startedAt;
    }
  };

  const measureSync = (key, fn) => {
    const startedAt = performance.now();

    try {
      return fn();
    } finally {
      parserTimings[key] = performance.now() - startedAt;
    }
  };

  const entries = measureSync(
    'collectEntriesMs',
    () => collect3mfEntries(zip)
  );

  const groups = measureSync(
    'collectGroupsMs',
    () => collect3mfGroups(entries)
  );

  const files = {
    projectSettings: entries['Metadata/project_settings.config'] || null,
    modelSettings: entries['Metadata/model_settings.config'] || null,
    sliceInfo: entries['Metadata/slice_info.config'] || null,
    model: entries['3D/3dmodel.model'] || null,
    layerHeightsProfile:
      entries['Metadata/layer_heights_profile.txt'] || null,

    thumbnails: groups.thumbnails,
    relationships: groups.relationships,
    metadata: groups.metadata,
    models: groups.models,
    other: groups.other,
  };

  const projectSettings = await measureAsync(
    'projectSettingsMs',
    () => parseProjectSettings(files)
  );

  const sliceInfo = await measureAsync(
    'sliceInfoMs',
    () => parseSliceInfo(files)
  );

  const modelSettings = await measureAsync(
    'modelSettingsMs',
    () => parseModelSettings(files)
  );

  const model = await measureAsync(
    'mainModelMs',
    () => parse3DModel(files)
  );

  const layerHeightsProfile = await measureAsync(
    'layerHeightsProfileMs',
    () => parseLayerHeightsProfile(files)
  );

  const linkedObjects = measureSync(
    'linkObjectsMs',
    () => linkModelSettingsTo3DModel(model, modelSettings)
  );

  const modelAnalysis = measureSync(
    'modelAnalysisMs',
    () => analyzeParsedProjectModel(model, linkedObjects)
  );

  let bambuDiagnostics = {
    files: [],

    summary: {
      metadataFiles: [],
      relationshipFiles: [],
      modelFiles: [],
      filesWithNamespaces: [],
      filesWithBambuAttributes: [],
      xmlFiles: [],
      jsonFiles: [],
    },

    skipped: true,
    reason: 'Deep debug report is disabled.',
  };

  if (options.deepDebugReport === true) {
    bambuDiagnostics = await measureAsync(
      'bambuDiagnosticsMs',
      () => parseBambu3mfDiagnostics({
        files,
      })
    );

    bambuDiagnostics.skipped = false;
  } else {
    parserTimings.bambuDiagnosticsMs = 0;
  }

  const parserWarnings = [];

  if (modelAnalysis.hasUnlinkedSettingsObjects) {
    parserWarnings.push(
      `Some model_settings objects could not be linked to 3D model objects: ${modelAnalysis.unlinkedSettingsObjectIds.join(', ')}`
    );
  }

  if (!modelAnalysis.hasBuildItems) {
    parserWarnings.push('3D model contains no build items.');
  }

  if (modelAnalysis.objectCount === 0) {
    parserWarnings.push('3D model contains no resource objects.');
  }

  const filamentStartedAt = performance.now();

  let sourceFilaments = sliceInfo.filaments;

  if (!sourceFilaments.length) {
    sourceFilaments = parseFilamentsFromProjectSettings(
      projectSettings.settingsStr
    );
  }

  parserTimings.sourceFilamentsMs =
    performance.now() - filamentStartedAt;

  const featureAnalysis = measureSync(
    'featureAnalysisMs',
    () => analyzeProjectFeatures({
      model,
      modelAnalysis,
      projectSettings,
      modelSettings,
      bambuDiagnostics,
      sourceFilaments,
      layerHeightsProfile,
    })
  );

  const bambuFiles = bambuDiagnostics.files || [];

  const bambuStatistics = {
    candidateFiles:
      groups.metadata.length +
      groups.relationships.length +
      groups.models.length,

    parsedFiles: bambuFiles.length,

    textLikeFiles:
      bambuFiles.filter(file => file.textLike === true).length,

    xmlFiles:
      bambuFiles.filter(file => file.looksXml === true).length,

    jsonFiles:
      bambuFiles.filter(file => file.looksJson === true).length,

    textCharacters:
      bambuFiles.reduce(
        (sum, file) => sum + (Number(file.size) || 0),
        0
      ),

    filesWithPaint:
      bambuFiles.filter(
        file => file.paintColorAnalysis?.paintedTriangleCount > 0
      ).length,

    filesWithInterestingAttributes:
      bambuFiles.filter(
        file => file.interestingAttributes?.length > 0
      ).length,
  };

  const assembleStartedAt = performance.now();

  const project = {
    zip,
    entries,
    groups,
    files,

    options: {
      ...(options || {}),
    },

    original: {
      settings: projectSettings.settings,
      settingsStr: projectSettings.settingsStr,

      projectSettingsEntry: projectSettings.entry,

      sliceInfoEntry: sliceInfo.entry,
      sliceEntry: sliceInfo.entry,
      sliceInfoStr: sliceInfo.sliceInfoStr,
      sliceInfoDoc: sliceInfo.sliceInfoDoc,

      modelSettingsEntry: modelSettings.entry,
      modelSettingsStr: modelSettings.modelSettingsStr,
      modelSettingsDoc: modelSettings.modelSettingsDoc,

      layerHeightsProfileEntry: layerHeightsProfile.entry,
      layerHeightsProfileStr: layerHeightsProfile.text,
    },

    printer: {},

    process: {
      source: projectSettings.settings,
    },

    model,

    analysis: {
      model: modelAnalysis,
      bambu: bambuDiagnostics,
      features: featureAnalysis,
      layerHeightsProfile,

      parserPerformance: {
        timings: parserTimings,
        bambu: bambuStatistics,
      },
    },

    filaments: {
      source: sourceFilaments,
      mapped: {
        colors: [],
        types: [],
        ids: [],
      },
    },

    objects: {
      modelEntries: groups.models,
      settings: modelSettings.objects,
      linked: linkedObjects,
    },

    metadata: {
      entries: groups.metadata,
      relationships: groups.relationships,
    },

    thumbnails: {
      entries: groups.thumbnails,
    },

    compatibility: {
      warnings: parserWarnings,
      actions: [],
    },

    stats: {
      fileCount: Object.keys(entries).length,
      metadataCount: groups.metadata.length,
      modelCount: groups.models.length,
      thumbnailCount: groups.thumbnails.length,
      relationshipCount: groups.relationships.length,
    },
  };

  parserTimings.assembleProjectMs =
    performance.now() - assembleStartedAt;

  parserTimings.totalMs =
    performance.now() - parserStartedAt;

  project.analysis.parserPerformance.timings =
    Object.fromEntries(
      Object.entries(parserTimings).map(([key, value]) => [
        key,
        Math.round(value * 100) / 100,
      ])
    );

  return project;
}

async function parseLayerHeightsProfile(files) {
  const entry = files.layerHeightsProfile?.entry || null;

  if (!entry) {
    return {
      entry: null,
      text: null,
      exists: false,
      size: 0,
      objectCount: 0,
      hasVariableLayerHeights: false,
      samples: [],
    };
  }

  const text = await readTextEntry(entry);
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const numericValues = [];

  for (const line of lines) {
    const payload = line.includes('|') ? line.split('|').slice(1).join('|') : line;

    payload
      .split(/[;\s,]+/)
      .map(s => parseFloat(s))
      .filter(n => Number.isFinite(n) && n > 0)
      .forEach(n => numericValues.push(n));
  }

  const rounded = Array.from(new Set(
    numericValues.map(n => Math.round(n * 1000000) / 1000000)
  ));

  return {
    entry,
    text,
    exists: true,
    size: text.length,
    objectCount: lines.length,
    hasVariableLayerHeights: rounded.length > 2,
    uniqueValueCount: rounded.length,
    minValue: rounded.length ? Math.min(...rounded) : null,
    maxValue: rounded.length ? Math.max(...rounded) : null,
    samples: lines.slice(0, 3),
  };
}