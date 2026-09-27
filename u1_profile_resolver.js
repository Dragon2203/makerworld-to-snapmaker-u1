// Resolves Bambu process profile names to Snapmaker Orca/U1 system preset names.
//
// SnOrca only recognizes presets when print_settings_id/default_print_profile
// exactly match the internal U1 preset label.

const U1_PROCESS_PROFILE_FAMILIES = {
  '0.2': {
    defaultProfileId: '0.10mm-standard-0.2',

    profiles: {
      '0.06mm High Quality': {
        id: '0.06mm-high-quality-0.2',
        mappedBase: '0.06 High Quality',
      },
      '0.06mm Standard': {
        id: '0.06mm-standard-0.2',
        mappedBase: '0.06 Standard',
      },
      '0.08mm High Quality': {
        id: '0.08mm-high-quality-0.2',
        mappedBase: '0.08 High Quality',
      },
      '0.08mm Standard': {
        id: '0.08mm-standard-0.2',
        mappedBase: '0.08 Standard',
      },
      '0.10mm High Quality': {
        id: '0.10mm-high-quality-0.2',
        mappedBase: '0.10 High Quality',
      },
      '0.10mm Standard': {
        id: '0.10mm-standard-0.2',
        mappedBase: '0.10 Standard',
      },
      '0.12mm Standard': {
        id: '0.12mm-standard-0.2',
        mappedBase: '0.12 Standard',
      },
      '0.14mm Standard': {
        id: '0.14mm-standard-0.2',
        mappedBase: '0.14 Standard',
      },
    },

    layerFallbacks: {
      '0.06': '0.06mm-high-quality-0.2',
      '0.08': '0.08mm-high-quality-0.2',
      '0.10': '0.10mm-standard-0.2',
      '0.12': '0.12mm-standard-0.2',
      '0.14': '0.14mm-standard-0.2',
    },
  },

  '0.4': {
    defaultProfileId: '0.20mm-standard',

    profiles: {
      '0.08mm Extra Fine': {
        id: '0.08mm-extra-fine',
        mappedBase: '0.08 Extra Fine',
      },
      '0.08mm High Quality': {
        id: '0.08mm-high-quality',
        mappedBase: '0.08 High Quality',
      },
      '0.12mm Fine': {
        id: '0.12mm-fine',
        mappedBase: '0.12 Fine',
      },
      '0.12mm High Quality': {
        id: '0.12mm-high-quality',
        mappedBase: '0.12 High Quality',
      },
      '0.16mm High Quality': {
        id: '0.16mm-high-quality',
        mappedBase: '0.16 High Quality',
      },
      '0.16mm Optimal': {
        id: '0.16mm-optimal',
        mappedBase: '0.16 Optimal',
      },
      '0.20mm Standard': {
        id: '0.20mm-standard',
        mappedBase: '0.20 Standard',
      },
      '0.20mm Strength': {
        id: '0.20mm-strength',
        mappedBase: '0.20 Strength',
      },
      '0.24mm Draft': {
        id: '0.24mm-draft',
        mappedBase: '0.24 Draft',
      },
      '0.28mm Extra Draft': {
        id: '0.28mm-extra-draft',
        mappedBase: '0.28 Extra Draft',
      },
    },

    layerFallbacks: {
      '0.08': '0.08mm-high-quality',
      '0.12': '0.12mm-high-quality',
      '0.16': '0.16mm-high-quality',
      '0.20': '0.20mm-standard',
      '0.24': '0.24mm-draft',
      '0.28': '0.28mm-extra-draft',
    },
  },

  '0.6': {
    defaultProfileId: '0.30mm-standard-0.6',

    profiles: {
      '0.18mm Standard': {
        id: '0.18mm-standard-0.6',
        mappedBase: '0.18 Standard',
      },
      '0.24mm Standard': {
        id: '0.24mm-standard-0.6',
        mappedBase: '0.24 Standard',
      },
      '0.30mm Standard': {
        id: '0.30mm-standard-0.6',
        mappedBase: '0.30 Standard',
      },
      '0.30mm Strength': {
        id: '0.30mm-strength-0.6',
        mappedBase: '0.30 Strength',
      },
      '0.36mm Standard': {
        id: '0.36mm-standard-0.6',
        mappedBase: '0.36 Standard',
      },
      '0.42mm Standard': {
        id: '0.42mm-standard-0.6',
        mappedBase: '0.42 Standard',
      },
    },

    layerFallbacks: {
      '0.18': '0.18mm-standard-0.6',
      '0.24': '0.24mm-standard-0.6',
      '0.30': '0.30mm-standard-0.6',
      '0.36': '0.36mm-standard-0.6',
      '0.42': '0.42mm-standard-0.6',
    },
  },

  '0.8': {
    defaultProfileId: '0.40mm-standard-0.8',

    profiles: {
      '0.24mm Standard': {
        id: '0.24mm-standard-0.8',
        mappedBase: '0.24 Standard',
      },
      '0.32mm Standard': {
        id: '0.32mm-standard-0.8',
        mappedBase: '0.32 Standard',
      },
      '0.40mm Standard': {
        id: '0.40mm-standard-0.8',
        mappedBase: '0.40 Standard',
      },
      '0.48mm Standard': {
        id: '0.48mm-standard-0.8',
        mappedBase: '0.48 Standard',
      },
      '0.56mm Standard': {
        id: '0.56mm-standard-0.8',
        mappedBase: '0.56 Standard',
      },
    },

    layerFallbacks: {
      '0.24': '0.24mm-standard-0.8',
      '0.32': '0.32mm-standard-0.8',
      '0.40': '0.40mm-standard-0.8',
      '0.48': '0.48mm-standard-0.8',
      '0.56': '0.56mm-standard-0.8',
    },
  },
};

function getU1ProcessProfileFamily(nozzleDiameter = '0.4') {
  return U1_PROCESS_PROFILE_FAMILIES[nozzleDiameter] || null;
}

function buildU1ProcessProfileIdMap(nozzleDiameter = '0.4') {
  const family = getU1ProcessProfileFamily(nozzleDiameter);
  if (!family) return {};

  return Object.fromEntries(
    Object.entries(family.profiles).map(([sourceBase, row]) => [
      row.id,
      {
        sourceBase,
        ...row,
        resolvedLabel: `${row.mappedBase} @Snapmaker U1 (${nozzleDiameter} nozzle)`,
      }
    ])
  );
}

function getU1ProcessLayerFallback(candidate, nozzleDiameter = '0.4') {
  if (!candidate?.layerHeight) return null;

  const family = getU1ProcessProfileFamily(nozzleDiameter);
  if (!family) return null;

  const profileId =
    family.layerFallbacks[candidate.layerHeight];

  if (!profileId) return null;

  const profileIdMap =
    buildU1ProcessProfileIdMap(nozzleDiameter);

  return profileIdMap[profileId] || null;
}

function parseBambuProcessProfileName(name, nozzleDiameter = '0.4') {
  const value = String(name || '').trim();
  if (!value) return null;

  const family = getU1ProcessProfileFamily(nozzleDiameter);
  const profileMap = family?.profiles || {};
  const profileIdMap = buildU1ProcessProfileIdMap(nozzleDiameter);

  const bambuMatch = value.match(/(\d+(?:\.\d+)?)mm\s+(.+?)\s+@/i);

  if (bambuMatch) {
    const sourceBase = `${bambuMatch[1]}mm ${bambuMatch[2].trim()}`;
    const mapped = profileMap[sourceBase];

    return {
      original: value,
      sourceBase,
      layerHeight: bambuMatch[1],
      mappedBase: mapped?.mappedBase || sourceBase,
      profileId: mapped?.id || '',
      resolvedLabel: mapped
        ? `${mapped.mappedBase} @Snapmaker U1 (${nozzleDiameter} nozzle)`
        : '',
      knownMapping: !!mapped,
    };
  }

  const u1Match = value.match(/(\d+(?:\.\d+)?)\s+(.+?)\s+@Snapmaker U1/i);

  if (u1Match) {
    const mappedBase = `${u1Match[1]} ${u1Match[2].trim()}`;
    const found = Object.values(profileIdMap)
      .find(row => row.mappedBase.toLowerCase() === mappedBase.toLowerCase());

    return {
      original: value,
      sourceBase: found?.sourceBase || mappedBase,
      layerHeight: u1Match[1],
      mappedBase,
      profileId: found?.id || '',
      resolvedLabel: found?.resolvedLabel || value,
      knownMapping: !!found,
    };
  }

  return null;
}

function resolveU1ProcessProfile(origSettings, options = {}) {
  const mode = options.printProfileMode === 'force' ? 'force' : 'preserve';

  const targetNozzle =
    options.targetNozzle && typeof options.targetNozzle === 'object'
      ? options.targetNozzle
      : {
          nozzleDiameter: '0.4',
          source: 'fallback',
          inheritedFrom: '',
        };

  const targetNozzleDiameter =
    targetNozzle.nozzleDiameter ||
    '0.4';

  const printSettingsCandidate =
    parseBambuProcessProfileName(
      origSettings.print_settings_id,
      targetNozzleDiameter
    );

  const defaultProfileCandidate =
    parseBambuProcessProfileName(
      origSettings.default_print_profile,
      targetNozzleDiameter
    );

  const withTargetNozzle = (result) => ({
    ...result,

    target_nozzle_diameter: targetNozzleDiameter,
    target_nozzle_source: targetNozzle.source || 'fallback',
    target_nozzle_inherited_from: targetNozzle.inheritedFrom || '',
  });

  if (mode === 'force') {
    const family =
      getU1ProcessProfileFamily(targetNozzleDiameter) ||
      getU1ProcessProfileFamily('0.4');

    const profileIdMap =
      buildU1ProcessProfileIdMap(
        getU1ProcessProfileFamily(targetNozzleDiameter)
          ? targetNozzleDiameter
          : '0.4'
      );

    const forcedProfileId =
      options.forcedProfileId ||
      family.defaultProfileId;

    const forced =
      profileIdMap[forcedProfileId] ||
      profileIdMap[family.defaultProfileId];

    return withTargetNozzle({
      mode,
      profileId: forced.id,
      forcedProfileId: forced.id,

      source_print_settings_id: String(origSettings.print_settings_id || ''),
      source_default_print_profile: String(origSettings.default_print_profile || ''),

      print_settings_candidate: printSettingsCandidate,
      default_profile_candidate: defaultProfileCandidate,

      selected_source_profile: '',
      source_ignored: defaultProfileCandidate?.original || printSettingsCandidate?.original || '',

      resolved_u1_profile: forced.resolvedLabel,
      source_base: forced.sourceBase,
      mapped_base: forced.mappedBase,

      selection_reason: 'force',
    });
  }

  if (printSettingsCandidate?.knownMapping) {
    return withTargetNozzle({
      mode,
      profileId: printSettingsCandidate.profileId,

      source_print_settings_id: String(origSettings.print_settings_id || ''),
      source_default_print_profile: String(origSettings.default_print_profile || ''),

      print_settings_candidate: printSettingsCandidate,
      default_profile_candidate: defaultProfileCandidate,

      selected_source_profile: printSettingsCandidate.original,
      resolved_u1_profile: printSettingsCandidate.resolvedLabel,
      source_base: printSettingsCandidate.sourceBase,
      mapped_base: printSettingsCandidate.mappedBase,

      selection_reason: 'print_settings_id',
    });
  }

  const printSettingsLayerFallback =
    getU1ProcessLayerFallback(
      printSettingsCandidate,
      targetNozzleDiameter
    );

  if (printSettingsLayerFallback) {
    return withTargetNozzle({
      mode,
      profileId: printSettingsLayerFallback.id,

      source_print_settings_id: String(origSettings.print_settings_id || ''),
      source_default_print_profile: String(origSettings.default_print_profile || ''),

      print_settings_candidate: printSettingsCandidate,
      default_profile_candidate: defaultProfileCandidate,

      selected_source_profile: printSettingsCandidate.original,
      resolved_u1_profile: printSettingsLayerFallback.resolvedLabel,
      source_base: printSettingsCandidate.sourceBase,
      mapped_base: printSettingsLayerFallback.mappedBase,

      layer_fallback: true,
      selection_reason: 'print_settings_id_layer',
    });
  }

  if (defaultProfileCandidate?.knownMapping) {
    return withTargetNozzle({
      mode,
      profileId: defaultProfileCandidate.profileId,

      source_print_settings_id: String(origSettings.print_settings_id || ''),
      source_default_print_profile: String(origSettings.default_print_profile || ''),

      print_settings_candidate: printSettingsCandidate,
      default_profile_candidate: defaultProfileCandidate,

      selected_source_profile: defaultProfileCandidate.original,
      resolved_u1_profile: defaultProfileCandidate.resolvedLabel,
      source_base: defaultProfileCandidate.sourceBase,
      mapped_base: defaultProfileCandidate.mappedBase,

      selection_reason: 'default_print_profile',
    });
  }

  const defaultProfileLayerFallback =
    getU1ProcessLayerFallback(
      defaultProfileCandidate,
      targetNozzleDiameter
    );

  if (defaultProfileLayerFallback) {
    return withTargetNozzle({
      mode,
      profileId: defaultProfileLayerFallback.id,

      source_print_settings_id: String(origSettings.print_settings_id || ''),
      source_default_print_profile: String(origSettings.default_print_profile || ''),

      print_settings_candidate: printSettingsCandidate,
      default_profile_candidate: defaultProfileCandidate,

      selected_source_profile: defaultProfileCandidate.original,
      resolved_u1_profile: defaultProfileLayerFallback.resolvedLabel,
      source_base: defaultProfileCandidate.sourceBase,
      mapped_base: defaultProfileLayerFallback.mappedBase,

      layer_fallback: true,
      selection_reason: 'default_print_profile_layer',
    });
  }

  const fallbackFamily =
    getU1ProcessProfileFamily(targetNozzleDiameter) ||
    getU1ProcessProfileFamily('0.4');

  const fallbackProfileId =
    fallbackFamily.defaultProfileId;

  const fallbackProfileIdMap =
    buildU1ProcessProfileIdMap(
      getU1ProcessProfileFamily(targetNozzleDiameter)
        ? targetNozzleDiameter
        : '0.4'
    );

  const fallback =
    fallbackProfileIdMap[fallbackProfileId];

  return withTargetNozzle({
    mode,
    profileId: fallback.id,

    source_print_settings_id: String(origSettings.print_settings_id || ''),
    source_default_print_profile: String(origSettings.default_print_profile || ''),

    print_settings_candidate: printSettingsCandidate,
    default_profile_candidate: defaultProfileCandidate,

    selected_source_profile: '',
    resolved_u1_profile: fallback.resolvedLabel,
    source_base: fallback.sourceBase,
    mapped_base: fallback.mappedBase,

    fallback: true,
    selection_reason: 'fallback',
  });
}

function applyResolvedU1ProcessPreset(combined, origSettings, resolvedProfile = {}, loadedProfileSettings = {}) {
  const resolvedLabel =
    loadedProfileSettings.print_settings_id ||
    loadedProfileSettings.default_print_profile ||
    resolvedProfile.resolved_u1_profile ||
    '';

  if (!resolvedLabel) {
    throw new Error(
      `Resolved U1 process profile "${resolvedProfile.profileId || 'unknown'}" ` +
      `does not provide a valid print profile label for target nozzle ` +
      `${resolvedProfile.target_nozzle_diameter || 'unknown'}.`
    );
  }

  combined.print_settings_id = resolvedLabel;
  combined.default_print_profile = resolvedLabel;
  combined.from = 'project';

  combined.different_settings_to_system = [
    Array.from(new Set(
      parseDifferentSettingsToSystem(combined.different_settings_to_system)
    )).join(';'),
    '',
    '',
    '',
    '',
    ''
  ];

  return {
    ...resolvedProfile,
    resolved_u1_profile: resolvedLabel,
  };
}