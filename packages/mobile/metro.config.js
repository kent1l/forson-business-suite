const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo root
config.watchFolders = [workspaceRoot];

// 2. Resolve hoisted packages from workspace root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Fallback extraNodeModules proxy for npm workspace hoisted dependencies
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (target, name) => {
      if (typeof name === 'symbol') return undefined;
      const localPath = path.join(projectRoot, 'node_modules', name);
      const hoistedPath = path.join(workspaceRoot, 'node_modules', name);
      if (fs.existsSync(localPath)) return localPath;
      return hoistedPath;
    },
  }
);

module.exports = config;
