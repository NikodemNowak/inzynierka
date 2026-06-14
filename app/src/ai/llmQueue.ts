// llama.rn shares a single context, so two generations must never overlap.
// Every LLM job (note processing, task extraction) runs through this queue so
// they execute strictly one after another.
let chain: Promise<unknown> = Promise.resolve()

export const enqueueLlm = <T>(job: () => Promise<T>): Promise<T> => {
  const run = chain.then(job)
  // Keep the chain alive even if a job rejects, so later jobs still run.
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
