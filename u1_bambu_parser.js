// Read-only diagnostics for Bambu-specific 3MF metadata.
//
// Used for feature detection and reverse engineering.
// This module must not modify project data.

function getXmlNodePath(node) {
  const parts = [];

  while (node && node.nodeType === 1) {
    let name = node.nodeName || node.localName || 'unknown';

    if (node.parentNode) {
      const siblings = Array.from(node.parentNode.children || [])
        .filter(s => s.nodeName === node.nodeName);

      if (siblings.length > 1) {
        const index = siblings.indexOf(node) + 1;
        name += `[${index}]`;
      }
    }

    parts.unshift(name);
    node = node.parentNode;
  }

  return parts.join('/');
}

function collectXmlNamespaces(doc) {
  if (!doc?.documentElement) return [];

  const namespaces = new Map();

  doc.querySelectorAll('*').forEach(node => {
    Array.from(node.attributes || []).forEach(attr => {
      if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) {
        namespaces.set(attr.name, attr.value);
      }
    });
  });

  return Array.from(namespaces.entries()).map(([name, uri]) => ({ name, uri }));
}

function collectBambuLikeXmlAttributes(doc) {
  if (!doc?.documentElement) return [];

  const found = [];

  doc.querySelectorAll('*').forEach(node => {
    Array.from(node.attributes || []).forEach(attr => {
      const name = attr.name || '';
      const value = attr.value || '';

      if (
        name.toLowerCase().includes('bambu') ||
        value.toLowerCase().includes('bambu') ||
        name.includes(':')
      ) {
        found.push({
          path: getXmlNodePath(node),
          name,
          value,
        });
      }
    });
  });

  return found;
}

function collectXmlElementNames(doc) {
  if (!doc?.documentElement) return [];

  const counts = new Map();

  doc.querySelectorAll('*').forEach(node => {
    const name = node.nodeName || node.localName || 'unknown';
    counts.set(name, (counts.get(name) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function rememberSampleValue(samples, value, maxSamples = 10) {
  if (value === undefined || value === null) return;
  const v = String(value);
  if (!samples.includes(v) && samples.length < maxSamples) {
    samples.push(v);
  }
}

function collectXmlAttributeUsage(doc) {
  if (!doc?.documentElement) return [];

  const usage = new Map();

  doc.querySelectorAll('*').forEach(node => {
    const element = node.nodeName || node.localName || 'unknown';

    if (!usage.has(element)) {
      usage.set(element, {
        element,
        count: 0,
        attributes: {},
      });
    }

    const info = usage.get(element);
    info.count++;

    Array.from(node.attributes || []).forEach(attr => {
      const name = attr.name || '';

      if (!info.attributes[name]) {
        info.attributes[name] = {
          count: 0,
          samples: [],
        };
      }

      info.attributes[name].count++;
      rememberSampleValue(info.attributes[name].samples, attr.value);
    });
  });

  return Array.from(usage.values())
    .map(item => ({
      ...item,
      attributes: Object.fromEntries(
        Object.entries(item.attributes)
          .sort((a, b) => a[0].localeCompare(b[0]))
      ),
    }))
    .sort((a, b) => a.element.localeCompare(b.element));
}

function findInterestingXmlAttributes(attributeUsage) {
  const needles = [
    'paint',
    'color',
    'colour',
    'extruder',
    'material',
    'filament',
    'modifier',
    'negative',
    'support',
    'seam',
    'layer',
    'height',
    'adaptive',
    'variable',
  ];

  const hits = [];

  for (const elementInfo of attributeUsage || []) {
    for (const [attrName, attrInfo] of Object.entries(elementInfo.attributes || {})) {
      const n = attrName.toLowerCase();

      if (needles.some(needle => n.includes(needle))) {
        hits.push({
          element: elementInfo.element,
          attribute: attrName,
          count: attrInfo.count,
          samples: attrInfo.samples,
        });
      }
    }
  }

  return hits;
}

function analyzePaintColorAttributes(doc) {
  if (!doc?.documentElement) {
    return {
      triangleCount: 0,
      paintedTriangleCount: 0,
      uniqueValues: [],
      uniqueChars: [],
      lengthBuckets: {},
      maxLength: 0,
      samples: [],
    };
  }

  const triangles = Array.from(doc.querySelectorAll('triangle'));
  const painted = triangles
    .map(t => t.getAttribute('paint_color'))
    .filter(v => v !== null && v !== '');

  const uniqueValues = Array.from(new Set(painted)).slice(0, 100);
  const charSet = new Set();
  const lengthBuckets = {};
  const samples = [];

  let maxLength = 0;

  for (const value of painted) {
    const len = value.length;
    maxLength = Math.max(maxLength, len);
    lengthBuckets[len] = (lengthBuckets[len] || 0) + 1;

    for (const ch of value) {
      charSet.add(ch);
    }

    if (samples.length < 20 && !samples.includes(value)) {
      samples.push(value);
    }
  }

  return {
    triangleCount: triangles.length,
    paintedTriangleCount: painted.length,
    unpaintedTriangleCount: triangles.length - painted.length,
    paintCoveragePercent: triangles.length
      ? Math.round((painted.length / triangles.length) * 10000) / 100
      : 0,

    uniqueValueCount: new Set(painted).size,
    uniqueValues,
    uniqueChars: Array.from(charSet).sort(),

    lengthBuckets,
    maxLength,
    samples,
  };
}

async function parseBambuMetadataFile(file) {
  if (!file?.entry) return null;

  const lower = file.safe.toLowerCase();
  const isTextLike =
    lower.endsWith('.config') ||
    lower.endsWith('.xml') ||
    lower.endsWith('.rels') ||
    lower.endsWith('.model') ||
    lower.endsWith('.json');

  if (!isTextLike) {
    return {
      path: file.safe,
      ext: file.ext,
      textLike: false,
    };
  }

  const text = await readTextEntry(file.entry);
  const looksXml = /^\s*</.test(text || '');
  const looksJson = /^\s*[\[{]/.test(text || '');

  let xml = null;
  let jsonKeys = [];

  if (looksXml) {
    xml = parseXml(text);
  }

  if (looksJson) {
    try {
      const parsed = JSON.parse(text);
      jsonKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 100) : [];
    } catch {
      jsonKeys = [];
    }
  }

  const attributeUsage = xml ? collectXmlAttributeUsage(xml) : [];
  const paintColorAnalysis = xml ? analyzePaintColorAttributes(xml) : null;

  return {
    path: file.safe,
    ext: file.ext,
    textLike: true,
    size: text?.length || 0,
    looksXml,
    looksJson,

    namespaces: xml ? collectXmlNamespaces(xml) : [],
    bambuAttributes: xml ? collectBambuLikeXmlAttributes(xml).slice(0, 100) : [],
    elements: xml ? collectXmlElementNames(xml).slice(0, 200) : [],
    attributeUsage,
    interestingAttributes: findInterestingXmlAttributes(attributeUsage),
    paintColorAnalysis,
    jsonKeys,
  };
}

async function parseBambu3mfDiagnostics(project) {
  const files = project?.files || {};
  const candidates = [
    ...(files.metadata || []),
    ...(files.relationships || []),
    ...(files.models || []),
  ];

  const parsedFiles = [];

  for (const file of candidates) {
    const parsed = await parseBambuMetadataFile(file);
    if (parsed) parsedFiles.push(parsed);
  }

  return {
    files: parsedFiles,

    summary: {
      metadataFiles: (files.metadata || []).map(f => f.safe),
      relationshipFiles: (files.relationships || []).map(f => f.safe),
      modelFiles: (files.models || []).map(f => f.safe),

      filesWithNamespaces: parsedFiles
        .filter(f => f.namespaces?.length)
        .map(f => f.path),

      filesWithBambuAttributes: parsedFiles
        .filter(f => f.bambuAttributes?.length)
        .map(f => f.path),

      xmlFiles: parsedFiles
        .filter(f => f.looksXml)
        .map(f => f.path),

      jsonFiles: parsedFiles
        .filter(f => f.looksJson)
        .map(f => f.path),
    },
  };
}