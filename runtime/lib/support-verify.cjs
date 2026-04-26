'use strict';

function createSupportVerifyHelpers(deps) {
  const { fs, path } = deps;

  function parseTestVectorsFromAlgorithm(algorithmPath) {
    if (!fs.existsSync(algorithmPath)) {
      return [];
    }
    const content = fs.readFileSync(algorithmPath, 'utf8');
    const lines = content.split('\n');
    const vectors = [];

    for (const line of lines) {
      const match = line.match(/@test_vector:\s*(.+)/);
      if (match) {
        vectors.push({ raw: match[1].trim(), source: algorithmPath });
      }
    }
    return vectors;
  }

  function parseTestVector(raw) {
    const parts = {};
    const assignments = raw.split(',').map(s => s.trim());
    for (const assignment of assignments) {
      const eqIdx = assignment.indexOf('=');
      if (eqIdx === -1) continue;
      const key = assignment.substring(0, eqIdx).trim();
      const value = assignment.substring(eqIdx + 1).trim();

      if (key === 'result' || key === 'expected') {
        const resultParts = value.split(/\s+/);
        for (const rp of resultParts) {
          const [rk, rv] = rp.split('=');
          if (rk && rv) {
            parts[`result.${rk}`] = rv;
          }
        }
      } else {
        parts[key] = value;
      }
    }
    return parts;
  }

  function verifyAlgorithm(chipSupportDir, toolName, chipName) {
    const algorithmDir = path.join(chipSupportDir, 'algorithms');
    const routePath = path.join(chipSupportDir, 'routes', `${toolName}.cjs`);

    if (!fs.existsSync(routePath)) {
      return {
        status: 'route-required',
        notes: [`No route found for tool: ${toolName}`]
      };
    }

    const routeContent = fs.readFileSync(routePath, 'utf8');
    const algorithmMatch = routeContent.match(/algorithm['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    if (!algorithmMatch) {
      return {
        status: 'unverified',
        notes: ['Cannot extract algorithm name from route']
      };
    }

    const algorithmName = algorithmMatch[1];
    const algorithmPath = path.join(algorithmDir, `${algorithmName}.cjs`);

    if (!fs.existsSync(algorithmPath)) {
      return {
        status: 'missing-algorithm',
        notes: [`Algorithm file not found: ${algorithmName}.cjs`]
      };
    }

    const testVectors = parseTestVectorsFromAlgorithm(algorithmPath);

    if (testVectors.length === 0) {
      return {
        status: 'unverified',
        notes: [`Algorithm ${algorithmName} has no @test_vector annotations`],
        algorithm: algorithmName,
        test_vectors: 0
      };
    }

    try {
      const algorithm = require(algorithmPath);
      const results = [];

      for (const vector of testVectors) {
        const params = parseTestVector(vector.raw);
        let result;

        try {
          result = algorithm.run(params, { algorithm: algorithmName, params: {} }, {});
          results.push({
            test_vector: vector.raw,
            status: result && result.status === 'ok' ? 'passed' : 'failed',
            outputs: result ? result.outputs : null,
            notes: result ? result.notes : ['Algorithm returned null']
          });
        } catch (err) {
          results.push({
            test_vector: vector.raw,
            status: 'error',
            error: err.message
          });
        }
      }

      const passedCount = results.filter(r => r.status === 'passed').length;
      const allPassed = passedCount === results.length;

      return {
        status: allPassed ? 'verified' : 'failed',
        algorithm: algorithmName,
        test_vectors: testVectors.length,
        passed: passedCount,
        failed: testVectors.length - passedCount,
        results
      };
    } catch (err) {
      return {
        status: 'error',
        notes: [`Failed to load algorithm: ${err.message}`],
        algorithm: algorithmName
      };
    }
  }

  function verifyAll(chipSupportDir) {
    const routesDir = path.join(chipSupportDir, 'routes');
    if (!fs.existsSync(routesDir)) {
      return { status: 'no-routes', results: [] };
    }

    const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.cjs'));
    const results = routeFiles.map(file => {
      const toolName = file.replace('.cjs', '');
      return { tool: toolName, ...verifyAlgorithm(chipSupportDir, toolName, '') };
    });

    const verified = results.filter(r => r.status === 'verified').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const unverified = results.filter(r => r.status === 'unverified').length;
    const errors = results.filter(r => r.status === 'error' || r.status === 'missing-algorithm').length;

    return {
      status: failed > 0 ? 'failed' : (unverified > 0 ? 'partial' : 'verified'),
      tools: results.length,
      verified,
      failed,
      unverified,
      errors,
      results
    };
  }

  return {
    verifyAlgorithm,
    verifyAll,
    parseTestVectorsFromAlgorithm,
    parseTestVector
  };
}

module.exports = { createSupportVerifyHelpers };
