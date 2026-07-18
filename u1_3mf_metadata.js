// Rewrites 3MF metadata that must reference the converted U1 project.
//
// Geometry and model data remain unchanged whenever possible.

const MULTI_PLATE_GRID_FACTOR = 1.2;

function buildFilamentIdMapping(filaments) {
  const idMapping = {};

  filaments.forEach((f, i) => {
    idMapping[f.id] = String(i + 1);
  });

  return idMapping;
}

async function rewriteSliceInfoConfig(
  sliceEntry,
  idMapping,
  newColors,
  newTypes
) {
  if (!sliceEntry) return null;

  let sliceXml = await sliceEntry.async('string');

  sliceXml = sliceXml.replace(
    /key="printer_model_id"\s+value="[^"]*"/g,
    'key="printer_model_id" value="Snapmaker U1"'
  );

  const doc = parseXml(sliceXml);
  const parent = doc.querySelector('plate') || doc.documentElement;

  let counter = 1;

  const existingNodes = Array.from(
    parent.querySelectorAll('filament')
  );

  existingNodes.forEach(node => {
    const oldId = node.getAttribute('id');

    if (idMapping[oldId] !== undefined) {
      node.setAttribute('id', String(counter));
      node.setAttribute('color', newColors[counter - 1]);
      node.setAttribute('type', newTypes[counter - 1]);
      counter++;
    } else {
      node.parentNode.removeChild(node);
    }
  });

  return serializeXml(doc);
}

async function rewriteModelSettingsConfig(
  modelEntry,
  idMapping,
  targetFilamentCount = TARGET_FILAMENTS
) {
  if (!modelEntry) return null;

  const modelXml = await modelEntry.async('string');
  const doc = parseXml(modelXml);

  doc.querySelectorAll('metadata[key="extruder"]').forEach(meta => {
    const oldVal = meta.getAttribute('value');

    if (idMapping[oldVal] !== undefined) {
      meta.setAttribute('value', idMapping[oldVal]);
    }
  });

  doc.querySelectorAll(
    'plate metadata[key="filament_maps"]'
  ).forEach(meta => {
    meta.setAttribute(
      'value',
      Array.from(
        { length: targetFilamentCount },
        () => '1'
      ).join(' ')
    );
  });

  doc.querySelectorAll(
    'plate metadata[key="filament_volume_maps"]'
  ).forEach(meta => {
    meta.parentNode?.removeChild(meta);
  });

  return serializeXml(doc);
}

// -----------------------------------------------------------------------------
// Multi-plate positioning
// -----------------------------------------------------------------------------

function roundMultiPlateNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return null;

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readDirectMetadataValue(parentNode, key) {
  if (!parentNode || !key) return null;

  const nodes = Array.from(
    parentNode.querySelectorAll(':scope > metadata')
  );

  const node = nodes.find(
    metadata => metadata.getAttribute('key') === key
  );

  return node?.getAttribute('value') ?? null;
}

function parsePrintableAreaPoint(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);

    return Number.isFinite(x) && Number.isFinite(y)
      ? { x, y }
      : null;
  }

  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const x = Number(value.x);
    const y = Number(value.y);

    return Number.isFinite(x) && Number.isFinite(y)
      ? { x, y }
      : null;
  }

  const numbers = String(value ?? '')
    .match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);

  if (!numbers || numbers.length < 2) return null;

  const x = Number(numbers[0]);
  const y = Number(numbers[1]);

  return Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : null;
}

function parsePrintableArea(value) {
  const rawPoints = Array.isArray(value)
    ? value
    : [value];

  const points = rawPoints
    .map(parsePrintableAreaPoint)
    .filter(Boolean);

  if (points.length < 2) return null;

  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxY - minY;

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,

    width,
    height,

    centerX: minX + width / 2,
    centerY: minY + height / 2,

    gridStepX: width * MULTI_PLATE_GRID_FACTOR,
    gridStepY: height * MULTI_PLATE_GRID_FACTOR,
  };
}

function parse3mfTransform(value) {
  const values = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);

  if (
    values.length !== 12 ||
    values.some(number => !Number.isFinite(number))
  ) {
    return null;
  }

  return values;
}

function serialize3mfTransform(values) {
  return values
    .map(value => {
      if (!Number.isFinite(value)) return '0';

      const rounded = roundMultiPlateNumber(value, 8);

      return Object.is(rounded, -0)
        ? '0'
        : String(rounded);
    })
    .join(' ');
}

function buildModelBuildItemIndex(modelDoc) {
  const byObjectId = new Map();

  modelDoc.querySelectorAll('build > item').forEach(itemNode => {
    const objectId = itemNode.getAttribute('objectid');

    if (!objectId) return;

    if (!byObjectId.has(objectId)) {
      byObjectId.set(objectId, []);
    }

    byObjectId.get(objectId).push(itemNode);
  });

  return byObjectId;
}

function createMultiPlatePositioningReport(
  project,
  sourceArea,
  targetArea,
  plateCount
) {
  return {
    enabled: project?.options?.fixMultiPlatePositioning !== false,
    detected: plateCount > 1,
    applied: false,
    reason: '',

    plateCount,
    adjustedPlateCount: 0,
    adjustedInstanceCount: 0,
    unresolvedInstanceCount: 0,
    skippedInstanceCount: 0,
    skippedPlateCount: 0,

    gridFactor: MULTI_PLATE_GRID_FACTOR,

    centerOffset:
      sourceArea && targetArea
        ? {
            x: roundMultiPlateNumber(
              targetArea.centerX - sourceArea.centerX
            ),

            y: roundMultiPlateNumber(
              targetArea.centerY - sourceArea.centerY
            ),
          }
        : null,

    gridDifference:
      sourceArea && targetArea
        ? {
            x: roundMultiPlateNumber(
              targetArea.gridStepX - sourceArea.gridStepX
            ),

            y: roundMultiPlateNumber(
              targetArea.gridStepY - sourceArea.gridStepY
            ),
          }
        : null,

    source: sourceArea
      ? {
          printerModel:
            String(
              project?.original?.settings?.printer_model ||
              project?.original?.settings?.printer_settings_id ||
              ''
            ),

          minX: roundMultiPlateNumber(sourceArea.minX),
          maxX: roundMultiPlateNumber(sourceArea.maxX),
          minY: roundMultiPlateNumber(sourceArea.minY),
          maxY: roundMultiPlateNumber(sourceArea.maxY),

          width: roundMultiPlateNumber(sourceArea.width),
          height: roundMultiPlateNumber(sourceArea.height),

          gridStepX:
            roundMultiPlateNumber(sourceArea.gridStepX),

          gridStepY:
            roundMultiPlateNumber(sourceArea.gridStepY),
        }
      : null,

    target: targetArea
      ? {
          printerModel:
            String(
              project?.u1?.settings?.printer_model ||
              project?.u1?.settings?.printer_settings_id ||
              'Snapmaker U1'
            ),

          minX: roundMultiPlateNumber(targetArea.minX),
          maxX: roundMultiPlateNumber(targetArea.maxX),
          minY: roundMultiPlateNumber(targetArea.minY),
          maxY: roundMultiPlateNumber(targetArea.maxY),

          width: roundMultiPlateNumber(targetArea.width),
          height: roundMultiPlateNumber(targetArea.height),

          gridStepX:
            roundMultiPlateNumber(targetArea.gridStepX),

          gridStepY:
            roundMultiPlateNumber(targetArea.gridStepY),
        }
      : null,

    grid: {
      minColumn: null,
      maxColumn: null,
      minRow: null,
      maxRow: null,
      detectedCells: 0,
    },

    movement: {
      maxAbsDeltaX: 0,
      maxAbsDeltaY: 0,
    },

    problemPlateIds: [],
    warnings: [],
    durationMs: 0,
  };
}

function addMultiPlateCompatibilityWarning(
  project,
  report,
  warning
) {
  if (!warning) return;

  report.warnings.push(warning);

  project.compatibility = {
    ...(project.compatibility || {}),

    warnings: [
      ...(project.compatibility?.warnings || []),
      warning,
    ],

    actions: [
      ...(project.compatibility?.actions || []),
    ],
  };
}

function addMultiPlateCompatibilityAction(
  project,
  report
) {
  const action = {
    id: 'fix-multi-plate-positioning',
    type: 'rewrite-model-transforms',

    reason:
      'Multi-plate object positions were adjusted from the source printer grid to the Snapmaker U1 grid.',

    plateCount: report.plateCount,
    adjustedPlateCount: report.adjustedPlateCount,
    adjustedInstanceCount: report.adjustedInstanceCount,

    sourceBed:
      report.source
        ? `${report.source.width} × ${report.source.height} mm`
        : null,

    targetBed:
      report.target
        ? `${report.target.width} × ${report.target.height} mm`
        : null,
  };

  project.compatibility = {
    ...(project.compatibility || {}),

    warnings: [
      ...(project.compatibility?.warnings || []),
    ],

    actions: [
      ...(project.compatibility?.actions || []),
      action,
    ],
  };
}

function rewriteMultiPlateModel(project) {
  const startedAt = performance.now();

  const modelSettingsStr =
    project?.original?.modelSettingsStr;

  const modelStr =
    project?.model?.modelStr;

  const sourceArea = parsePrintableArea(
    project?.original?.settings?.printable_area
  );

  const targetArea = parsePrintableArea(
    project?.u1?.settings?.printable_area
  );

  let plateCount = 0;

  if (modelSettingsStr) {
    const countDoc = parseXml(modelSettingsStr);

    plateCount = countDoc.querySelectorAll('plate').length;
  }

  const report = createMultiPlatePositioningReport(
    project,
    sourceArea,
    targetArea,
    plateCount
  );

  const finish = modified3DModel => {
    report.durationMs = roundMultiPlateNumber(
      performance.now() - startedAt,
      3
    );

    project.analysis = {
      ...(project.analysis || {}),
      multiPlatePositioning: report,
    };

    return {
      modified3DModel,
      multiPlatePositioning: report,
    };
  };

  if (plateCount <= 1) {
    report.reason = 'single-plate-project';
    return finish(null);
  }

  if (project?.options?.fixMultiPlatePositioning === false) {
    report.reason = 'disabled-by-user';
    return finish(null);
  }

  if (!modelSettingsStr) {
    report.reason = 'missing-model-settings';

    addMultiPlateCompatibilityWarning(
      project,
      report,
      'Multi-plate positioning was skipped because Metadata/model_settings.config is missing.'
    );

    return finish(null);
  }

  if (!modelStr) {
    report.reason = 'missing-3d-model';

    addMultiPlateCompatibilityWarning(
      project,
      report,
      'Multi-plate positioning was skipped because 3D/3dmodel.model is missing.'
    );

    return finish(null);
  }

  if (!sourceArea) {
    report.reason = 'invalid-source-printable-area';

    addMultiPlateCompatibilityWarning(
      project,
      report,
      'Multi-plate positioning was skipped because the source printable_area could not be read.'
    );

    return finish(null);
  }

  if (!targetArea) {
    report.reason = 'invalid-target-printable-area';

    addMultiPlateCompatibilityWarning(
      project,
      report,
      'Multi-plate positioning was skipped because the target U1 printable_area could not be read.'
    );

    return finish(null);
  }

  const centerDifferenceX =
    targetArea.centerX - sourceArea.centerX;

  const centerDifferenceY =
    targetArea.centerY - sourceArea.centerY;

  const gridDifferenceX =
    targetArea.gridStepX - sourceArea.gridStepX;

  const gridDifferenceY =
    targetArea.gridStepY - sourceArea.gridStepY;

  if (
    Math.abs(centerDifferenceX) < 0.000001 &&
    Math.abs(centerDifferenceY) < 0.000001 &&
    Math.abs(gridDifferenceX) < 0.000001 &&
    Math.abs(gridDifferenceY) < 0.000001
  ) {
    report.reason = 'source-and-target-positioning-identical';
    return finish(null);
  }

  const modelSettingsDoc = parseXml(modelSettingsStr);
  const modelDoc = parseXml(modelStr);

  const buildItemsByObjectId =
    buildModelBuildItemIndex(modelDoc);

  const detectedCells = new Set();
  const detectedColumns = [];
  const detectedRows = [];

  let adjustedPlateCount = 0;
  let adjustedInstanceCount = 0;
  let unresolvedInstanceCount = 0;
  let skippedInstanceCount = 0;
  let skippedPlateCount = 0;

  let maxAbsDeltaX = 0;
  let maxAbsDeltaY = 0;

  const problemPlateIds = [];

  const plateNodes = Array.from(
    modelSettingsDoc.querySelectorAll('plate')
  );

  for (let plateIndex = 0; plateIndex < plateNodes.length; plateIndex++) {
    const plateNode = plateNodes[plateIndex];

    const plateId =
      readDirectMetadataValue(plateNode, 'plater_id') ||
      String(plateIndex + 1);

    const instanceNodes = Array.from(
      plateNode.querySelectorAll(':scope > model_instance')
    );

    if (!instanceNodes.length) {
      continue;
    }

    const linkedInstances = [];
    let plateUnresolvedInstanceCount = 0;

    for (const instanceNode of instanceNodes) {
      const objectId =
        readDirectMetadataValue(instanceNode, 'object_id');

      const rawInstanceId =
        readDirectMetadataValue(instanceNode, 'instance_id');

      const instanceId = Number(rawInstanceId);

      const objectBuildItems =
        objectId
          ? buildItemsByObjectId.get(objectId)
          : null;

      const buildItem =
        objectBuildItems &&
        Number.isInteger(instanceId) &&
        instanceId >= 0
          ? objectBuildItems[instanceId]
          : null;

      const transform = buildItem
        ? parse3mfTransform(
            buildItem.getAttribute('transform')
          )
        : null;

      if (!buildItem || !transform) {
        plateUnresolvedInstanceCount++;
        continue;
      }

      const sourceX = transform[9];
      const sourceY = transform[10];

      const column = Math.round(
        (sourceX - sourceArea.centerX) /
        sourceArea.gridStepX
      );

      const row = Math.round(
        (sourceArea.centerY - sourceY) /
        sourceArea.gridStepY
      );

      linkedInstances.push({
        buildItem,
        transform,
        column,
        row,
      });
    }

    // A plate must never be adjusted only partially.
    //
    // If even one instance cannot be linked safely, leave every instance
    // on that plate unchanged.
    if (plateUnresolvedInstanceCount > 0) {
      unresolvedInstanceCount += plateUnresolvedInstanceCount;
      skippedInstanceCount += instanceNodes.length;
      skippedPlateCount++;
      problemPlateIds.push(String(plateId));
      continue;
    }

    if (!linkedInstances.length) {
      skippedInstanceCount += instanceNodes.length;
      skippedPlateCount++;
      problemPlateIds.push(String(plateId));
      continue;
    }

    const plateCells = new Set(
      linkedInstances.map(
        item => `${item.column}:${item.row}`
      )
    );

    // Every instance belonging to one plate must resolve to the same
    // source grid cell. If that is not true, leave the entire plate
    // unchanged instead of guessing.
    if (plateCells.size !== 1) {
      skippedInstanceCount += instanceNodes.length;
      skippedPlateCount++;
      problemPlateIds.push(String(plateId));
      continue;
    }

    const firstInstance = linkedInstances[0];

    const column = firstInstance.column;
    const row = firstInstance.row;

    detectedCells.add(`${column}:${row}`);
    detectedColumns.push(column);
    detectedRows.push(row);

    // Move the local source plate center to the target plate center,
    // then add the accumulated difference between both plate grids.
    //
    // Rotation, scale, Z and the relative arrangement of all objects
    // on the plate remain unchanged.
    const deltaX =
      centerDifferenceX +
      column * gridDifferenceX;

    const deltaY =
      centerDifferenceY -
      row * gridDifferenceY;

    maxAbsDeltaX = Math.max(
      maxAbsDeltaX,
      Math.abs(deltaX)
    );

    maxAbsDeltaY = Math.max(
      maxAbsDeltaY,
      Math.abs(deltaY)
    );

    if (
      Math.abs(deltaX) < 0.000001 &&
      Math.abs(deltaY) < 0.000001
    ) {
      continue;
    }

    for (const instance of linkedInstances) {
      instance.transform[9] += deltaX;
      instance.transform[10] += deltaY;

      instance.buildItem.setAttribute(
        'transform',
        serialize3mfTransform(instance.transform)
      );

      adjustedInstanceCount++;
    }

    adjustedPlateCount++;
  }

  report.adjustedPlateCount = adjustedPlateCount;
  report.adjustedInstanceCount = adjustedInstanceCount;
  report.unresolvedInstanceCount = unresolvedInstanceCount;
  report.skippedInstanceCount = skippedInstanceCount;
  report.skippedPlateCount = skippedPlateCount;

  report.grid = {
    minColumn:
      detectedColumns.length
        ? Math.min(...detectedColumns)
        : null,

    maxColumn:
      detectedColumns.length
        ? Math.max(...detectedColumns)
        : null,

    minRow:
      detectedRows.length
        ? Math.min(...detectedRows)
        : null,

    maxRow:
      detectedRows.length
        ? Math.max(...detectedRows)
        : null,

    detectedCells: detectedCells.size,
  };

  report.movement = {
    maxAbsDeltaX:
      roundMultiPlateNumber(maxAbsDeltaX),

    maxAbsDeltaY:
      roundMultiPlateNumber(maxAbsDeltaY),
  };

  report.problemPlateIds =
    Array.from(new Set(problemPlateIds));

  if (unresolvedInstanceCount > 0) {
    addMultiPlateCompatibilityWarning(
      project,
      report,
      `Multi-plate positioning found ${unresolvedInstanceCount} model instance${unresolvedInstanceCount === 1 ? '' : 's'} that could not be linked safely. Each affected plate was left completely unchanged.`
    );
  }

  if (skippedPlateCount > 0) {
    const platePreview = report.problemPlateIds
      .slice(0, 10)
      .join(', ');

    const suffix =
      report.problemPlateIds.length > 10
        ? ', …'
        : '';

    addMultiPlateCompatibilityWarning(
      project,
      report,
      `Multi-plate positioning skipped ${skippedPlateCount} plate${skippedPlateCount === 1 ? '' : 's'} containing ${skippedInstanceCount} model instance${skippedInstanceCount === 1 ? '' : 's'} because the complete plate could not be adjusted safely${platePreview ? `: ${platePreview}${suffix}` : '.'}`
    );
  }

  if (adjustedInstanceCount === 0) {
    report.reason =
      skippedPlateCount > 0
        ? 'no-safe-adjustments'
        : 'no-grid-offset-required';

    return finish(null);
  }

  report.applied = true;

  report.reason =
    skippedPlateCount > 0
      ? 'partially-applied'
      : 'applied';

  addMultiPlateCompatibilityAction(
    project,
    report
  );

  return finish(
    serializeXml(modelDoc)
  );
}

async function rewriteU13mfMetadata(zip, project) {
  const idMapping = buildFilamentIdMapping(
    project.filaments.source
  );

  const modifiedSliceInfo = await rewriteSliceInfoConfig(
    project.original.sliceEntry,
    idMapping,
    project.filaments.mapped.colors,
    project.filaments.mapped.types
  );

  const targetFilamentCount = Math.max(
    TARGET_FILAMENTS,
    project.filaments?.mapped?.colors?.length || 0,
    project.filaments?.source?.length || 0
  );

  const modifiedModelSettings =
    await rewriteModelSettingsConfig(
      project.original.modelSettingsEntry ||
        zip.file('Metadata/model_settings.config'),

      idMapping,
      targetFilamentCount
    );

  const multiPlateRewrite =
    rewriteMultiPlateModel(project);

  return {
    idMapping,
    modifiedSliceInfo,
    modifiedModelSettings,

    modified3DModel: multiPlateRewrite.modified3DModel,
    multiPlatePositioning: multiPlateRewrite.multiPlatePositioning,
  };
}