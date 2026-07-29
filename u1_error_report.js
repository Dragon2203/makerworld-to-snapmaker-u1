// MakerWorld → Snapmaker U1 conversion error report.
//
// This module contains only presentation and report formatting.
//
// Error codes, stage tracking, normalization and diagnostics collection remain
// in converter.js. The resulting error and diagnostics objects are rendered
// here for the console and for future clipboard/UI integrations.

// -----------------------------------------------------------------------------
// Report data preparation
// -----------------------------------------------------------------------------

function formatU1DiagnosticDuration(value) {
  if (!Number.isFinite(Number(value))) {
    return null;
  }

  const milliseconds =
    Number(value);

  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)} s`;
  }

  return `${milliseconds.toFixed(2)} ms`;
}

function formatU1ErrorStageRows(
  diagnostics
) {
  const stages =
    Array.isArray(diagnostics?.stages)
      ? diagnostics.stages
      : [];

  return stages
    .filter(stage =>
      stage?.status ===
        U1_DIAGNOSTIC_STAGE_STATUS.OK ||
      stage?.status ===
        U1_DIAGNOSTIC_STAGE_STATUS.FAILED
    )
    .map(stage => ({
      result:
        stage.status ===
        U1_DIAGNOSTIC_STAGE_STATUS.OK
          ? 'OK'
          : 'FAIL',

      stage:
        stage.label ||
        getU1DiagnosticStageLabel(
          stage.id
        ),

      duration:
        formatU1DiagnosticDuration(
          stage.durationMs
        ),
    }));
}

function buildU1ErrorReportObject(
  rawError,
  fallbackDiagnostics = null
) {
  const error =
    isU1ConversionError(rawError)
      ? rawError
      : prepareU1ErrorForReport(
          rawError,
          {
            diagnostics:
              fallbackDiagnostics,
          }
        );

  const diagnostics =
    getU1ErrorDiagnostics(
      error,
      fallbackDiagnostics
    ) || {};

  const diagnosticError =
    diagnostics.error || {};

  const context = {
    ...sanitizeU1DiagnosticContext(
      diagnosticError.context
    ),

    ...sanitizeU1DiagnosticContext(
      error.context
    ),
  };

  return {
    summary: {
      code:
        error.code ||
        diagnosticError.code ||
        U1_ERROR_CODES.UNKNOWN,

      stage:
        error.stage ||
        diagnosticError.stage ||
        diagnostics.currentStage ||
        'unknown',

      stageLabel:
        context.stageLabel ||
        getU1DiagnosticStageLabel(
          error.stage ||
          diagnosticError.stage ||
          diagnostics.currentStage ||
          'unknown'
        ),

      userMessage:
        error.userMessage ||
        diagnosticError.userMessage ||
        'The conversion failed because of an unexpected error.',

      userAction:
        error.userAction ||
        diagnosticError.userAction ||
        'Copy the error report and include it when reporting the problem.',

      technicalMessage:
        error.message ||
        diagnosticError.message ||
        String(rawError || 'Unknown error'),

      simulated:
        error.simulated === true ||
        diagnosticError.simulated === true,

      simulatedFault:
        context.simulatedFault ||
        diagnostics.metadata
          ?.simulatedFault ||
        null,
    },

    conversion: {
      id:
        diagnostics.id || null,

      startedAt:
        diagnostics.startedAt || null,

      finishedAt:
        diagnostics.finishedAt || null,

      duration:
        formatU1DiagnosticDuration(
          diagnostics.durationMs
        ),
    },

    progress:
      formatU1ErrorStageRows(
        diagnostics
      ),

    operation:
      Object.keys(context).length
        ? context
        : null,

    metadata:
      sanitizeU1DiagnosticContext(
        diagnostics.metadata
      ),

    originalError: {
      name:
        error.originalError?.name ||
        error.cause?.name ||
        rawError?.name ||
        error.name ||
        'Error',

      message:
        error.originalError?.message ||
        error.cause?.message ||
        rawError?.message ||
        error.message ||
        String(rawError || 'Unknown error'),

      stack:
        error.originalStack ||
        error.cause?.stack ||
        rawError?.stack ||
        error.stack ||
        '',
    },
  };
}

// -----------------------------------------------------------------------------
// Copy-ready text report
// -----------------------------------------------------------------------------

function buildU1ErrorReportText(
  rawError,
  fallbackDiagnostics = null
) {
  const report =
    buildU1ErrorReportObject(
      rawError,
      fallbackDiagnostics
    );

  const lines = [
    'MakerWorld to Snapmaker U1 — Error Report',
    '',
    `Error code: ${report.summary.code}`,
    `Stage: ${report.summary.stageLabel}`,
    `Technical message: ${report.summary.technicalMessage}`,
  ];

  if (report.summary.simulated) {
    lines.push(
      'Simulated error: yes'
    );

    if (report.summary.simulatedFault) {
      lines.push(
        `Simulated fault: ${report.summary.simulatedFault}`
      );
    }
  }

  lines.push(
    '',
    'User message:',
    report.summary.userMessage
  );

  if (report.summary.userAction) {
    lines.push(
      '',
      'Suggested action:',
      report.summary.userAction
    );
  }

  if (report.conversion.id) {
    lines.push(
      '',
      'Conversion:',
      `ID: ${report.conversion.id}`,
      `Started: ${report.conversion.startedAt || 'unknown'}`,
      `Finished: ${report.conversion.finishedAt || 'unknown'}`,
      `Duration: ${report.conversion.duration || 'unknown'}`
    );
  }

  if (report.progress.length) {
    lines.push(
      '',
      'Progress:'
    );

    for (
      const stage of report.progress
    ) {
      lines.push(
        `[${stage.result}] ${stage.stage}` +
        (
          stage.duration
            ? ` · ${stage.duration}`
            : ''
        )
      );
    }
  }

  if (report.operation) {
    lines.push(
      '',
      'Failure context:',
      JSON.stringify(
        report.operation,
        null,
        2
      )
    );
  }

  if (
    report.metadata &&
    Object.keys(report.metadata).length
  ) {
    lines.push(
      '',
      'Conversion metadata:',
      JSON.stringify(
        report.metadata,
        null,
        2
      )
    );
  }

  lines.push(
    '',
    'Original error:',
    `${report.originalError.name}: ${report.originalError.message}`
  );

  if (report.originalError.stack) {
    lines.push(
      '',
      'Stack trace:',
      report.originalError.stack
    );
  }

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Console presentation
// -----------------------------------------------------------------------------

function logU1ConversionError(
  rawError,
  fallbackDiagnostics = null
) {
  const report =
    buildU1ErrorReportObject(
      rawError,
      fallbackDiagnostics
    );

  const code =
    report.summary.code;

  console.error(
    `[U1 Extension] Conversion failed · ${code}`
  );

  console.error(
    report.summary.userMessage
  );

  if (report.summary.userAction) {
    console.info(
      `[U1 Extension] Suggested action: ${report.summary.userAction}`
    );
  }

  console.groupCollapsed(
    `[U1 Error Report] ${code} · ${report.summary.stageLabel}`
  );

  console.log(
    'summary:',
    {
      errorCode:
        report.summary.code,

      stage:
        report.summary.stage,

      stageLabel:
        report.summary.stageLabel,

      technicalMessage:
        report.summary.technicalMessage,

      userMessage:
        report.summary.userMessage,

      suggestedAction:
        report.summary.userAction,

      simulated:
        report.summary.simulated,

      simulatedFault:
        report.summary.simulatedFault,
    }
  );

  if (report.progress.length) {
    console.log(
      'conversion progress:'
    );

    console.table(
      report.progress
    );
  }

  if (report.operation) {
    console.log(
      'failure context:',
      report.operation
    );
  }

  console.log(
    'conversion metadata:',
    report.metadata
  );

  console.log(
    'conversion:',
    report.conversion
  );

  console.log(
    'original error:',
    report.originalError
  );

  console.groupEnd();

  const copyReadyReport =
    buildU1ErrorReportText(
      rawError,
      fallbackDiagnostics
    );

  console.groupCollapsed(
    `[U1 Copy-Ready Report] ${code}`
  );

  console.log(
    copyReadyReport
  );

  console.groupEnd();

  return report;
}