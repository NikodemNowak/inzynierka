// The measurements screen ships in development builds and in measurement
// builds (EXPO_PUBLIC_MEASUREMENTS=1, see ios-unsigned.yml). Files that
// require benchmark audio repeat this check inline: Metro drops a dead branch
// only when the condition is a constant in that same file.
export const MEASUREMENT_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_MEASUREMENTS === '1'
