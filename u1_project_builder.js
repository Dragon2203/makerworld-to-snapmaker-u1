// Builds the final U1 Project object from the parsed source project.
//
// Applies process merging, profile resolution, compatibility rules
// and filament normalization before the project is written back.

async function buildU1Project(input, opts = {}) {

// -----------------------------------------------------------------------------
// Source project
// -----------------------------------------------------------------------------
  const sourceProject = input;

  if (!sourceProject?.original?.settings) {
    throw new Error('buildU1Project() requires a parsed project object.');
  }

  const origSettingsStr = sourceProject.original.settingsStr;
  const origSettings = sourceProject.original.settings;

  const converterOptions = {
    printProfileMode: 'preserve',
    forcedProfileId: '0.20mm-standard',
    ...(sourceProject?.options || {}),
    ...(opts || {}),
    ...(opts?.converterOptions || {}),
  };

  const processProfileResolution = resolveU1ProcessProfile(
    origSettings,
    converterOptions
  );

  const profileId = processProfileResolution.profileId || '0.20mm-standard';

  const diff = origSettings.different_settings_to_system || [];
  const hasSupport = Array.isArray(diff)
    ? diff.some(s => typeof s === 'string' && s.includes('enable_support'))
    : String(diff).includes('enable_support');

// -----------------------------------------------------------------------------
// Resolve U1 process profile
// -----------------------------------------------------------------------------
  let u1Settings;
  try {
    u1Settings = await fetch(chrome.runtime.getURL(`assets/profiles/${profileId}.json`)).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  } catch {
    u1Settings = await fetch(chrome.runtime.getURL('assets/u1_template.json')).then(r => r.json());
  }

  if (hasSupport) {
    u1Settings = { ...u1Settings, enable_support: '1' };
  }

// -----------------------------------------------------------------------------
// Load source filament information
// -----------------------------------------------------------------------------
  let filaments = sourceProject?.filaments?.source?.slice() || [];
  const sliceEntry = sourceProject.original.sliceInfoEntry
                  || sourceProject.original.sliceEntry
                  || null;

  if (!filaments.length && sliceEntry) {
    const sliceXml = sourceProject?.original?.sliceInfoStr || await sliceEntry.async('string');
    filaments = parseFilamentsFromSliceInfo(sliceXml);
  }

  if (!filaments.length) {
    filaments = parseFilamentsFromProjectSettings(origSettingsStr);
  }

  const targetFilamentCount = Math.max(
    TARGET_FILAMENTS,
    Array.isArray(origSettings?.filament_settings_id) ? origSettings.filament_settings_id.length : 0,
    Array.isArray(origSettings?.filament_colour) ? origSettings.filament_colour.length : 0,
    Array.isArray(origSettings?.filament_type) ? origSettings.filament_type.length : 0,
    Array.isArray(filaments) ? filaments.length : 0
  );

  filaments = filaments.slice(0, targetFilamentCount);

// -----------------------------------------------------------------------------
// Merge source process settings into the U1 template
// -----------------------------------------------------------------------------
  const combined = { ...u1Settings };

  const processMergeReport = mergeBambuProcessSettingsIntoU1(
    combined,
    origSettings,
    converterOptions
  );

  const processPresetReport = applyResolvedU1ProcessPreset(
    combined,
    origSettings,
    processProfileResolution,
    u1Settings
  );

// -----------------------------------------------------------------------------
// Normalize template arrays
// -----------------------------------------------------------------------------
  for (const [key, val] of Object.entries(combined)) {
    if (!key.startsWith('filament_') && Array.isArray(val) && val.length > 0 && val.length !== TARGET_FILAMENTS) {
      combined[key] = padArray(val, TARGET_FILAMENTS, val[val.length - 1]);
    }
  }

// -----------------------------------------------------------------------------
// Apply compatibility fixes
// -----------------------------------------------------------------------------
  let compatibilityReport = analyzeU1Compatibility(combined, {
    ...converterOptions,
    projectFeatures: sourceProject?.analysis?.features || null,
  });
  applyU1Compatibility(combined, compatibilityReport);

// -----------------------------------------------------------------------------
// Apply user compatibility options
// -----------------------------------------------------------------------------
  const userOptionReport = applyU1UserOptionCompatibilityRules(
    combined,
    converterOptions
  );

  compatibilityReport = {
    warnings: [
      ...(compatibilityReport?.warnings || []),
      ...(userOptionReport?.warnings || []),
    ],
    actions: [
      ...(compatibilityReport?.actions || []),
      ...(userOptionReport?.actions || []),
    ],
  };

// -----------------------------------------------------------------------------
// Normalize filament presets
// -----------------------------------------------------------------------------
  const filamentPresetReport = applyFinalU1FilamentPass(
    combined,
    origSettings,
    filaments,
    converterOptions,
    u1Settings,
    targetFilamentCount
  );

// -----------------------------------------------------------------------------
// Apply selected printer profile / optional Orca compatibility
// -----------------------------------------------------------------------------
  const customPrinterProfileReport =
    converterOptions.orcaCompatibility === true
      ? applyOrcaCompatibilityToU1Settings(
          combined,
          converterOptions.customPrinterProfile || null,
          { targetFilamentCount }
        )
      : applyCustomPrinterProfileToU1Settings(
          combined,
          converterOptions.customPrinterProfile || null,
          { targetFilamentCount }
        );

  customPrinterProfileReport.requested =
    converterOptions.selectedCustomPrinterProfileId ||
    U1_CUSTOM_PRINTER_STANDARD_ID;

  customPrinterProfileReport.mode =
    converterOptions.orcaCompatibility === true
      ? (
          customPrinterProfileReport.requested ===
          U1_CUSTOM_PRINTER_STANDARD_ID
            ? 'orca-standard'
            : 'orca-custom'
        )
      : (
          customPrinterProfileReport.requested ===
          U1_CUSTOM_PRINTER_STANDARD_ID
            ? 'snorca-standard'
            : 'snorca-custom'
        );

// -----------------------------------------------------------------------------
// Assemble final Project object
// -----------------------------------------------------------------------------
  const project = sourceProject;

  if (converterOptions.customPrinterProfileMissing) {
    customPrinterProfileReport.missing = true;
    customPrinterProfileReport.skipped = [
      ...(customPrinterProfileReport.skipped || []),
      {
        reason: 'selected-custom-profile-not-found',
        requested: customPrinterProfileReport.requested,
      }
    ];

    project.compatibility = {
      ...(project.compatibility || {}),
      warnings: [
        ...(project.compatibility?.warnings || []),
        `Selected custom printer profile was not found: ${customPrinterProfileReport.requested}`
      ],
      actions: project.compatibility?.actions || [],
    };
  }

  project.original = {
    ...(project.original || {}),
    settings: origSettings,
    settingsStr: origSettingsStr,
    sliceEntry,
    sliceInfoEntry: sliceEntry,
    sliceInfoStr: sourceProject?.original?.sliceInfoStr,
    sliceInfoDoc: sourceProject?.original?.sliceInfoDoc,
    modelSettingsEntry: sourceProject?.original?.modelSettingsEntry,
    modelSettingsStr: sourceProject?.original?.modelSettingsStr,
    modelSettingsDoc: sourceProject?.original?.modelSettingsDoc,
  };

  project.u1 = {
    settings: combined,
    settingsBytes: JSON.stringify(combined, null, 4),
  };

  project.analysis = {
    ...(project.analysis || {}),
    processPreset: processPresetReport,
    processMerge: processMergeReport,
    filamentPreset: filamentPresetReport,
    customPrinterProfile: customPrinterProfileReport,
  };

  project.filaments = {
    ...(project.filaments || {}),
    source: filaments,
    mapped: {
      colors: combined.filament_colour.slice(),
      types: combined.filament_type.slice(),
      ids: combined.filament_settings_id.slice(),
    },
  };

  project.compatibility = {
    warnings: [
      ...(project.compatibility?.warnings || []),
      ...(compatibilityReport?.warnings || []),
    ],
    actions: compatibilityReport?.actions || [],
  };

  return project;
}