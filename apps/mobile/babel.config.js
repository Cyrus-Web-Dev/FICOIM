module.exports = function (api) {
  api.cache(true);
  return {
    // NativeWind v5: plugin rewrite diterapkan lewat Metro (withNativewind).
    // Jangan pakai nativewind/babel atau jsxImportSource nativewind (itu pola v4).
    presets: ['babel-preset-expo'],
  };
};
