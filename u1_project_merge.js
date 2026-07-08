// Merges portable process settings from the source project into the U1 template.
//
// Printer-, machine- and filament-specific settings intentionally remain
// controlled by the selected U1 profile.

function parseDifferentSettingsToSystem(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(';') : String(value);
  return raw.split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
}

function bambuCurrentValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isBlockedForU1ProjectMerge(key) {
  const k = String(key || '').toLowerCase();
  return (
    k.startsWith('machine_') ||
    k.startsWith('printer_') ||
    k.startsWith('bed_') ||
    k.startsWith('fan_') ||
    k.startsWith('filament_') ||
    k.startsWith('retract') ||
    k.startsWith('deretraction') ||
    k.startsWith('extruder') ||
    k.startsWith('nozzle') ||
    k.includes('gcode') ||
    k.includes('temperature') ||
    k === 'curr_bed_type' ||
    k === 'printable_area' ||
    k === 'printable_height'
  );
}

function isPortableProcessKey(key) {
  const k = String(key || '').toLowerCase();
  if (isBlockedForU1ProjectMerge(k)) return false;

  return (
    k.includes('layer') ||
    k.includes('wall') ||
    k.includes('infill') ||
    k.includes('support') ||
    k.includes('brim') ||
    k.includes('raft') ||
    k.includes('skirt') ||
    k.includes('seam') ||
    k.includes('bridge') ||
    k.includes('overhang') ||
    k.includes('speed') ||
    k.includes('accel') ||
    k.includes('ironing') ||
    k.includes('fuzzy_skin') ||
    k.includes('elefant') ||
    k.includes('elephant') ||
    k.includes('gap') ||
    k.includes('hole') ||
    k.includes('thin') ||
    k.includes('order') ||
    k.includes('sequence') ||
    k.includes('threshold') ||
    k.includes('resolution') ||
    k.includes('spiral') ||
    k.includes('wipe') ||
    k.includes('xy_') ||
    k === 'print_sequence'
  );
}

const FORCE_PROFILE_LOCKED_PROCESS_KEYS = new Set([
  'layer_height',
  'initial_layer_print_height',
]);

function coerceValueForU1Template(sourceValue, targetValue) {
  const v = bambuCurrentValue(sourceValue);
  if (Array.isArray(targetValue) && !Array.isArray(v)) {
    return targetValue.map(() => v);
  }
  return v;
}

function classifyProcessMergeKey(key, combined) {
  const existsInU1Template = Object.prototype.hasOwnProperty.call(combined, key);
  const blocked = isBlockedForU1ProjectMerge(key);
  const portable = isPortableProcessKey(key);

  let category = 'unknown';

  if (blocked) {
    category = 'blocked';
  } else if (existsInU1Template) {
    category = 'native_u1';
  } else if (portable) {
    category = 'portable_heuristic';
  }

  return {
    key,
    category,
    blocked,
    existsInU1Template,
    portableByHeuristic: portable,
  };
}

function mergeBambuProcessSettingsIntoU1(combined, origSettings, options = {}) {
  const smartProcessMerge = options.smartProcessMerge !== false;
  const strictProcessMerge = options.strictProcessMerge === true;

  const keys = new Set(parseDifferentSettingsToSystem(origSettings.different_settings_to_system));

  ['layer_height', 'initial_layer_print_height'].forEach(k => {
    if (origSettings[k] !== undefined) keys.add(k);
  });

  const report = {
    mode: smartProcessMerge ? 'smart' : 'legacy',
    strict: strictProcessMerge,
    candidates: [],
    merged: [],
    blocked: [],
    skipped: [],
  };

  for (const key of keys) {
    const classification = classifyProcessMergeKey(key, combined);

    const row = {
      ...classification,
      sourceValue: origSettings[key],
      finalValue: undefined,
      reason: '',
    };

  if (
    options.printProfileMode === 'force' &&
    FORCE_PROFILE_LOCKED_PROCESS_KEYS.has(key)
  ) {
    row.finalValue = combined[key];
    row.reason = 'locked-by-forced-print-profile';
    report.skipped.push(row);
    continue;
  }

    report.candidates.push(row);

    if (!key || origSettings[key] === undefined) {
      row.reason = 'missing-in-source-settings';
      report.skipped.push(row);
      continue;
    }

    if (classification.blocked) {
      row.reason = 'blocked-u1-printer-machine-filament-or-gcode-key';
      report.blocked.push(row);
      continue;
    }

    if (strictProcessMerge && !classification.existsInU1Template) {
      row.reason = 'strict-mode-key-not-in-u1-template';
      report.skipped.push(row);
      continue;
    }

    if (smartProcessMerge && !classification.existsInU1Template && !classification.portableByHeuristic) {
      row.reason = 'smart-mode-not-portable';
      report.skipped.push(row);
      continue;
    }

    if (!smartProcessMerge && !classification.existsInU1Template && !classification.portableByHeuristic) {
      row.reason = 'legacy-unknown';
      report.skipped.push(row);
      continue;
    }

    combined[key] = coerceValueForU1Template(origSettings[key], combined[key]);

    row.finalValue = combined[key];
    row.reason = classification.existsInU1Template
      ? 'merged-native-u1-key'
      : 'merged-portable-heuristic-key';

    report.merged.push(row);
  }

  combined.different_settings_to_system = [
    Array.from(new Set([
      ...parseDifferentSettingsToSystem(combined.different_settings_to_system),
      ...report.merged.map(row => row.key)
    ])).join(';'),
    '',
    '',
    '',
    '',
    ''
  ];

  return report;
}