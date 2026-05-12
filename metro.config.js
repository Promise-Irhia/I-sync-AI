const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver = {
  ...config.resolver,
  blockList: [
    /\.local[\/\\]/,
  ],
};

module.exports = config;
