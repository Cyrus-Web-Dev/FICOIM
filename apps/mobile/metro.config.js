const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

// Expo SDK 52+ sudah mengonfigurasi monorepo otomatis (watchFolders, nodeModulesPaths, dll.).
// Jangan override disableHierarchicalLookup / extraNodeModules — expo-doctor akan gagal.
const config = getDefaultConfig(__dirname);

module.exports = withNativewind(config);
