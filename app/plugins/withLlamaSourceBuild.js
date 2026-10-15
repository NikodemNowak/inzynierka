const { withPodfile } = require('expo/config-plugins')

module.exports = function withLlamaSourceBuild(config) {
  return withPodfile(config, (result) => {
    // Compile the patched sampler instead of linking the upstream binary.
    const setting = "ENV['RNLLAMA_BUILD_FROM_SOURCE'] = '1'"
    if (!result.modResults.contents.includes(setting)) {
      result.modResults.contents = `${setting}\n${result.modResults.contents}`
    }
    return result
  })
}
