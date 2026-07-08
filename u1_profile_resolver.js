// Resolves Bambu process profile names to Snapmaker Orca/U1 system preset names.
//
// SnOrca only recognizes presets when print_settings_id/default_print_profile
// exactly match the internal U1 preset label.

const U1_PROCESS_PROFILE_MAP = {
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
};

const U1_PROCESS_PROFILE_ID_MAP = Object.fromEntries(
  Object.entries(U1_PROCESS_PROFILE_MAP).map(([sourceBase, row]) => [
    row.id,
    {
      sourceBase,
      ...row,
      resolvedLabel: `${row.mappedBase} @Snapmaker U1 (0.4 nozzle)`,
    }
  ])
);

function parseBambuProcessProfileName(name) {
  const value = String(name || '').trim();
  if (!value) return null;

  const bambuMatch = value.match(/(\d+(?:\.\d+)?)mm\s+(.+?)\s+@/i);

  if (bambuMatch) {
    const sourceBase = `${bambuMatch[1]}mm ${bambuMatch[2].trim()}`;
    const mapped = U1_PROCESS_PROFILE_MAP[sourceBase];

    return {
      original: value,
      sourceBase,
      mappedBase: mapped?.mappedBase || sourceBase,
      profileId: mapped?.id || '',
      resolvedLabel: mapped
        ? `${mapped.mappedBase} @Snapmaker U1 (0.4 nozzle)`
        : '',
      knownMapping: !!mapped,
    };
  }

  const u1Match = value.match(/(\d+(?:\.\d+)?)\s+(.+?)\s+@Snapmaker U1/i);

  if (u1Match) {
    const mappedBase = `${u1Match[1]} ${u1Match[2].trim()}`;
    const found = Object.values(U1_PROCESS_PROFILE_ID_MAP)
      .find(row => row.mappedBase.toLowerCase() === mappedBase.toLowerCase());

    return {
      original: value,
      sourceBase: found?.sourceBase || mappedBase,
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

  const printSettingsCandidate = parseBambuProcessProfileName(origSettings.print_settings_id);
  const defaultProfileCandidate = parseBambuProcessProfileName(origSettings.default_print_profile);

  if (mode === 'force') {
    const forcedProfileId =
      options.forcedProfileId ||
      '0.20mm-standard';

    const forced = U1_PROCESS_PROFILE_ID_MAP[forcedProfileId] || U1_PROCESS_PROFILE_ID_MAP['0.20mm-standard'];

    return {
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
    };
  }

  const selected =
    defaultProfileCandidate?.knownMapping
      ? defaultProfileCandidate
      : printSettingsCandidate?.knownMapping
        ? printSettingsCandidate
        : defaultProfileCandidate || printSettingsCandidate;

  if (selected?.profileId) {
    return {
      mode,
      profileId: selected.profileId,

      source_print_settings_id: String(origSettings.print_settings_id || ''),
      source_default_print_profile: String(origSettings.default_print_profile || ''),

      print_settings_candidate: printSettingsCandidate,
      default_profile_candidate: defaultProfileCandidate,

      selected_source_profile: selected.original,
      resolved_u1_profile: selected.resolvedLabel,
      source_base: selected.sourceBase,
      mapped_base: selected.mappedBase,

      selection_reason: selected === defaultProfileCandidate
        ? 'default_print_profile'
        : 'print_settings_id',
    };
  }

  const fallback = U1_PROCESS_PROFILE_ID_MAP['0.20mm-standard'];

  return {
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
  };
}

function applyResolvedU1ProcessPreset(combined, origSettings, resolvedProfile = {}, loadedProfileSettings = {}) {
  const resolvedLabel =
    loadedProfileSettings.print_settings_id ||
    loadedProfileSettings.default_print_profile ||
    resolvedProfile.resolved_u1_profile ||
    '0.20 Standard @Snapmaker U1 (0.4 nozzle)';

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