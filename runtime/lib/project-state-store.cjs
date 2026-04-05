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
    runtime.ensureProjectStateStorage(paths);

    if (!fs.existsSync(paths.sessionPath)) {
      const session = readDefaultSession(paths);
      runtime.writeJson(paths.sessionPath, session);
      return session;
    }

    const session = normalizeSession(runtime.readJson(paths.sessionPath), paths);
    runtime.writeJson(paths.sessionPath, session);
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

  function clearHandoff() {
    const paths = getProjectStatePaths();
    runtime.ensureProjectStateStorage(paths);
    if (fs.existsSync(paths.handoffPath)) {
      fs.unlinkSync(paths.handoffPath);
    }
  }

  function updateSession(mutator) {
    return withProjectLock(() => {
      const session = loadSession();
      mutator(session);
      saveSession(session);
      return loadSession();
    });
  }

  return {
    ensureSession,
    loadSession,
    saveSession,
    loadHandoff,
    saveHandoff,
    clearHandoff,
    updateSession,
    withProjectLock
  };
}

module.exports = {
  createProjectStateStoreHelpers
};
