/** @type {import('expo/config').ConfigContext} */
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    hermesUrl: process.env.EXPO_PUBLIC_HERMES_URL ?? '',
    hermesApiKey: process.env.EXPO_PUBLIC_HERMES_API_KEY ?? '',
  },
});
