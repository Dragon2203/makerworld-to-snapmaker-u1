// U1 / Snapmaker Orca compatibility rules

// Central compatibility layer.
//
// Detects known Bambu → Snapmaker Orca incompatibilities and either
// reports them or rewrites the affected settings.

function analyzeU1Compatibility(settings, options = {}) {
  const actions = [];
  const warnings = [];

  const variableLayerEnabled =
    settings.adaptive_layer_height === '1' ||
    settings.enable_adaptive_layer_height === '1' ||
    settings.variable_layer_height === '1' ||
    settings.layer_height_table !== undefined ||
    options.projectFeatures?.hasAdaptiveLayer === true;

  const supportEnabled =
    String(settings.enable_support || '') === '1';

  const supportType =
    String(settings.support_type || '').toLowerCase();

  const supportStyle =
    String(settings.support_style || '').toLowerCase();

  const supportLooksTree =
    supportEnabled && supportType.includes('tree');

  const treeStyleLooksProblematic =
    !supportStyle ||
    supportStyle === 'default' ||
    supportStyle.includes('organic');

  if (variableLayerEnabled && supportLooksTree && treeStyleLooksProblematic) {
    if (options.autoFixOrganicVariableLayer !== false) {
      actions.push({
        id: 'tree-support-variable-layer-style',
        type: 'replace',
        key: 'support_style',
        value: 'tree_hybrid',
        reason:
          'Adaptive layer height with tree support is converted to Tree Hybrid, matching Bambu Studio behavior.'
      });
    } else {
      warnings.push(
        'Variable layer height is not supported with Tree Default/Organic support style in SnOrca/U1.'
      );

      warnings.push(
        'Auto-fix for Tree Support + Variable Layer Height is disabled in converter options.'
      );
    }
  }

  return {
    actions,
    warnings
  };
}

function applyU1Compatibility(settings, report) {
  if (!report || !Array.isArray(report.actions)) return;

  for (const action of report.actions) {
    if (action.type === 'replace') {
        settings[action.key] = action.value;
        addDifferentSetting(settings, action.key);
    }
  }
}

// U1 USER OPTION COMPATIBILITY RULES
function addDifferentSetting(settings, key) {
  if (!settings || !key) return;

  if (!Array.isArray(settings.different_settings_to_system)) {
    settings.different_settings_to_system = [
      String(settings.different_settings_to_system || ''),
      '',
      '',
      '',
      '',
      ''
    ];
  }

  const current = String(settings.different_settings_to_system[0] || '');
  const parts = current
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  if (!parts.includes(key)) {
    parts.push(key);
  }

  settings.different_settings_to_system[0] = parts.join(';');
}

function applyU1UserOptionCompatibilityRules(settings, options = {}) {
  const actions = [];
  const warnings = [];

  if (!settings) {
    return { actions, warnings };
  }

  if (options.forceExcludeObject) {
    settings.enable_exclude_object = '1';
    settings.exclude_object = '1';

    addDifferentSetting(settings, 'enable_exclude_object');
    addDifferentSetting(settings, 'exclude_object');

    actions.push({
      id: 'force-exclude-object',
      type: 'set',
      key: 'exclude_object',
      value: '1',
      reason: 'Exclude Object was enabled because SnOrca needs it for Adaptive Bed Mesh / object-aware features.'
    });
  }

  if (options.forceBrimOff) {
    settings.brim_type = 'no_brim';
    settings.brim_width = '0';

    addDifferentSetting(settings, 'brim_type');
    addDifferentSetting(settings, 'brim_width');

    actions.push({
      id: 'force-brim-off',
      type: 'set',
      key: 'brim_type',
      value: 'no_brim',
      reason: 'Brim was forced off to avoid unnecessary automatic brims in SnOrca.'
    });
  }

  return {
    actions,
    warnings
  };
}