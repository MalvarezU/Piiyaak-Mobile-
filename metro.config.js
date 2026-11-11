const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Los audios de prod son .ogg y NO está en los assetExts defaults de Expo
// (sí mp3/wav/m4a): sin esto, Metro los ignora al bundlear la APK.
config.resolver.assetExts.push("ogg");

module.exports = config;
