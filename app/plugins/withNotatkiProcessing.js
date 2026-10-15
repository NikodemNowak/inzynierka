const { withInfoPlist } = require('expo/config-plugins')

module.exports = function withNotatkiProcessing(config) {
  return withInfoPlist(config, (result) => {
    const bundle = result.ios?.bundleIdentifier || 'com.nowak.notatki'
    result.modResults.UIBackgroundModes = [...new Set([
      ...(result.modResults.UIBackgroundModes || []), 'audio', 'processing',
    ])]
    result.modResults.BGTaskSchedulerPermittedIdentifiers = [...new Set([
      ...(result.modResults.BGTaskSchedulerPermittedIdentifiers || []), `${bundle}.processing.*`,
    ])]
    return result
  })
}
