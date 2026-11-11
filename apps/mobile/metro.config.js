const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Monorepo: Metro harus melihat paket di packages/* dan SELALU memakai satu salinan react milik aplikasi ini
// (dua salinan react = galat "Invalid hook call"). Folder aplikasi didahulukan.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')];

module.exports = withNativewind(config);
