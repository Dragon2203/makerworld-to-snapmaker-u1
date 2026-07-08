// Rewrites 3MF metadata that must reference the converted U1 project.
//
// Geometry and model data remain unchanged whenever possible.

function buildFilamentIdMapping(filaments) {
  const idMapping = {};
  filaments.forEach((f, i) => {
    idMapping[f.id] = String(i + 1);
  });
  return idMapping;
}

async function rewriteSliceInfoConfig(sliceEntry, idMapping, newColors, newTypes) {
  if (!sliceEntry) return null;

  let sliceXml = await sliceEntry.async('string');
  sliceXml = sliceXml.replace(
    /key="printer_model_id"\s+value="[^"]*"/g,
    'key="printer_model_id" value="Snapmaker U1"'
  );

  const doc = parseXml(sliceXml);
  const parent = doc.querySelector('plate') || doc.documentElement;

  let counter = 1;
  const existingNodes = Array.from(parent.querySelectorAll('filament'));

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

async function rewriteModelSettingsConfig(modelEntry, idMapping, targetFilamentCount = TARGET_FILAMENTS) {
  if (!modelEntry) return null;

  const modelXml = await modelEntry.async('string');
  const doc = parseXml(modelXml);

  doc.querySelectorAll('metadata[key="extruder"]').forEach(meta => {
    const oldVal = meta.getAttribute('value');

    if (idMapping[oldVal] !== undefined) {
      meta.setAttribute('value', idMapping[oldVal]);
    }
  });

  doc.querySelectorAll('plate metadata[key="filament_maps"]').forEach(meta => {
    meta.setAttribute(
      'value',
      Array.from({ length: targetFilamentCount }, () => '1').join(' ')
    );
  });

  doc.querySelectorAll('plate metadata[key="filament_volume_maps"]').forEach(meta => {
    meta.parentNode?.removeChild(meta);
  });

  return serializeXml(doc);
}

async function rewriteU13mfMetadata(zip, project) {
  const idMapping = buildFilamentIdMapping(project.filaments.source);

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

  const modifiedModelSettings = await rewriteModelSettingsConfig(
    project.original.modelSettingsEntry || zip.file('Metadata/model_settings.config'),
    idMapping,
    targetFilamentCount
  );
  
  return {
    idMapping,
    modifiedSliceInfo,
    modifiedModelSettings,
  };
}