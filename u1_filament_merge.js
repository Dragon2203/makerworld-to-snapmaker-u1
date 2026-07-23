// Filament parsing and final U1 filament normalization.
//
// Preserves source project filaments when possible, creates Generic fallbacks
// when needed, and ensures all filament arrays are valid for the U1 project.

function normalizeColor(color) {
  if (!color) return '#000000';
  const c = color.replace(/^#/, '');
  if (c.length !== 6 && c.length !== 8) return '#000000';
  if (!/^[0-9A-Fa-f]+$/.test(c)) return '#000000';
  return '#' + c.toUpperCase();
}

function ensureRGBA(color) {
  return color.length === 7 ? color + 'FF' : color;
}

function parseFilamentsFromSliceInfo(xmlStr) {
  const doc = parseXml(xmlStr);
  const nodes = Array.from(doc.querySelectorAll('filament'));

  return nodes.map(n => {
    const usedM = parseFloat(n.getAttribute('used_m') || '0') || 0;
    const usedG = parseFloat(n.getAttribute('used_g') || '0') || 0;

    return {
      id:    n.getAttribute('id'),
      color: normalizeColor(n.getAttribute('color') || ''),
      type:  n.getAttribute('type') || 'PLA',

      used_m: usedM,
      used_g: usedG,
      used: usedM > 0 || usedG > 0,
    };
  });
}

function parseFilamentsFromProjectSettings(jsonStr) {
  const cfg    = JSON.parse(jsonStr);
  const colors = cfg.filament_colour || [];
  const types  = cfg.filament_type   || [];

  return colors.map((color, i) => ({
    id:    String(i + 1),
    color: normalizeColor(color),
    type:  types[i] || 'PLA',

    used_m: null,
    used_g: null,
    used: null,
  }));
}

// U1 FILAMENT PRESET ANALYSIS
function getGenericU1FilamentPreset(type) {
  const t = String(type || 'PLA').toUpperCase();

  if (t.includes('PETG')) return { type: 'PETG', preset: 'Generic PETG' };
  if (t.includes('TPU'))  return { type: 'TPU',  preset: 'Generic TPU' };
  if (t.includes('ABS'))  return { type: 'ABS',  preset: 'Generic ABS' };
  if (t.includes('ASA'))  return { type: 'ASA',  preset: 'Generic ASA' };
  if (t.includes('PA'))   return { type: 'PA',   preset: 'Generic PA' };
  if (t.includes('PC'))   return { type: 'PC',   preset: 'Generic PC' };

  return { type: 'PLA', preset: 'Generic PLA' };
}

function isGenericFilamentName(name) {
  const n = String(name || '').toLowerCase();
  return n.includes('generic');
}

// U1 FINAL FILAMENT PASS
function getFilamentDiffForSlot(settings, slotIndex) {
  const diff = settings?.different_settings_to_system;

  if (Array.isArray(diff)) {
    return String(diff[slotIndex + 1] || '');
  }

  return '';
}

function isModifiedSourceFilamentSlot(origSettings, slotIndex) {
  const perSlotDiff = getFilamentDiffForSlot(origSettings, slotIndex);

  if (perSlotDiff) {
    return parseDifferentSettingsToSystem(perSlotDiff)
      .some(key => String(key || '').toLowerCase().startsWith('filament_'));
  }

  return false;
}

function analyzeSourceFilamentSlot(origSettings, slotIndex) {
  const settingsId = Array.isArray(origSettings?.filament_settings_id)
    ? String(origSettings.filament_settings_id[slotIndex] || '')
    : '';

  const vendor = Array.isArray(origSettings?.filament_vendor)
    ? String(origSettings.filament_vendor[slotIndex] || '')
    : '';

  const type = Array.isArray(origSettings?.filament_type)
    ? String(origSettings.filament_type[slotIndex] || 'PLA')
    : 'PLA';

  const color = Array.isArray(origSettings?.filament_colour)
    ? String(origSettings.filament_colour[slotIndex] || '#FFFFFF')
    : '#FFFFFF';

  const genericByName =
    isGenericFilamentName(settingsId) ||
    isGenericFilamentName(vendor);

  const modified = isModifiedSourceFilamentSlot(origSettings, slotIndex);

  return {
    slotIndex,
    settingsId,
    vendor,
    type,
    color,
    isGeneric: genericByName,
    isModified: modified,
    shouldPreserve: !genericByName || modified,
  };
}

const ALWAYS_SLOT_FILAMENT_KEYS = new Set([
  'filament_settings_id',
  'filament_vendor',
  'filament_type',
  'filament_colour',
  'filament_ids',
  'filament_is_support'
]);

// OrcaSlicer requires valid numeric values in these filament arrays.
//
// Experimentally verified behavior:
// - empty filament_adaptive_volumetric_speed values crash OrcaSlicer
// - empty filament_self_index values make the project configuration invalid
// - empty filament_flush_temp values produce an invalid-value warning
function normalizeRequiredOrcaFilamentArrays(
  settings,
  targetFilamentCount
) {
  if (!settings || targetFilamentCount <= 0) return;

  function normalizeNumericArray(key, fallback = '0') {
    const current = Array.isArray(settings[key])
      ? settings[key]
      : [];

    settings[key] = Array.from(
      { length: targetFilamentCount },
      (_, index) => {
        const value = current[index];

        if (
          value === undefined ||
          value === null ||
          value === '' ||
          value === 'nil'
        ) {
          return fallback;
        }

        return String(value);
      }
    );
  }

  normalizeNumericArray(
    'filament_adaptive_volumetric_speed',
    '0'
  );

  normalizeNumericArray(
    'filament_flush_temp',
    '0'
  );

  settings.filament_self_index = Array.from(
    { length: targetFilamentCount },
    (_, index) => String(index + 1)
  );
}

function isSourceSlotFilamentArray(key, value, realFilamentCount) {
  if (!Array.isArray(value)) return false;
  if (ALWAYS_SLOT_FILAMENT_KEYS.has(key)) return true;

  // Normal case:
  // One value per real filament slot.
  if (value.length === realFilamentCount) return true;

  // Bambu current/default pair format:
  // Some filament arrays are stored flat as:
  //
  // [slot1_current, slot1_default, slot2_current, slot2_default, ...]
  //
  // Example with 12 filaments:
  // filament_max_volumetric_speed has 24 entries.
  if (
    realFilamentCount > 0 &&
    value.length === realFilamentCount * 2
  ) {
    return true;
  }

  // Bambu edge case:
  // Some single-filament projects store detailed filament_* arrays with
  // two entries even though only slot 1 is actually visible/used.
  if (realFilamentCount === 1 && value.length === 2) return true;

  return false;
}

function normalizePreservedProjectFilamentNames(combined, origSettings, preservedSlots) {
  const groups = new Map();

  for (const slotIndex of preservedSlots) {
    const sourceName = Array.isArray(origSettings?.filament_settings_id)
      ? String(origSettings.filament_settings_id[slotIndex] || '').trim()
      : '';

    if (!sourceName) continue;

    if (!groups.has(sourceName)) groups.set(sourceName, []);
    groups.get(sourceName).push(slotIndex);
  }

  for (const [sourceName, slots] of groups.entries()) {
    if (slots.length === 1) {
      const slotIndex = slots[0];
      combined.filament_settings_id[slotIndex] = sourceName;
      combined.filament_ids[slotIndex] = Array.isArray(origSettings?.filament_ids)
        ? String(origSettings.filament_ids[slotIndex] || '')
        : '';
      continue;
    }

    const baseSlot = slots[slots.length - 1];

    for (let pos = 0; pos < slots.length; pos++) {
      const slotIndex = slots[pos];
      const isBaseSlot = slotIndex === baseSlot;

      combined.filament_settings_id[slotIndex] = isBaseSlot
        ? sourceName
        : `${sourceName}-${pos + 1}`;

      combined.filament_ids[slotIndex] = isBaseSlot && Array.isArray(origSettings?.filament_ids)
        ? String(origSettings.filament_ids[slotIndex] || '')
        : '';
    }
  }
}

function applyFinalU1FilamentPass(
  combined,
  origSettings,
  sourceFilaments,
  options = {},
  templateSettings = {},
  targetFilamentCount = TARGET_FILAMENTS
) {
  const report = {
    mode: options.filamentPresetMode || 'preserve',
    slots: [],
  };

  const realFilamentCount = Math.max(
    Array.isArray(origSettings?.filament_settings_id) ? origSettings.filament_settings_id.length : 0,
    Array.isArray(origSettings?.filament_colour) ? origSettings.filament_colour.length : 0,
    Array.isArray(origSettings?.filament_type) ? origSettings.filament_type.length : 0,
    Array.isArray(sourceFilaments) ? sourceFilaments.length : 0
  );

  function getSourceSlotArrayValue(settings, key, index, fallback = '') {
    const value = settings?.[key];

    if (!Array.isArray(value)) return fallback;

    // Bambu flat current/default pair format:
    // [slot1_current, slot1_default, slot2_current, slot2_default, ...]
    if (
      realFilamentCount > 0 &&
      value.length === realFilamentCount * 2
    ) {
      const pairedIndex = index * 2;

      if (value[pairedIndex] === undefined) return fallback;
      return bambuCurrentValue(value[pairedIndex]);
    }

    if (value[index] === undefined) return fallback;
    return bambuCurrentValue(value[index]);
  }

  targetFilamentCount = Math.max(
    TARGET_FILAMENTS,
    realFilamentCount,
    targetFilamentCount || 0
  );

  const BLOCKED_SOURCE_SLOT_FILAMENT_KEYS = new Set([
    'filament_nozzle_map',
    'filament_multi_colour',

    // Bambu/Slicer metadata that SnOrca does not keep in its own rewritten U1 reference file.
    'filament_adhesiveness_category',
    'filament_change_length',
    'filament_change_length_nc',
    'filament_colour_type',
    'filament_map',
    'filament_prime_volume',
    'filament_prime_volume_nc',
    'filament_printable',
    'filament_scarf_gap',
    'filament_scarf_height',
    'filament_scarf_length',
    'filament_scarf_seam_type',
    'filament_tower_interface_pre_extrusion_dist',
    'filament_tower_interface_pre_extrusion_length',
    'filament_tower_interface_print_temp',
    'filament_tower_interface_purge_volume',
    'filament_tower_ironing_area',
    'filament_velocity_adaptation_factor',
    'filament_volume_map',

    // Bambu drying/dev metadata.
    'filament_dev_ams_drying_heat_distortion_temperature',
    'filament_dev_chamber_drying_bed_temperature',
    'filament_dev_chamber_drying_time',
    'filament_dev_drying_cooling_temperature',
    'filament_dev_drying_softening_temperature',
  ]);

  const sourceSlotFilamentKeys = new Set(
    Object.entries(origSettings || {})
      .filter(([key, value]) =>
        key.startsWith('filament_') &&
        !BLOCKED_SOURCE_SLOT_FILAMENT_KEYS.has(key) &&
        isSourceSlotFilamentArray(key, value, realFilamentCount)
      )
      .map(([key]) => key)
  );

  const filamentKeys = new Set([
    ...ALWAYS_SLOT_FILAMENT_KEYS,
    ...sourceSlotFilamentKeys,
  ]);

  for (const key of Object.keys(combined)) {
    if (key.startsWith('filament_')) {
      delete combined[key];
    }
  }

  function ensureArray(key) {
    if (!Array.isArray(combined[key])) combined[key] = [];
    return combined[key];
  }

  function sourceArrayValue(settings, key, index, fallback = '') {
    return getSourceSlotArrayValue(
      settings,
      key,
      index,
      fallback
    );
  }

  function copyOriginalSlot(index) {
    for (const key of filamentKeys) {
      const value = origSettings?.[key];

      if (!Array.isArray(value)) continue;
      if (!sourceSlotFilamentKeys.has(key)) continue;

      const slotValue = getSourceSlotArrayValue(
        origSettings,
        key,
        index,
        undefined
      );

      if (slotValue === undefined) continue;

      ensureArray(key)[index] = slotValue;
    }
  }

  function writeGenericSlot(index, sourceType = 'PLA', sourceColor = '#FFFFFF') {
    const generic = getGenericU1FilamentPreset(sourceType);
    const color = ensureRGBA(normalizeColor(sourceColor || '#FFFFFF'));

    for (const key of filamentKeys) {
      const templateValue = templateSettings?.[key];

      if (Array.isArray(templateValue) && templateValue.length) {
        ensureArray(key)[index] = bambuCurrentValue(
          templateValue[Math.min(index, templateValue.length - 1)] ?? templateValue[0] ?? ''
        );
      } else {
        ensureArray(key)[index] = '';
      }
    }

    ensureArray('filament_settings_id')[index] = generic.preset;
    ensureArray('filament_vendor')[index] = 'Generic';
    ensureArray('filament_type')[index] = generic.type;
    ensureArray('filament_colour')[index] = color;
    ensureArray('filament_ids')[index] = '';
    ensureArray('filament_is_support')[index] = '0';
  }

  const preservedSlots = new Set();

  for (let i = 0; i < targetFilamentCount; i++) {
    const sourceType =
      sourceFilaments?.[i]?.type ||
      sourceArrayValue(origSettings, 'filament_type', i, 'PLA');

    const sourceColor =
      sourceFilaments?.[i]?.color ||
      sourceArrayValue(origSettings, 'filament_colour', i, '#FFFFFF');

    if (options.filamentPresetMode === 'force_generic') {
      writeGenericSlot(i, sourceType, sourceColor);
      report.slots.push({ slot: i + 1, action: 'force_generic' });
      continue;
    }

    if (i >= realFilamentCount) {
      writeGenericSlot(i, 'PLA', '#FFFFFF');
      ensureArray('filament_colour')[i] = '#FFFFFFFF';

      report.slots.push({ slot: i + 1, action: 'dummy_generic' });
      continue;
    }

    const analysis = analyzeSourceFilamentSlot(origSettings, i);

    if (analysis.shouldPreserve) {
      copyOriginalSlot(i);
      ensureArray('filament_settings_id')[i] = analysis.settingsId;
      ensureArray('filament_ids')[i] = sourceArrayValue(origSettings, 'filament_ids', i, '');
      preservedSlots.add(i);
      report.slots.push({ slot: i + 1, action: 'preserve', preset: analysis.settingsId });
    } else {
      writeGenericSlot(i, analysis.type, analysis.color);
      report.slots.push({ slot: i + 1, action: 'normalize_generic', preset: analysis.settingsId });
    }
  }

  normalizePreservedProjectFilamentNames(
    combined,
    origSettings,
    preservedSlots
  );

  for (const key of filamentKeys) {
    if (!Array.isArray(combined[key])) continue;

    while (combined[key].length < targetFilamentCount) {
      combined[key].push('');
    }

    combined[key] = combined[key].slice(
      0,
      targetFilamentCount
    );
  }

  if (options.orcaCompatibility === true) {
    normalizeRequiredOrcaFilamentArrays(
      combined,
      targetFilamentCount
    );
  }

  for (let i = 0; i < targetFilamentCount; i++) {
    combined.inherits_group[i] = '';
  }

  const processDiff = parseDifferentSettingsToSystem(
    Array.isArray(combined.different_settings_to_system)
      ? combined.different_settings_to_system[0]
      : combined.different_settings_to_system
  )
    .filter(key => !String(key || '').toLowerCase().startsWith('filament_'))
    .join(';');

  const diff = Array.from({ length: targetFilamentCount + 1 }, () => '');
  diff[0] = processDiff;

  // Important:
  // Preserve original per-slot filament diffs when present.
  // If the source has no filament-specific diff but the filament is kept
  // as a Project Inside preset, synthesize the minimal filament diff so
  // SnOrca continues to treat the slot as a project filament instead of
  // falling back to a system preset.
  for (let i = 0; i < targetFilamentCount; i++) {
    const sourceDiff = getFilamentDiffForSlot(origSettings, i);

    if (sourceDiff) {
      diff[i + 1] = sourceDiff;
      continue;
    }

    if (preservedSlots.has(i)) {
      diff[i + 1] =
        'filament_settings_id;filament_vendor;filament_type;filament_colour;filament_ids';
    }
  }

  combined.different_settings_to_system = diff;
  return report;
}
