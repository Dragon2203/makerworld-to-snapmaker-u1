// Parses 3D/3dmodel.model from the source 3MF.
//
// Read-only model analysis: objects, meshes, components,
// build items, base materials and color groups.

function parse3DModelObject(objectNode, index) {
  const meshNode = objectNode.querySelector(':scope > mesh');
  const componentsNode = objectNode.querySelector(':scope > components');

  return {
    index,
    id: objectNode.getAttribute('id'),
    type: objectNode.getAttribute('type') || '',
    name: objectNode.getAttribute('name') || '',

    hasMesh: !!meshNode,
    hasComponents: !!componentsNode,

    mesh: meshNode ? {
      vertexCount: meshNode.querySelectorAll('vertices > vertex').length,
      triangleCount: meshNode.querySelectorAll('triangles > triangle').length,
    } : null,

    components: componentsNode
      ? Array.from(componentsNode.querySelectorAll(':scope > component')).map((componentNode, componentIndex) => ({
          index: componentIndex,
          objectId: componentNode.getAttribute('objectid'),
          transform: componentNode.getAttribute('transform') || '',
        }))
      : [],
  };
}

function parse3DModelBuildItem(itemNode, index) {
  return {
    index,
    objectId: itemNode.getAttribute('objectid'),
    transform: itemNode.getAttribute('transform') || '',
    printable: itemNode.getAttribute('printable') || '',
    partNumber: itemNode.getAttribute('partnumber') || '',
  };
}

function parse3DBaseMaterials(modelDoc) {
  return Array.from(modelDoc.querySelectorAll('resources > basematerials')).map((node, index) => ({
    index,
    id: node.getAttribute('id'),
    bases: Array.from(node.querySelectorAll(':scope > base')).map((baseNode, baseIndex) => ({
      index: baseIndex,
      name: baseNode.getAttribute('name') || '',
      displaycolor: baseNode.getAttribute('displaycolor') || '',
    })),
  }));
}

function parse3DColorGroups(modelDoc) {
  return Array.from(modelDoc.querySelectorAll('resources > colorgroup')).map((node, index) => ({
    index,
    id: node.getAttribute('id'),
    colors: Array.from(node.querySelectorAll(':scope > color')).map((colorNode, colorIndex) => ({
      index: colorIndex,
      color: colorNode.getAttribute('color') || '',
    })),
  }));
}

async function parse3DModel(files) {
  const entry = files.model?.entry || null;

  if (!entry) {
    return {
      entry: null,
      modelStr: null,
      modelDoc: null,
      unit: '',
      language: '',
      resources: {
        objects: [],
        basematerials: [],
        colorgroups: [],
        meshes: 0,
        components: 0,
      },
      build: [],
    };
  }

  const modelStr = await readTextEntry(entry);
  const modelDoc = parseXml(modelStr);
  const root = modelDoc.documentElement;

  const objects = Array.from(modelDoc.querySelectorAll('resources > object'))
    .map((node, index) => parse3DModelObject(node, index));

  const build = Array.from(modelDoc.querySelectorAll('build > item'))
    .map((node, index) => parse3DModelBuildItem(node, index));

  const basematerials = parse3DBaseMaterials(modelDoc);
  const colorgroups   = parse3DColorGroups(modelDoc);

  return {
    entry,
    modelStr,
    modelDoc,

    unit: root?.getAttribute('unit') || '',
    language: root?.getAttribute('xml:lang') || root?.getAttribute('lang') || '',

    resources: {
      objects,
      basematerials,
      colorgroups,
      meshes: objects.filter(o => o.hasMesh).length,
      components: objects.reduce((sum, o) => sum + o.components.length, 0),
    },

    build,
  };
}