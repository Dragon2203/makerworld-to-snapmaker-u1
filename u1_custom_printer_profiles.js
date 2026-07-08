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