// Extension settings page — in-browser conversion (no external service required)

const DEFAULTS = {
  printProfileMode:      'preserve',
  forcedProfileId:       '0.20mm-standard',
  customPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID,
  orcaCustomPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID,
  orcaCompatibility:    false,
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
let orcaCustomPrinterProfiles = {};
let pendingPrinterProfileFiles = [];

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
    [U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: {},
  });

  // Existing installations keep using the old key for Snapmaker Orca.
  customPrinterProfiles =
    stored[U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY] || {};

  orcaCustomPrinterProfiles =
    stored[U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY] || {};
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

function renderCustomPrinterProfileInfo(profile, infoId) {
  const info = document.getElementById(infoId);
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
    createProfileInfoRow('Name', profile.displayName || profile.id || ''),
    createProfileInfoRow('Based on', profile.inheritedFrom || 'unknown'),
    createProfileInfoRow('Imported', formatCustomPrinterProfileDate(profile.importedAt)),
    createProfileInfoRow('Changed settings', createChangedSettingsDetails(changedSettings)),
    createProfileInfoRow('Source', 'manual import')
  );
}

function renderCustomPrinterProfileSelect({
  profileMap,
  selectId,
  deleteButtonId,
  infoId,
  savedId = U1_CUSTOM_PRINTER_STANDARD_ID,
}) {
  const select = document.getElementById(selectId);
  const deleteBtn = document.getElementById(deleteButtonId);

  if (!select) return;

  select.replaceChildren();

  const standard = document.createElement('option');
  standard.value = U1_CUSTOM_PRINTER_STANDARD_ID;
  standard.textContent = 'Standard U1 profile';
  select.appendChild(standard);

  for (const profile of buildCustomPrinterProfileSelectRows(profileMap)) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent =
      `${profile.displayName} (${profile.overrideCount} overrides)`;
    select.appendChild(option);
  }

  select.value = profileMap[savedId]
    ? savedId
    : U1_CUSTOM_PRINTER_STANDARD_ID;

  if (deleteBtn) {
    deleteBtn.disabled =
      select.value === U1_CUSTOM_PRINTER_STANDARD_ID;
  }

  renderCustomPrinterProfileInfo(
    profileMap[select.value] || null,
    infoId
  );
}

function renderBothPrinterProfileSelects(saved = {}) {
  renderCustomPrinterProfileSelect({
    profileMap: customPrinterProfiles,
    selectId: 'customPrinterProfileId',
    deleteButtonId: 'deleteCustomPrinterProfileBtn',
    infoId: 'customPrinterProfileInfo',
    savedId:
      saved.customPrinterProfileId ||
      U1_CUSTOM_PRINTER_STANDARD_ID,
  });

  renderCustomPrinterProfileSelect({
    profileMap: orcaCustomPrinterProfiles,
    selectId: 'orcaCustomPrinterProfileId',
    deleteButtonId: 'deleteOrcaCustomPrinterProfileBtn',
    infoId: 'orcaCustomPrinterProfileInfo',
    savedId:
      saved.orcaCustomPrinterProfileId ||
      U1_CUSTOM_PRINTER_STANDARD_ID,
  });
}

function updatePrinterProfileUi() {
  const enabled =
    document.getElementById('orcaCompatibility')?.checked === true;

  const cards = document.getElementById('printerProfileCards');
  const snorcaCard = document.getElementById('snorcaPrinterProfileCard');
  const orcaCard = document.getElementById('orcaPrinterProfileCard');

  if (!cards || !snorcaCard || !orcaCard) return;

  const activeCard = enabled ? orcaCard : snorcaCard;
  const inactiveCard = enabled ? snorcaCard : orcaCard;

  cards.prepend(activeCard);
  cards.append(inactiveCard);

  activeCard.classList.remove('is-inactive');
  inactiveCard.classList.add('is-inactive');

  activeCard.setAttribute('aria-disabled', 'false');
  inactiveCard.setAttribute('aria-disabled', 'true');

  activeCard.querySelectorAll('select, button').forEach(element => {
    element.disabled = false;
  });

  inactiveCard.querySelectorAll('select, button').forEach(element => {
    element.disabled = true;
  });
}

async function saveCustomPrinterProfiles() {
  await setLocalStorage({
    [U1_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: customPrinterProfiles,
    [U1_ORCA_CUSTOM_PRINTER_PROFILE_STORAGE_KEY]: orcaCustomPrinterProfiles,
  });
}

function openPrinterProfileTargetDialog(fileList) {
  pendingPrinterProfileFiles = Array.from(fileList || []);
  if (!pendingPrinterProfileFiles.length) return;

  const dialog = document.getElementById('printerProfileTargetDialog');
  if (!dialog) return;

  dialog.showModal();
}

async function importCustomPrinterProfileFiles(fileList, target) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const targetMap =
    target === 'orca'
      ? orcaCustomPrinterProfiles
      : customPrinterProfiles;

  let imported = 0;
  const errors = [];
  let latestId = U1_CUSTOM_PRINTER_STANDARD_ID;

  for (const file of files) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const profile = normalizeCustomPrinterProfileJson(json, file.name);

      profile.sourceMode = 'manual';
      profile.targetSlicer = target === 'orca' ? 'orca' : 'snorca';

      targetMap[profile.id] = profile;
      latestId = profile.id;
      imported++;
    } catch (error) {
      errors.push(`${file.name}: ${error.message || error}`);
    }
  }

  await saveCustomPrinterProfiles();

  const currentSaved = {
    customPrinterProfileId:
      document.getElementById('customPrinterProfileId')?.value ||
      U1_CUSTOM_PRINTER_STANDARD_ID,

    orcaCustomPrinterProfileId:
      document.getElementById('orcaCustomPrinterProfileId')?.value ||
      U1_CUSTOM_PRINTER_STANDARD_ID,
  };

  if (imported) {
    if (target === 'orca') {
      currentSaved.orcaCustomPrinterProfileId = latestId;
    } else {
      currentSaved.customPrinterProfileId = latestId;
    }
  }

  renderBothPrinterProfileSelects(currentSaved);
  updatePrinterProfileUi();

  if (errors.length) {
    console.warn('[U1 options] custom printer profile import errors:', errors);
    setStatus(`Imported ${imported}, failed ${errors.length}. See console.`, true);
  } else {
    setStatus(`Imported ${imported} custom printer profile${imported === 1 ? '' : 's'} ✓`);
  }
}

async function deleteSelectedCustomPrinterProfile(target) {
  const isOrca = target === 'orca';
  const selectId = isOrca
    ? 'orcaCustomPrinterProfileId'
    : 'customPrinterProfileId';

  const select = document.getElementById(selectId);
  if (!select || select.value === U1_CUSTOM_PRINTER_STANDARD_ID) return;

  const profileMap = isOrca
    ? orcaCustomPrinterProfiles
    : customPrinterProfiles;

  delete profileMap[select.value];
  await saveCustomPrinterProfiles();

  const saved = {
    customPrinterProfileId:
      document.getElementById('customPrinterProfileId')?.value ||
      U1_CUSTOM_PRINTER_STANDARD_ID,

    orcaCustomPrinterProfileId:
      document.getElementById('orcaCustomPrinterProfileId')?.value ||
      U1_CUSTOM_PRINTER_STANDARD_ID,
  };

  if (isOrca) {
    saved.orcaCustomPrinterProfileId = U1_CUSTOM_PRINTER_STANDARD_ID;
  } else {
    saved.customPrinterProfileId = U1_CUSTOM_PRINTER_STANDARD_ID;
  }

  renderBothPrinterProfileSelects(saved);
  updatePrinterProfileUi();

  await setSyncStorage(
    isOrca
      ? { orcaCustomPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID }
      : { customPrinterProfileId: U1_CUSTOM_PRINTER_STANDARD_ID }
  );

  setStatus('Custom printer profile deleted ✓');
}

// ── Save settings ─────────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', async () => {
  const settings = {
    printProfileMode:      document.getElementById('printProfileModeForce')?.checked ? 'force' : 'preserve',
    forcedProfileId:       document.getElementById('forcedProfileId')?.value || '0.20mm-standard',
    customPrinterProfileId: document.getElementById('customPrinterProfileId')?.value || U1_CUSTOM_PRINTER_STANDARD_ID,
    orcaCustomPrinterProfileId: document.getElementById('orcaCustomPrinterProfileId')?.value || U1_CUSTOM_PRINTER_STANDARD_ID,
    orcaCompatibility:    document.getElementById('orcaCompatibility')?.checked ?? false,
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

document.getElementById('customPrinterProfileFiles')?.addEventListener('change', (event) => {
  openPrinterProfileTargetDialog(event.target.files);
  event.target.value = '';
});

document.getElementById('cancelPrinterProfileImportBtn')?.addEventListener('click', () => {
  pendingPrinterProfileFiles = [];
  document.getElementById('printerProfileTargetDialog')?.close();
});

document.getElementById('confirmPrinterProfileImportBtn')?.addEventListener('click', async () => {
  const target =
    document.querySelector('input[name="printerProfileTarget"]:checked')?.value ||
    'snorca';

  const files = pendingPrinterProfileFiles;
  pendingPrinterProfileFiles = [];

  document.getElementById('printerProfileTargetDialog')?.close();
  await importCustomPrinterProfileFiles(files, target);
});

document.getElementById('deleteCustomPrinterProfileBtn')?.addEventListener('click', () => {
  deleteSelectedCustomPrinterProfile('snorca');
});

document.getElementById('deleteOrcaCustomPrinterProfileBtn')?.addEventListener('click', () => {
  deleteSelectedCustomPrinterProfile('orca');
});

document.getElementById('customPrinterProfileId')?.addEventListener('change', (event) => {
  renderCustomPrinterProfileSelect({
    profileMap: customPrinterProfiles,
    selectId: 'customPrinterProfileId',
    deleteButtonId: 'deleteCustomPrinterProfileBtn',
    infoId: 'customPrinterProfileInfo',
    savedId: event.target.value,
  });
  updatePrinterProfileUi();
});

document.getElementById('orcaCustomPrinterProfileId')?.addEventListener('change', (event) => {
  renderCustomPrinterProfileSelect({
    profileMap: orcaCustomPrinterProfiles,
    selectId: 'orcaCustomPrinterProfileId',
    deleteButtonId: 'deleteOrcaCustomPrinterProfileBtn',
    infoId: 'orcaCustomPrinterProfileInfo',
    savedId: event.target.value,
  });
  updatePrinterProfileUi();
});

document.getElementById('orcaCompatibility')?.addEventListener('change', updatePrinterProfileUi);
document.getElementById('printProfileModePreserve')?.addEventListener('change', updatePrintProfileUi);
document.getElementById('printProfileModeForce')?.addEventListener('change', updatePrintProfileUi);

(async function initOptionsPage() {
  const s = await getSyncStorage(DEFAULTS);
  const printProfileMode = s.printProfileMode || 'preserve';

  document.getElementById('printProfileModePreserve').checked =
    printProfileMode !== 'force';

  document.getElementById('printProfileModeForce').checked =
    printProfileMode === 'force';

  document.getElementById('orcaCompatibility').checked =
    s.orcaCompatibility === true;

  document.getElementById('filamentPresetMode').value =
    s.filamentPresetMode || 'preserve';

  document.getElementById('forceExcludeObject').checked =
    s.forceExcludeObject;

  document.getElementById('forceBrimOff').checked =
    s.forceBrimOff;

  document.getElementById('autoFixOrganicVariableLayer').checked =
    s.autoFixOrganicVariableLayer;

  document.getElementById('fixMultiPlatePositioning').checked =
    s.fixMultiPlatePositioning;

  document.getElementById('debugReport').checked = s.debugReport;
  document.getElementById('deepDebugReport').checked = s.deepDebugReport;
  document.getElementById('smartProcessMerge').checked = s.smartProcessMerge;
  document.getElementById('strictProcessMerge').checked = s.strictProcessMerge;

  await loadProfiles(s.forcedProfileId || '0.20mm-standard');
  updatePrintProfileUi();

  await loadCustomPrinterProfiles();
  renderBothPrinterProfileSelects(s);
  updatePrinterProfileUi();
})();
