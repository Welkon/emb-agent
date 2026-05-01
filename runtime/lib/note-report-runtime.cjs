'use strict';

function createNoteReportRuntime(deps) {
  return deps.noteReportHelpers.createNoteReportHelpers({
    fs: deps.fs,
    path: deps.path,
    process: deps.process,
    runtime: deps.runtime,
    scheduler: deps.scheduler,
    ingestTruthCli: deps.ingestTruthCli,
    templateCli: deps.templateCli,
    TEMPLATES_DIR: deps.TEMPLATES_DIR,
    RUNTIME_CONFIG: deps.RUNTIME_CONFIG,
    resolveProjectRoot: deps.resolveProjectRoot,
    resolveSession: deps.resolveSession,
    buildNextContext: deps.buildNextContext,
    updateSession: deps.updateSession
  });
}

module.exports = {
  createNoteReportRuntime
};
