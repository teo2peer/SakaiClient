const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
const previousBlockList = config.resolver.blockList;
const root = __dirname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  ...(Array.isArray(previousBlockList) ? previousBlockList : previousBlockList ? [previousBlockList] : []),
  new RegExp(`^${root}[/\\\\]dist(?:[/\\\\]|$)`),
];

module.exports = withNativeWind(config, { input: './src/global.css' });
