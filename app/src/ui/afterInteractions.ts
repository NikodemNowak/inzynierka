// Resolves when the JS thread goes idle, or after `maxWaitMs` at the latest, so
// startup chores never compete with the first frames and never wait forever.
export const afterInteractions = (maxWaitMs = 1500): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: maxWaitMs })
    else setTimeout(resolve, maxWaitMs)
  })
