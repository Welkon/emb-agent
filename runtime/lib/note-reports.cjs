'use strict';

function createNoteReportHelpers(deps) {
  const {
    fs,
    path,
    process,
    runtime,
    scheduler,
    ingestTruthCli,
    templateCli,
    TEMPLATES_DIR,
    RUNTIME_CONFIG,
    resolveProjectRoot,
    resolveSession,
    getTemplateConfig,
    updateSession
  } = deps;

  function parseNoteAddArgs(tokens) {
    const result = {
      target: tokens[0] || '',
      summaryParts: [],
      evidence: [],
      unverified: [],
      kind: ''
    };

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--evidence') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --evidence');
        result.evidence.push(value);
        index += 1;
        continue;
      }

      if (token === '--unverified') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --unverified');
        result.unverified.push(value);
        index += 1;
        continue;
      }

      if (token === '--kind') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --kind');
        result.kind = value;
        index += 1;
        continue;
      }

      result.summaryParts.push(token);
    }

    if (!result.target) {
      throw new Error('Missing note target');
    }

    return {
      target: result.target,
      summary: result.summaryParts.join(' ').trim(),
      evidence: result.evidence,
      unverified: result.unverified,
      kind: result.kind.trim()
    };
  }

  function normalizeTargetAlias(targetPath) {
    const normalized = targetPath.replace(/\\/g, '/');
    const base = path.basename(normalized, path.extname(normalized)).toLowerCase();

    if (base === 'hardware-logic') return 'hardware';
    if (base === 'debug-notes') return 'debug';
    if (base === 'connectivity') return 'connectivity';
    if (base === 'release-notes') return 'release';
    if (base === 'arch') return 'arch';
    return base;
  }

  function resolveKnownDocTarget(rawTarget) {
    const normalized = rawTarget.trim().toLowerCase();
    const aliases = {
      hardware: 'docs/HARDWARE-LOGIC.md',
      debug: 'docs/DEBUG-NOTES.md',
      connectivity: 'docs/CONNECTIVITY.md',
      release: 'docs/RELEASE-NOTES.md',
      review: 'docs/REVIEW-REPORT.md',
      arch: 'docs/ARCH.md'
    };

    if (aliases[normalized]) {
      return aliases[normalized];
    }

    return rawTarget.trim();
  }

  function resolveNoteTarget(resolved, rawTarget) {
    const targets = resolved.effective.note_targets || [];
    const target = resolveKnownDocTarget(rawTarget);

    if (targets.includes(target)) {
      return target;
    }

    const normalized = target.toLowerCase();
    const matches = targets.filter(item => {
      const alias = normalizeTargetAlias(item);
      return alias === normalized || path.basename(item).toLowerCase() === normalized;
    });

    if (matches.length === 1) {
      return matches[0];
    }

    throw new Error(`Unknown note target: ${rawTarget}`);
  }

  function ensureNoteTargetDoc(targetPath) {
    const absolutePath = path.resolve(process.cwd(), targetPath);

    if (fs.existsSync(absolutePath)) {
      return { created: false, path: absolutePath, template: '' };
    }

    const templates = getTemplateConfig();
    const templateEntry = Object.entries(templates).find(([, meta]) => meta.default_output === targetPath);

    if (templateEntry) {
      const [templateName, meta] = templateEntry;
      const context = templateCli.buildContext({});
      const content = templateCli.applyTemplate(
        runtime.readText(path.join(TEMPLATES_DIR, meta.source)),
        context
      );
      runtime.ensureDir(path.dirname(absolutePath));
      fs.writeFileSync(absolutePath, content, 'utf8');
      return { created: true, path: absolutePath, template: templateName };
    }

    runtime.ensureDir(path.dirname(absolutePath));
    fs.writeFileSync(absolutePath, `# ${path.basename(targetPath)}\n`, 'utf8');
    return { created: true, path: absolutePath, template: '' };
  }

  function buildNoteEntry(noteInput) {
    const timestamp = new Date().toISOString();
    const lines = [
      `### ${timestamp}${noteInput.kind ? ` | ${noteInput.kind}` : ''}`,
      `- Summary: ${noteInput.summary}`
    ];

    if (noteInput.evidence.length > 0) {
      lines.push('- Evidence:');
      for (const item of noteInput.evidence) {
        lines.push(`  - ${item}`);
      }
    }

    if (noteInput.unverified.length > 0) {
      lines.push('- Unverified:');
      for (const item of noteInput.unverified) {
        lines.push(`  - ${item}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  function appendNoteEntryToDoc(content, entry) {
    const marker = '## Emb-Agent Notes';
    const normalized = content.endsWith('\n') ? content : `${content}\n`;

    if (!normalized.includes(marker)) {
      return `${normalized.trimEnd()}\n\n${marker}\n\n${entry}`;
    }

    return normalized.replace(marker, `${marker}\n\n${entry.trimEnd()}`);
  }

  function parseReviewSaveArgs(tokens) {
    const result = {
      summaryParts: [],
      findings: [],
      checks: [],
      scope: ''
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--finding') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --finding');
        result.findings.push(value);
        index += 1;
        continue;
      }

      if (token === '--check') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --check');
        result.checks.push(value);
        index += 1;
        continue;
      }

      if (token === '--scope') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --scope');
        result.scope = value;
        index += 1;
        continue;
      }

      result.summaryParts.push(token);
    }

    return {
      summary: result.summaryParts.join(' ').trim(),
      findings: result.findings,
      checks: result.checks,
      scope: result.scope.trim()
    };
  }

  function buildReviewReportEntry(resolved, reviewInput) {
    const reviewOutput = scheduler.buildReviewOutput(resolved);
    const timestamp = new Date().toISOString();
    const lines = [
      `### ${timestamp}`,
      `- Summary: ${reviewInput.summary}`,
      `- Profile: ${reviewOutput.scope.profile}`,
      `- Packs: ${(reviewOutput.scope.packs || []).join(', ') || '-'}`,
      `- Scope: ${reviewInput.scope || reviewOutput.scope.focus || 'structural review'}`,
      '- Review axes:'
    ];

    for (const axis of reviewOutput.axes || []) {
      lines.push(`  - ${axis}`);
    }

    if (reviewInput.findings.length > 0) {
      lines.push('- Findings:');
      for (const finding of reviewInput.findings) {
        lines.push(`  - ${finding}`);
      }
    }

    lines.push('- Required checks:');
    for (const item of runtime.unique([
      ...reviewInput.checks,
      ...(reviewOutput.required_checks || [])
    ])) {
      lines.push(`  - ${item}`);
    }

    if ((reviewOutput.scope.focus_areas || []).length > 0) {
      lines.push('- Focus areas:');
      for (const area of reviewOutput.scope.focus_areas) {
        lines.push(`  - ${area}`);
      }
    }

    if ((reviewOutput.scheduler.supporting_agents || []).length > 0 || reviewOutput.scheduler.primary_agent) {
      lines.push(
        `- Review agents: ${runtime.unique([
          reviewOutput.scheduler.primary_agent,
          ...(reviewOutput.scheduler.supporting_agents || [])
        ]).join(', ')}`
      );
    }

    if ((reviewOutput.scheduler.output_shape || []).length > 0) {
      lines.push(`- Output shape: ${reviewOutput.scheduler.output_shape.join(', ')}`);
    }

    if ((reviewOutput.scheduler.safety_checks || []).length > 0) {
      lines.push('- Safety checks:');
      for (const item of reviewOutput.scheduler.safety_checks) {
        lines.push(`  - ${item}`);
      }
    }

    if ((reviewOutput.scheduler.focus_order || []).length > 0) {
      lines.push('- Focus order:');
      for (const item of reviewOutput.scheduler.focus_order) {
        lines.push(`  - ${item}`);
      }
    }

    if ((reviewOutput.scheduler.suggested_steps || []).length > 0) {
      lines.push('- Suggested steps:');
      for (const item of reviewOutput.scheduler.suggested_steps) {
        lines.push(`  - ${item}`);
      }
    }

    if ((reviewOutput.scheduler.packs || []).length > 0) {
      lines.push(`- Scheduler packs: ${reviewOutput.scheduler.packs.join(', ')}`);
    }

    if ((reviewOutput.scheduler.profile || '')) {
      lines.push(`- Scheduler profile: ${reviewOutput.scheduler.profile}`);
    }

    if ((reviewOutput.scope.runtime_model || '')) {
      lines.push(`- Runtime model: ${reviewOutput.scope.runtime_model}`);
    }

    if ((reviewOutput.scope.concurrency_model || '')) {
      lines.push(`- Concurrency model: ${reviewOutput.scope.concurrency_model}`);
    }

    lines.push('- Note targets:');
    for (const target of reviewOutput.scheduler.output_shape ? (resolved.effective.note_targets || []) : []) {
      lines.push(`  - ${target}`);
    }

    return lines.join('\n') + '\n';
  }

  function appendSectionEntry(content, marker, entry) {
    const normalized = content.endsWith('\n') ? content : `${content}\n`;

    if (!normalized.includes(marker)) {
      return `${normalized.trimEnd()}\n\n${marker}\n\n${entry}`;
    }

    return normalized.replace(marker, `${marker}\n\n${entry.trimEnd()}`);
  }

  function findSummaryLine(entry) {
    const match = entry.match(/^- Summary:\s+(.+)$/m);
    return match ? match[1].trim() : '';
  }

  function splitSectionEntries(sectionContent) {
    const trimmed = sectionContent.trim();
    if (!trimmed) {
      return [];
    }

    return trimmed
      .split(/(?=^###\s)/m)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function upsertSectionEntry(content, marker, entry) {
    const normalized = content.endsWith('\n') ? content : `${content}\n`;
    const summary = findSummaryLine(entry);

    if (!normalized.includes(marker)) {
      return `${normalized.trimEnd()}\n\n${marker}\n\n${entry}`;
    }

    const markerIndex = normalized.indexOf(marker);
    const before = normalized.slice(0, markerIndex + marker.length);
    const after = normalized.slice(markerIndex + marker.length);
    const entries = splitSectionEntries(after).filter(item => {
      if (!summary) {
        return true;
      }
      return findSummaryLine(item) !== summary;
    });

    const nextEntries = [entry.trimEnd(), ...entries];
    return `${before}\n\n${nextEntries.join('\n\n')}\n`;
  }

  function saveReviewReport(tokens) {
    const reviewInput = parseReviewSaveArgs(tokens);

    if (!reviewInput.summary) {
      throw new Error('Missing review summary');
    }

    const resolved = resolveSession();
    const target = 'docs/REVIEW-REPORT.md';
    const ensured = ensureNoteTargetDoc(target);
    const content = runtime.readText(ensured.path);
    const nextContent = upsertSectionEntry(
      content,
      '## Emb-Agent Reviews',
      buildReviewReportEntry(resolved, reviewInput)
    );

    fs.writeFileSync(ensured.path, nextContent, 'utf8');

    updateSession(current => {
      current.last_command = 'review save';
      current.last_files = runtime
        .unique([target, ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });

    return {
      target,
      created: ensured.created,
      template: ensured.template,
      summary: reviewInput.summary,
      findings: reviewInput.findings,
      checks: reviewInput.checks,
      scope: reviewInput.scope || ''
    };
  }

  function parseScanSaveArgs(tokens) {
    const result = {
      target: tokens[0] || '',
      summaryParts: [],
      facts: [],
      questions: [],
      reads: []
    };

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--fact') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --fact');
        result.facts.push(value);
        index += 1;
        continue;
      }

      if (token === '--question') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --question');
        result.questions.push(value);
        index += 1;
        continue;
      }

      if (token === '--read') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --read');
        result.reads.push(value);
        index += 1;
        continue;
      }

      result.summaryParts.push(token);
    }

    return {
      target: result.target,
      summary: result.summaryParts.join(' ').trim(),
      facts: result.facts,
      questions: result.questions,
      reads: result.reads
    };
  }

  function parsePlanSaveArgs(tokens) {
    const result = {
      target: '',
      summaryParts: [],
      risks: [],
      steps: [],
      verification: []
    };

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token === '--target') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --target');
        result.target = value;
        index += 1;
        continue;
      }

      if (token === '--risk') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --risk');
        result.risks.push(value);
        index += 1;
        continue;
      }

      if (token === '--step') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --step');
        result.steps.push(value);
        index += 1;
        continue;
      }

      if (token === '--verify') {
        const value = tokens[index + 1] || '';
        if (!value) throw new Error('Missing value after --verify');
        result.verification.push(value);
        index += 1;
        continue;
      }

      result.summaryParts.push(token);
    }

    return {
      target: result.target.trim(),
      summary: result.summaryParts.join(' ').trim(),
      risks: result.risks,
      steps: result.steps,
      verification: result.verification
    };
  }

  function buildScanEntry(scanOutput, scanInput) {
    const timestamp = new Date().toISOString();
    const lines = [
      `### ${timestamp}`,
      `- Summary: ${scanInput.summary}`
    ];

    lines.push('- Relevant files:');
    for (const item of scanOutput.relevant_files || []) {
      lines.push(`  - ${item}`);
    }

    lines.push('- Key facts:');
    for (const item of runtime.unique([...(scanInput.facts || []), ...(scanOutput.key_facts || [])])) {
      lines.push(`  - ${item}`);
    }

    lines.push('- Open questions:');
    for (const item of runtime.unique([...(scanInput.questions || []), ...(scanOutput.open_questions || [])])) {
      lines.push(`  - ${item}`);
    }

    lines.push('- Next reads:');
    for (const item of runtime.unique([...(scanInput.reads || []), ...(scanOutput.next_reads || [])])) {
      lines.push(`  - ${item}`);
    }

    if (scanOutput.scheduler && scanOutput.scheduler.focus_order && scanOutput.scheduler.focus_order.length > 0) {
      lines.push('- Focus order:');
      for (const item of scanOutput.scheduler.focus_order) {
        lines.push(`  - ${item}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  function buildPlanEntry(planOutput, planInput) {
    const timestamp = new Date().toISOString();
    const lines = [
      `### ${timestamp}`,
      `- Summary: ${planInput.summary}`,
      `- Goal: ${planOutput.goal}`
    ];

    lines.push('- Truth sources:');
    for (const item of planOutput.truth_sources || []) {
      lines.push(`  - ${item}`);
    }

    lines.push('- Constraints:');
    for (const item of planOutput.constraints || []) {
      lines.push(`  - ${item}`);
    }

    lines.push('- Risks:');
    for (const item of runtime.unique([...(planInput.risks || []), ...(planOutput.risks || [])])) {
      lines.push(`  - ${item}`);
    }

    lines.push('- Steps:');
    for (const item of runtime.unique([...(planInput.steps || []), ...(planOutput.steps || [])])) {
      lines.push(`  - ${item}`);
    }

    lines.push('- Verification:');
    for (const item of runtime.unique([...(planInput.verification || []), ...(planOutput.verification || [])])) {
      lines.push(`  - ${item}`);
    }

    if (planOutput.scheduler && (planOutput.scheduler.focus_order || []).length > 0) {
      lines.push('- Focus order:');
      for (const item of planOutput.scheduler.focus_order) {
        lines.push(`  - ${item}`);
      }
    }

    if (planOutput.scheduler && planOutput.scheduler.primary_agent) {
      lines.push(`- Primary agent: ${planOutput.scheduler.primary_agent}`);
    }

    return lines.join('\n') + '\n';
  }

  function syncHardwareTruthFromScan(target, scanInput) {
    if (target !== 'docs/HARDWARE-LOGIC.md') {
      return false;
    }

    if (
      (scanInput.facts || []).length === 0 &&
      (scanInput.questions || []).length === 0 &&
      (scanInput.reads || []).length === 0
    ) {
      return false;
    }

    ingestTruthCli.ingestHardware(resolveProjectRoot(), {
      mcu: '',
      board: '',
      target: '',
      truths: scanInput.facts || [],
      constraints: [],
      unknowns: scanInput.questions || [],
      sources: scanInput.reads || [],
      force: false
    });

    return true;
  }

  function saveScanReport(tokens) {
    const scanInput = parseScanSaveArgs(tokens);

    if (!scanInput.target) {
      throw new Error('Missing scan target');
    }
    if (!scanInput.summary) {
      throw new Error('Missing scan summary');
    }

    const resolved = resolveSession();
    const target = resolveKnownDocTarget(scanInput.target);
    const ensured = ensureNoteTargetDoc(target);
    const scanOutput = scheduler.buildScanOutput(resolved);
    const content = runtime.readText(ensured.path);
    const nextContent = upsertSectionEntry(
      content,
      '## Emb-Agent Scans',
      buildScanEntry(scanOutput, scanInput)
    );

    fs.writeFileSync(ensured.path, nextContent, 'utf8');
    const syncedTruth = syncHardwareTruthFromScan(target, scanInput);

    updateSession(current => {
      current.last_command = 'scan save';
      current.last_files = runtime
        .unique([target, syncedTruth ? 'emb-agent/hw.yaml' : '', ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });

    return {
      target,
      created: ensured.created,
      template: ensured.template,
      summary: scanInput.summary,
      facts: scanInput.facts,
      questions: scanInput.questions,
      reads: scanInput.reads,
      synced_truth: syncedTruth
    };
  }

  function syncRequirementsFromPlan(planInput) {
    if (!planInput.summary && (planInput.verification || []).length === 0) {
      return false;
    }

    ingestTruthCli.ingestRequirements(resolveProjectRoot(), {
      goals: planInput.summary ? [planInput.summary] : [],
      features: [],
      constraints: [],
      acceptance: planInput.verification || [],
      failurePolicy: [],
      unknowns: [],
      sources: [],
      force: false
    });

    return true;
  }

  function savePlanReport(tokens) {
    const planInput = parsePlanSaveArgs(tokens);

    if (!planInput.summary) {
      throw new Error('Missing plan summary');
    }

    const resolved = resolveSession();
    const target = resolveKnownDocTarget(planInput.target || 'debug');
    const ensured = ensureNoteTargetDoc(target);
    const planOutput = scheduler.buildPlanOutput(resolved);
    const content = runtime.readText(ensured.path);
    const nextContent = upsertSectionEntry(
      content,
      '## Emb-Agent Plans',
      buildPlanEntry(planOutput, planInput)
    );

    fs.writeFileSync(ensured.path, nextContent, 'utf8');
    const syncedReq = syncRequirementsFromPlan(planInput);

    updateSession(current => {
      current.last_command = 'plan save';
      current.last_files = runtime
        .unique([target, syncedReq ? 'emb-agent/req.yaml' : '', ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });

    return {
      target,
      created: ensured.created,
      template: ensured.template,
      summary: planInput.summary,
      risks: planInput.risks,
      steps: planInput.steps,
      verification: planInput.verification,
      synced_requirements: syncedReq
    };
  }

  function addNoteEntry(tokens) {
    const noteInput = parseNoteAddArgs(tokens);

    if (!noteInput.summary) {
      throw new Error('Missing note summary');
    }

    const resolved = resolveSession();
    const target = resolveNoteTarget(resolved, noteInput.target);
    const ensured = ensureNoteTargetDoc(target);
    const content = runtime.readText(ensured.path);
    const nextContent = upsertSectionEntry(
      content,
      '## Emb-Agent Notes',
      buildNoteEntry(noteInput)
    );

    fs.writeFileSync(ensured.path, nextContent, 'utf8');
    const syncedTruth =
      target === 'docs/HARDWARE-LOGIC.md' &&
      noteInput.kind === 'hardware_truth'
        ? (() => {
            ingestTruthCli.ingestHardware(resolveProjectRoot(), {
              mcu: '',
              board: '',
              target: '',
              truths: [noteInput.summary],
              constraints: [],
              unknowns: noteInput.unverified || [],
              sources: noteInput.evidence || [],
              force: false
            });
            return true;
          })()
        : false;

    updateSession(current => {
      current.last_command = 'note add';
      current.last_files = runtime
        .unique([target, syncedTruth ? 'emb-agent/hw.yaml' : '', ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });

    return {
      target,
      created: ensured.created,
      template: ensured.template,
      kind: noteInput.kind || '',
      summary: noteInput.summary,
      evidence: noteInput.evidence,
      unverified: noteInput.unverified,
      synced_truth: syncedTruth
    };
  }

  return {
    parseNoteAddArgs,
    normalizeTargetAlias,
    resolveKnownDocTarget,
    resolveNoteTarget,
    ensureNoteTargetDoc,
    buildNoteEntry,
    appendNoteEntryToDoc,
    parseReviewSaveArgs,
    buildReviewReportEntry,
    appendSectionEntry,
    findSummaryLine,
    splitSectionEntries,
    upsertSectionEntry,
    saveReviewReport,
    parseScanSaveArgs,
    parsePlanSaveArgs,
    buildScanEntry,
    buildPlanEntry,
    syncHardwareTruthFromScan,
    saveScanReport,
    syncRequirementsFromPlan,
    savePlanReport,
    addNoteEntry
  };
}

module.exports = {
  createNoteReportHelpers
};
