// Browser-neutral helper logic for SnOrca/Snapmaker U1 custom printer profiles.
// No chrome.* API usage here on purpose.

const U1_CUSTOM_PRINTER_STANDARD_ID = '__standard_u1_printer_profile__';

const U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY = 'u1CustomPrinterProfiles';

const U1_CUSTOM_PRINTER_MANAGEMENT_KEYS = new Set([
  'name',
  'inherits',
  'from',
  'is_custom_defined',
  'version',
  'setting_id',
  'instantiation',
  'filament_settings_id',
  'print_settings_id',

  // handled separately as selected printer profile name
  'printer_settings_id',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCustomPrinterProfileName(raw) {
  return String(raw || '').trim();
}

function getCustomPrinterProfileId(json, fallbackName = '') {
  return normalizeCustomPrinterProfileName(
    json?.printer_settings_id ||
    json?.name ||
    fallbackName.replace(/\.json$/i, '')
  );
}

function isCustomPrinterProfileManagementKey(key) {
  return U1_CUSTOM_PRINTER_MANAGEMENT_KEYS.has(String(key || ''));
}

function isLikelyMachineOverrideKey(key) {
  const k = String(key || '').toLowerCase();

  return (
    k.startsWith('machine_') ||
    k.startsWith('printer_') ||
    k.startsWith('before_layer_change_gcode') ||
    k.startsWith('layer_change_gcode') ||
    k.startsWith('change_filament_gcode') ||
    k === 'support_multi_bed_types' ||
    k === 'template_custom_gcode'
  );
}

function extractCustomPrinterProfileOverrides(json) {
  const overrides = {};

  for (const [key, value] of Object.entries(json || {})) {
    if (!key) continue;
    if (isCustomPrinterProfileManagementKey(key)) continue;

    overrides[key] = value;
  }

  return overrides;
}

function normalizeCustomPrinterProfileJson(json, sourceFileName = '') {
  if (!isPlainObject(json)) {
    throw new Error('Profile JSON must be an object.');
  }

  const id = getCustomPrinterProfileId(json, sourceFileName);

  if (!id) {
    throw new Error('Profile has no printer_settings_id or name.');
  }

  const overrides = extractCustomPrinterProfileOverrides(json);
  const overrideKeys = Object.keys(overrides);
  const machineOverrideKeys = overrideKeys.filter(isLikelyMachineOverrideKey);

  if (!overrideKeys.length) {
    throw new Error(`Profile "${id}" has no override settings.`);
  }

  const inheritedFrom = normalizeCustomPrinterProfileName(json.inherits || '');

  return {
    id,
    displayName: id,
    printer_settings_id: id,
    inheritedFrom,
    sourceFileName: sourceFileName || '',
    importedAt: new Date().toISOString(),

    overrideCount: overrideKeys.length,
    machineOverrideCount: machineOverrideKeys.length,

    overrideKeys,
    machineOverrideKeys,

    overrides,

    // Keep the raw imported file for later diagnostics and future SnOrca changes.
    // The converter uses "overrides"; this is only reference/debug data.
    original: JSON.parse(JSON.stringify(json)),
  };
}

function buildCustomPrinterProfileSelectRows(profileMap = {}) {
  return Object.values(profileMap || {})
    .filter(p => p && p.id)
    .sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)))
    .map(p => ({
      id: p.id,
      displayName: p.displayName || p.id,
      inheritedFrom: p.inheritedFrom || '',
      overrideCount: Array.isArray(p.overrideKeys) ? p.overrideKeys.length : Object.keys(p.overrides || {}).length,
      machineOverrideCount: Array.isArray(p.machineOverrideKeys) ? p.machineOverrideKeys.length : 0,
    }));
}

function cloneCustomPrinterProfileValue(value) {
  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.parse(JSON.stringify(value));
  }

  return value;
}

function ensureCustomPrinterProfileArraySlot(settings, key, index) {
  if (!Array.isArray(settings[key])) {
    settings[key] = [];
  }

  while (settings[key].length <= index) {
    settings[key].push('');
  }

  return settings[key];
}

function applyCustomPrinterProfileToU1Settings(settings, customPrinterProfile, options = {}) {
  const targetFilamentCount = options.targetFilamentCount || 4;
  const machineIndex = targetFilamentCount + 1;

  const report = {
    enabled: false,
    selected: '',
    inheritedFrom: '',
    overrideCount: 0,
    overrideKeys: [],
    machineIndex,
    applied: [],
    skipped: [],
  };

  if (!settings || !customPrinterProfile || !customPrinterProfile.overrides) {
    return report;
  }

  const profileId =
    customPrinterProfile.printer_settings_id ||
    customPrinterProfile.id ||
    customPrinterProfile.displayName ||
    '';

  if (!profileId) {
    report.skipped.push({
      reason: 'missing-profile-id',
    });
    return report;
  }

  const inheritedFrom =
    customPrinterProfile.inheritedFrom ||
    settings.printer_settings_id ||
    'Snapmaker U1 (0.4 nozzle)';

  const overrides = customPrinterProfile.overrides || {};
  const overrideKeys = Object.keys(overrides).filter(Boolean);

  settings.printer_settings_id = profileId;

  const inheritsGroup = ensureCustomPrinterProfileArraySlot(
    settings,
    'inherits_group',
    machineIndex
  );

  inheritsGroup[machineIndex] = inheritedFrom;

  for (const key of overrideKeys) {
    if (isCustomPrinterProfileManagementKey(key)) {
      report.skipped.push({
        key,
        reason: 'management-key',
      });
      continue;
    }

    settings[key] = cloneCustomPrinterProfileValue(overrides[key]);

    report.applied.push({
      key,
      valueType: Array.isArray(overrides[key]) ? 'array' : typeof overrides[key],
    });
  }

  const diff = ensureCustomPrinterProfileArraySlot(
    settings,
    'different_settings_to_system',
    machineIndex
  );

  const existingMachineDiff = String(diff[machineIndex] || '')
    .split(/[;,\n]/)
    .map(s => s.trim())
    .filter(Boolean);

  diff[machineIndex] = Array.from(new Set([
    ...existingMachineDiff,
    ...report.applied.map(row => row.key),
  ])).join(';');

  report.enabled = true;
  report.selected = profileId;
  report.inheritedFrom = inheritedFrom;
  report.overrideKeys = report.applied.map(row => row.key);
  report.overrideCount = report.overrideKeys.length;

  return report;
}
// -----------------------------------------------------------------------------
// OrcaSlicer compatibility
// -----------------------------------------------------------------------------

const U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY =
  'u1OrcaCustomPrinterProfiles';

const U1_ORCA_STANDARD_PRINTER_ID =
  'Snapmaker U1 (0.4 nozzle)';

// Exact printer override list confirmed by the successful native-Orca
// 12-extruder and 5-extruder tests.
const U1_ORCA_PRINTER_DIRTY_KEYS = [
  'default_nozzle_volume_type',
  'deretraction_speed',
  'extruder_colour',
  'extruder_offset',
  'extruder_printable_height',
  'extruder_type',
  'extruder_variant_list',
  'long_retractions_when_cut',
  'max_layer_height',
  'min_layer_height',
  'nozzle_diameter',
  'nozzle_flush_dataset',
  'nozzle_type',
  'nozzle_volume',
  'print_host',
  'printer_extruder_id',
  'printer_extruder_variant',
  'retract_before_wipe',
  'retract_length_toolchange',
  'retract_lift_above',
  'retract_lift_below',
  'retract_lift_enforce',
  'retract_restart_extra',
  'retract_restart_extra_toolchange',
  'retract_when_changing_layer',
  'retraction_distances_when_cut',
  'retraction_length',
  'retraction_minimum_travel',
  'retraction_speed',
  'support_multi_bed_types',
  'travel_slope',
  'wipe',
  'wipe_distance',
  'z_hop',
  'z_hop_types',
];

// These are the exact 4-slot arrays that became 5-slot arrays in the
// successful dynamic 5-filament test. Keeping the list explicit prevents
// unrelated process arrays from being expanded accidentally.
const U1_ORCA_EXTRUDER_ARRAY_KEYS = new Set([
  'activate_air_filtration',
  'activate_chamber_temp_control',
  'adaptive_pressure_advance',
  'adaptive_pressure_advance_bridges',
  'adaptive_pressure_advance_model',
  'adaptive_pressure_advance_overhangs',
  'additional_cooling_fan_speed',
  'chamber_temperature',
  'close_fan_the_first_x_layers',
  'complete_print_exhaust_fan_speed',
  'cool_plate_temp',
  'cool_plate_temp_initial_layer',
  'default_filament_colour',
  'deretraction_speed',
  'dont_slow_down_outer_wall',
  'during_print_exhaust_fan_speed',
  'enable_overhang_bridge_fan',
  'enable_pressure_advance',
  'eng_plate_temp',
  'eng_plate_temp_initial_layer',
  'extruder_colour',
  'extruder_offset',
  'fan_cooling_layer_time',
  'fan_max_speed',
  'fan_min_speed',
  'full_fan_speed_layer',
  'hot_plate_temp',
  'hot_plate_temp_initial_layer',
  'idle_temperature',
  'internal_bridge_fan_speed',
  'ironing_fan_speed',
  'long_retractions_when_cut',
  'max_layer_height',
  'min_layer_height',
  'nozzle_diameter',
  'nozzle_temperature',
  'nozzle_temperature_initial_layer',
  'nozzle_temperature_range_high',
  'nozzle_temperature_range_low',
  'overhang_fan_speed',
  'overhang_fan_threshold',
  'pellet_flow_coefficient',
  'pressure_advance',
  'reduce_fan_stop_start_freq',
  'required_nozzle_HRC',
  'retract_before_wipe',
  'retract_length_toolchange',
  'retract_lift_above',
  'retract_lift_below',
  'retract_lift_enforce',
  'retract_restart_extra',
  'retract_restart_extra_toolchange',
  'retract_when_changing_layer',
  'retraction_distances_when_cut',
  'retraction_length',
  'retraction_minimum_travel',
  'retraction_speed',
  'slow_down_for_layer_cooling',
  'slow_down_layer_time',
  'slow_down_min_speed',
  'supertack_plate_temp',
  'supertack_plate_temp_initial_layer',
  'support_material_interface_fan_speed',
  'temperature_vitrification',
  'textured_cool_plate_temp',
  'textured_cool_plate_temp_initial_layer',
  'textured_plate_temp',
  'textured_plate_temp_initial_layer',
  'travel_slope',
  'wipe',
  'wipe_distance',
  'z_hop',
  'z_hop_types',
]);

const U1_ORCA_REQUIRED_ARRAY_DEFAULTS = {
  default_nozzle_volume_type: 'Standard',
  deretraction_speed: '35',
  extruder_colour: '#FCE94F',
  extruder_offset: '0x0',
  extruder_printable_height: '0',
  extruder_type: 'Direct Drive',
  extruder_variant_list: 'Direct Drive Standard',
  long_retractions_when_cut: '0',
  max_layer_height: '0.32',
  min_layer_height: '0.08',
  nozzle_diameter: '0.4',
  nozzle_flush_dataset: 'nil',
  nozzle_type: 'stainless_steel',
  nozzle_volume: '143',
  printer_extruder_variant: 'Direct Drive Standard',
  retract_before_wipe: '0%',
  retract_length_toolchange: '10',
  retract_lift_above: '0',
  retract_lift_below: '269',
  retract_lift_enforce: 'All Surfaces',
  retract_restart_extra: '0',
  retract_restart_extra_toolchange: '0',
  retract_when_changing_layer: '1',
  retraction_distances_when_cut: '18',
  retraction_length: '0.8',
  retraction_minimum_travel: '1',
  retraction_speed: '40',
  travel_slope: '3',
  wipe: '1',
  wipe_distance: '2',
  z_hop: '0.4',
  z_hop_types: 'Auto Lift',
};

function isInvalidOrcaPrinterValue(value) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    value === 'nil'
  );
}

function getLastValidOrcaPrinterValue(values, fallback) {
  if (Array.isArray(values)) {
    for (let index = values.length - 1; index >= 0; index--) {
      if (!isInvalidOrcaPrinterValue(values[index])) {
        return cloneCustomPrinterProfileValue(values[index]);
      }
    }
  } else if (!isInvalidOrcaPrinterValue(values)) {
    return cloneCustomPrinterProfileValue(values);
  }

  return cloneCustomPrinterProfileValue(fallback);
}

function getOrcaCustomProfileExtruderCount(customPrinterProfile) {
  const overrides =
    customPrinterProfile?.overrides || {};

  const extruderArrayKeys = new Set([
    ...U1_ORCA_EXTRUDER_ARRAY_KEYS,
    ...Object.keys(U1_ORCA_REQUIRED_ARRAY_DEFAULTS),
    'printer_extruder_id',
  ]);

  let extruderCount = 0;

  for (const key of extruderArrayKeys) {
    const value = overrides[key];

    if (Array.isArray(value)) {
      extruderCount = Math.max(
        extruderCount,
        value.length
      );
    }
  }

  return extruderCount;
}

function normalizeOrcaPrinterArray(settings, key, targetExtruderCount, fallback) {
  const current = settings[key];
  const fillValue = getLastValidOrcaPrinterValue(current, fallback);
  const source = Array.isArray(current)
    ? current.slice(0, targetExtruderCount)
    : [];

  for (let index = 0; index < source.length; index++) {
    if (isInvalidOrcaPrinterValue(source[index]) && key !== 'nozzle_flush_dataset') {
      source[index] = cloneCustomPrinterProfileValue(fillValue);
    }
  }

  while (source.length < targetExtruderCount) {
    source.push(cloneCustomPrinterProfileValue(fillValue));
  }

  settings[key] = source;
}

function applyOrcaCompatibilityToU1Settings(
  settings,
  customPrinterProfile,
  options = {}
) {
  const projectFilamentCount =
    Number(options.targetFilamentCount) || 0;

  const customProfileExtruderCount =
    getOrcaCustomProfileExtruderCount(
      customPrinterProfile
    );

  const targetExtruderCount = Math.max(
    4,
    projectFilamentCount,
    customProfileExtruderCount
  );

  const machineIndex =
    targetExtruderCount + 1;

  const customReport = applyCustomPrinterProfileToU1Settings(
    settings,
    customPrinterProfile,
    { targetFilamentCount: targetExtruderCount }
  );

  if (!customReport.enabled) {
    settings.printer_settings_id = U1_ORCA_STANDARD_PRINTER_ID;

    const inheritsGroup = ensureCustomPrinterProfileArraySlot(
      settings,
      'inherits_group',
      machineIndex
    );

    inheritsGroup[machineIndex] = U1_ORCA_STANDARD_PRINTER_ID;
  }

  const normalizedArrayKeys = new Set();

  for (const key of U1_ORCA_EXTRUDER_ARRAY_KEYS) {
    if (!Array.isArray(settings[key])) continue;

    normalizeOrcaPrinterArray(
      settings,
      key,
      targetExtruderCount,
      settings[key][settings[key].length - 1]
    );

    normalizedArrayKeys.add(key);
  }

  for (const [key, fallback] of Object.entries(U1_ORCA_REQUIRED_ARRAY_DEFAULTS)) {
    normalizeOrcaPrinterArray(
      settings,
      key,
      targetExtruderCount,
      fallback
    );

    normalizedArrayKeys.add(key);
  }

  settings.printer_extruder_id = Array.from(
    { length: targetExtruderCount },
    (_, index) => String(index + 1)
  );

  if (settings.support_multi_bed_types === undefined) {
    settings.support_multi_bed_types = '1';
  }

  const diff = ensureCustomPrinterProfileArraySlot(
    settings,
    'different_settings_to_system',
    machineIndex
  );

  const existingMachineDiff = String(diff[machineIndex] || '')
    .split(/[;,\n]/)
    .map(value => value.trim())
    .filter(Boolean);

  diff[machineIndex] = Array.from(new Set([
    ...existingMachineDiff,
    ...U1_ORCA_PRINTER_DIRTY_KEYS,
    ...(customReport.overrideKeys || []),
  ])).join(';');

  const printerDirtyKeys = diff[machineIndex]
    .split(';')
    .filter(Boolean);

  return {
    ...customReport,

    // "enabled" here means that the Orca compatibility pass ran.
    // Whether a custom printer profile was applied is reported separately.
    enabled: true,
    compatibilityMode: 'orca',
    targetSlicer: 'OrcaSlicer',

    standardProfile: !customReport.enabled,
    customProfileApplied: customReport.enabled === true,

    projectFilamentCount,
    customProfileExtruderCount,
    targetExtruderCount,
    machineIndex,

    normalizedArrayKeys: Array.from(normalizedArrayKeys).sort(),
    normalizedArrayCount: normalizedArrayKeys.size,

    printerDirtyKeys,
    printerDirtyKeyCount: printerDirtyKeys.length,
  };
}
