// Extension settings page — in-browser conversion (no external service required)

const DEFAULTS = {
  printProfileMode:      'preserve',
  forcedProfileId:       '0.20mm-standard',
  customPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID,
  filamentPresetMode:    'preserve',
  forceExcludeObject:    true,
  forceBrimOff:          true,
  autoFixOrganicVariableLayer: true,
  fixMultiPlatePositioning: true,
  debugReport:           true,
  deepDebugReport:       false,
  smartProcessMerge:    true,
  strictProcessMerge:   false,
};

let customPrinterProfiles = {};

// ── Small storage helpers ─────────────────────────────────────────────────────

function getSyncStorage(defaults) {
  return new Promise(resolve => chrome.storage.sync.get(defaults, resolve));
}

function setSyncStorage(values) {
  return new Promise(resolve => chrome.storage.sync.set(values, resolve));
}

function getLocalStorage(defaults) {
  return new Promise(resolve => chrome.storage.local.get(defaults, resolve));
}

function setLocalStorage(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

function setStatus(text, isError = false) {
  const status = document.getElementById('saveStatus');
  if (!status) return;

  status.textContent = text;
  status.style.color = isError ? '#ff7675' : '#4caf50';

  if (text) {
    setTimeout(() => {
      status.textContent = '';
      status.style.color = '#4caf50';
    }, 3000);
  }
}

// ── Print profile section ─────────────────────────────────────────────

async function loadProfiles(savedForcedProfileId) {
  const loading = document.getElementById('profilesLoading');
  const select  = document.getElementById('forcedProfileId');

  try {
    const profiles = await fetch(chrome.runtime.getURL('assets/profiles.json')).then(r => r.json());

    select.replaceChildren();

    profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value       = p.id;
      opt.textContent = p.display;
      if (p.id === savedForcedProfileId) opt.selected = true;
      select.appendChild(opt);
    });

    if (!select.value && profiles.length) select.value = profiles[0].id;

    loading.style.display = 'none';
    select.style.display  = 'block';
  } catch (err) {
    loading.textContent = 'Could not load profiles.';
    console.error('[U1 options] profile load failed:', err);
  }
}

function updatePrintProfileUi() {
  const forceRadio = document.getElementById('printProfileModeForce');
  const select = document.getElementById('forcedProfileId');

  if (!forceRadio || !select) return;

  select.disabled = !forceRadio.checked;
}

// ── Custom printer profile section ────────────────────────────────────────────

async function loadCustomPrinterProfiles() {
  const stored = await getLocalStorage({
    [U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: {},
  });

  customPrinterProfiles = stored[U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY] || {};
}

function formatCustomPrinterProfileDate(value) {
  if (!value) return 'unknown';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString();
}

function createProfileInfoRow(labelText, valueNodeOrText) {
  const row = document.createElement('div');
  row.className = 'profile-info-row';

  const label = document.createElement('strong');
  label.textContent = labelText;

  const value = document.createElement('span');

  if (valueNodeOrText instanceof Node) {
    value.appendChild(valueNodeOrText);
  } else {
    value.textContent = String(valueNodeOrText ?? '');
  }

  row.append(label, value);
  return row;
}

function createChangedSettingsDetails(changedSettings) {
  if (!changedSettings.length) {
    return document.createTextNode('None');
  }

  const details = document.createElement('details');

  const summary = document.createElement('summary');
  summary.textContent =
    `${changedSettings.length} setting${changedSettings.length === 1 ? '' : 's'}`;

  const list = document.createElement('ul');
  list.style.margin = '6px 0 0 16px';
  list.style.padding = '0';

  [...changedSettings]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .forEach((key) => {
      const item = document.createElement('li');
      const code = document.createElement('code');

      code.textContent = String(key);
      item.appendChild(code);
      list.appendChild(item);
    });

  details.append(summary, list);
  return details;
}

function renderCustomPrinterProfileInfo(profile) {
  const info = document.getElementById('customPrinterProfileInfo');
  if (!info) return;

  info.replaceChildren();

  if (!profile) {
    info.style.display = 'none';
    return;
  }

  info.style.display = 'block';

  const changedSettings =
    profile.overrideKeys?.length
      ? profile.overrideKeys
      : Object.keys(profile.overrides || {});

  info.append(
    createProfileInfoRow(
      'Name',
      profile.displayName || profile.id || ''
    ),
    createProfileInfoRow(
      'Based on',
      profile.inheritedFrom || 'unknown'
    ),
    createProfileInfoRow(
      'Imported',
      formatCustomPrinterProfileDate(profile.importedAt)
    ),
    createProfileInfoRow(
      'Changed settings',
      createChangedSettingsDetails(changedSettings)
    ),
    createProfileInfoRow(
      'Source',
      'manual import'
    )
  );
}

function renderCustomPrinterProfileSelect(savedId = U1_CUSTOM_PRINTER_STANDARD_ID) {
  const select = document.getElementById('customPrinterProfileId');
  const deleteBtn = document.getElementById('deleteCustomPrinterProfileBtn');

  if (!select) return;

  select.replaceChildren();

  const standard = document.createElement('option');
  standard.value = U1_CUSTOM_PRINTER_STANDARD_ID;
  standard.textContent = 'Standard U1 profile';
  select.appendChild(standard);

  for (const profile of buildCustomPrinterProfileSelectRows(customPrinterProfiles)) {
    const opt = document.createElement('option');
    opt.value = profile.id;
    opt.textContent = `${profile.displayName} (${profile.overrideCount} overrides)`;
    select.appendChild(opt);
  }

  select.value = customPrinterProfiles[savedId]
    ? savedId
    : U1_CUSTOM_PRINTER_STANDARD_ID;

  if (deleteBtn) {
    deleteBtn.disabled = select.value === U1_CUSTOM_PRINTER_STANDARD_ID;
  }

  const selected = customPrinterProfiles[select.value];

  renderCustomPrinterProfileInfo(selected || null);

}

async function saveCustomPrinterProfiles() {
  await setLocalStorage({
    [U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: customPrinterProfiles,
  });
}

async function importCustomPrinterProfileFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  let imported = 0;
  const errors = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const profile = normalizeCustomPrinterProfileJson(json, file.name);
      profile.sourceMode = 'manual';

      customPrinterProfiles[profile.id] = profile;
      imported++;
    } catch (err) {
      errors.push(`${file.name}: ${err.message || err}`);
    }
  }

  await saveCustomPrinterProfiles();

  const selectedId = imported
    ? Object.values(customPrinterProfiles).sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))[0]?.id
    : U1_CUSTOM_PRINTER_STANDARD_ID;

  renderCustomPrinterProfileSelect(selectedId);

  if (imported) {
    document.getElementById('customPrinterProfileId').value = selectedId;
  }

  if (errors.length) {
    console.warn('[U1 options] custom printer profile import errors:', errors);
    setStatus(`Imported ${imported}, failed ${errors.length}. See console.`, true);
  } else {
    setStatus(`Imported ${imported} custom printer profile${imported === 1 ? '' : 's'} ✓`);
  }
}

async function deleteSelectedCustomPrinterProfile() {
  const select = document.getElementById('customPrinterProfileId');
  if (!select || select.value === U1_CUSTOM_PRINTER_STANDARD_ID) return;

  const id = select.value;
  delete customPrinterProfiles[id];

  await saveCustomPrinterProfiles();

  renderCustomPrinterProfileSelect(U1_CUSTOM_PRINTER_STANDARD_ID);

  await setSyncStorage({
    customPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID,
  });

  setStatus('Custom printer profile deleted ✓');
}

// ── Save settings ─────────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', async () => {
  const settings = {
    printProfileMode:      document.getElementById('printProfileModeForce')?.checked ? 'force' : 'preserve',
    forcedProfileId:       document.getElementById('forcedProfileId')?.value || '0.20mm-standard',
    customPrinterProfileId: document.getElementById('customPrinterProfileId')?.value || U1_CUSTOM_PRINTER_STANDARD_ID,
    filamentPresetMode:    document.getElementById('filamentPresetMode')?.value || 'preserve',
    forceExcludeObject:    document.getElementById('forceExcludeObject')?.checked ?? true,
    forceBrimOff:          document.getElementById('forceBrimOff')?.checked ?? true,
    autoFixOrganicVariableLayer: document.getElementById('autoFixOrganicVariableLayer')?.checked ?? true,
    fixMultiPlatePositioning: document.getElementById('fixMultiPlatePositioning')?.checked ?? true,
    debugReport:           document.getElementById('debugReport')?.checked ?? true,
    deepDebugReport:       document.getElementById('deepDebugReport')?.checked ?? false,
    smartProcessMerge:    document.getElementById('smartProcessMerge')?.checked ?? true,
    strictProcessMerge:   document.getElementById('strictProcessMerge')?.checked ?? false,
  };

  await setSyncStorage(settings);
  setStatus('Saved ✓');
});

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('importCustomPrinterProfileBtn')?.addEventListener('click', () => {
  document.getElementById('customPrinterProfileFiles')?.click();
});

document.getElementById('customPrinterProfileFiles')?.addEventListener('change', async (event) => {
  await importCustomPrinterProfileFiles(event.target.files);
  event.target.value = '';
});

document.getElementById('deleteCustomPrinterProfileBtn')?.addEventListener('click', deleteSelectedCustomPrinterProfile);

document.getElementById('customPrinterProfileId')?.addEventListener('change', () => {
  renderCustomPrinterProfileSelect(document.getElementById('customPrinterProfileId').value);
});
document.getElementById('printProfileModePreserve')?.addEventListener('change', updatePrintProfileUi);
document.getElementById('printProfileModeForce')?.addEventListener('change', updatePrintProfileUi);

(async function initOptionsPage() {
  const s = await getSyncStorage(DEFAULTS);
  
  const printProfileMode = s.printProfileMode || 'preserve';

  if (document.getElementById('printProfileModePreserve')) {
    document.getElementById('printProfileModePreserve').checked = printProfileMode !== 'force';
  }

  if (document.getElementById('printProfileModeForce')) {
    document.getElementById('printProfileModeForce').checked = printProfileMode === 'force';
  }

  if (document.getElementById('filamentPresetMode')) {
    document.getElementById('filamentPresetMode').value = s.filamentPresetMode || 'preserve';
  }
  if (document.getElementById('forceExcludeObject')) {
    document.getElementById('forceExcludeObject').checked = s.forceExcludeObject;
  }
  if (document.getElementById('forceBrimOff')) {
    document.getElementById('forceBrimOff').checked = s.forceBrimOff;
  }
  if (document.getElementById('autoFixOrganicVariableLayer')) {
    document.getElementById('autoFixOrganicVariableLayer').checked =
      s.autoFixOrganicVariableLayer;
  }
  if (document.getElementById('fixMultiPlatePositioning')) {
    document.getElementById('fixMultiPlatePositioning').checked =
      s.fixMultiPlatePositioning;
  }
  if (document.getElementById('debugReport')) {
    document.getElementById('debugReport').checked = s.debugReport;
  }
  if (document.getElementById('deepDebugReport')) {
    document.getElementById('deepDebugReport').checked = s.deepDebugReport;
  }
  if (document.getElementById('smartProcessMerge')) {
    document.getElementById('smartProcessMerge').checked = s.smartProcessMerge;
  }
  if (document.getElementById('strictProcessMerge')) {
    document.getElementById('strictProcessMerge').checked = s.strictProcessMerge;
  }

  await loadProfiles(s.forcedProfileId || '0.20mm-standard');
  updatePrintProfileUi();
  await loadCustomPrinterProfiles();
  renderCustomPrinterProfileSelect(s.customPrinterProfileId || U1_CUSTOM_PRINTER_STANDARD_ID);
})();