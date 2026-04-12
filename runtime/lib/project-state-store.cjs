'use strict';

function createProjectStateStoreHelpers(deps) {
  const {
    fs,
    path,
    runtime,
    RUNTIME_CONFIG,
    getProjectStatePaths,
    normalizeSession,
    readDefaultSession
  } = deps;

  function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }

  function isReadonlyStateError(error) {
    return Boolean(
      error &&
      ['EROFS', 'EACCES', 'EPERM'].includes(error.code)
    );
  }

  function loadSessionReadonly(paths) {
    if (fs.existsSync(paths.sessionPath)) {
      return normalizeSession(runtime.readJson(paths.sessionPath), paths);
    }
    return normalizeSession(readDefaultSession(paths), paths);
  }

  function acquireLock(lockPath) {
    const start = Date.now();

    while (true) {
      try {
        runtime.ensureDir(path.dirname(lockPath));
        const fd = fs.openSync(lockPath, 'wx');
        return fd;
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }

        if (runtime.cleanupStaleLock(lockPath, RUNTIME_CONFIG.lock_stale_ms)) {
          continue;
        }

        if (Date.now() - start > RUNTIME_CONFIG.lock_timeout_ms) {
          throw new Error('Session lock timeout');
        }

        sleepMs(20);
      }
    }
  }

  function releaseLock(lockFd, lockPath) {
    fs.closeSync(lockFd);
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  }

  function withProjectLock(work) {
    const paths = getProjectStatePaths();
    const lockFd = acquireLock(paths.lockPath);

    try {
      return work(paths);
    } finally {
      releaseLock(lockFd, paths.lockPath);
    }
  }

  function ensureSession() {
    const paths = getProjectStatePaths();
    try {
      runtime.ensureProjectStateStorage(paths);
    } catch (error) {
      if (isReadonlyStateError(error)) {
        return loadSessionReadonly(paths);
      }
      throw error;
    }

    if (!fs.existsSync(paths.sessionPath)) {
      const session = normalizeSession(readDefaultSession(paths), paths);
      try {
        runtime.writeJson(paths.sessionPath, session);
      } catch (error) {
        if (isReadonlyStateError(error)) {
          return session;
        }
        throw error;
      }
      return session;
    }

    const session = normalizeSession(runtime.readJson(paths.sessionPath), paths);
    try {
      runtime.writeJson(paths.sessionPath, session);
    } catch (error) {
      if (isReadonlyStateError(error)) {
        return session;
      }
      throw error;
    }
    return session;
  }

  function loadSession() {
    return ensureSession();
  }

  function saveSession(session) {
    const paths = getProjectStatePaths();
    runtime.ensureProjectStateStorage(paths);
    const next = normalizeSession(session, paths);
    next.updated_at = new Date().toISOString();
    runtime.writeJson(paths.sessionPath, next);
  }

  function loadHandoff() {
    const paths = getProjectStatePaths();
    runtime.ensureProjectStateStorage(paths);
    if (!fs.existsSync(paths.handoffPath)) {
      return null;
    }
    return runtime.validateHandoff(runtime.readJson(paths.handoffPath), RUNTIME_CONFIG);
  }

  function saveHandoff(handoff) {
    const paths = getProjectStatePaths();
    runtime.ensureProjectStateStorage(paths);
    runtime.writeJson(paths.handoffPath, runtime.validateHandoff(handoff, RUNTIME_CONFIG));
  }

  function loadContextSummary() {
    const paths = getProjectStatePaths();
    runtime.ensureProjectStateStorage(paths);
    if (!fs.existsSync(paths.contextSummaryPath)) {
      return null;
    }
    return runtime.validateContextSummary(runtime.readJson(paths.contextSummaryPath), RUNTIME_CONFIG);
  }

  function saveContextSummary(summary) {
    const paths = getProjectStatePaths();
    runtime.ensureProjectStateStorage(paths);
    runtime.writeJson(paths.contextSummaryPath, runtime.validateContextSummary(summary, RUNTIME_CONFIG));
  }

  function clearHandoff() {
    const paths = getProjectStatePaths();
    runtime.ensureProjectStateStorage(paths);
    if (fs.existsSync(paths.handoffPath)) {
      fs.unlinkSync(paths.handoffPath);
    }
  }

  function clearContextSummary() {
    const paths = getProjectStatePaths();
    runtime.ensureProjectStateStorage(paths);
    if (fs.existsSync(paths.contextSummaryPath)) {
      fs.unlinkSync(paths.contextSummaryPath);
    }
  }

  function updateSession(mutator) {
    try {
      return withProjectLock(() => {
        const session = loadSession();
        mutator(session);
        saveSession(session);
        return loadSession();
      });
    } catch (error) {
      if (!isReadonlyStateError(error)) {
        throw error;
      }

      const paths = getProjectStatePaths();
      const session = loadSessionReadonly(paths);
      mutator(session);
      const next = normalizeSession(session, paths);
      next.updated_at = new Date().toISOString();
      return next;
    }
  }

  return {
    ensureSession,
    loadSession,
    saveSession,
    loadHandoff,
    saveHandoff,
    loadContextSummary,
    saveContextSummary,
    clearHandoff,
    clearContextSummary,
    updateSession,
    withProjectLock
  };
}

module.exports = {
  createProjectStateStoreHelpers
};
