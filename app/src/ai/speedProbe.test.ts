import { generate, loadModel, unloadModel, type GenerationResult } from "./llm";
import { SPEED_PROBE_VARIANTS, runSpeedProbe } from "./speedProbe";

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async () => undefined),
}));
jest.mock("./benchmarkModels", () => ({
  benchmarkModelPath: () => "/bench.gguf",
}));
jest.mock("./llm", () => ({
  generate: jest.fn(),
  loadModel: jest.fn(async () => undefined),
  unloadModel: jest.fn(async () => undefined),
  getLoadedModelInfo: () => ({ nativeInitLog: ["has tensor = true"] }),
}));

const reply = (text: string): GenerationResult => ({
  text,
  ttftMs: 1,
  tokensPerSecond: 10,
  wallMs: 20_000,
  promptTokens: 3000,
  promptMs: 10_000,
  predictedTokens: 100,
  predictedMs: 10_000,
});

test("runs every variant with its own tuning and compares text to the base", async () => {
  jest
    .mocked(generate)
    .mockImplementation(async (_prompt, _token, options) =>
      reply(options?.nPredict === 160 ? "same" : "short"),
    );
  const report = await runSpeedProbe();
  expect(report.results.map((item) => item.id)).toEqual(
    SPEED_PROBE_VARIANTS.map((item) => item.id),
  );
  expect(
    jest.mocked(loadModel).mock.calls.map(([, , options]) => options?.tuning),
  ).toEqual(SPEED_PROBE_VARIANTS.map((item) => item.tuning));
  expect(report.results[0]).toMatchObject({
    prefillTokensPerSecond: 300,
    longDecodeTokensPerSecond: 10,
    sameTextAsBase: null,
  });
  expect(report.results[1].sameTextAsBase).toBe(true);
  expect(unloadModel).toHaveBeenCalled();
});

test("keeps the other variants when one setting fails to load", async () => {
  jest.mocked(loadModel).mockReset();
  jest
    .mocked(loadModel)
    .mockImplementation(async (_path, _progress, options) => {
      if (options?.tuning?.cacheType) throw new Error("unsupported cache type");
    });
  jest.mocked(generate).mockImplementation(async () => reply("x"));
  const report = await runSpeedProbe();
  expect(report.results.find((item) => item.id === "kv-q8")?.error).toBe(
    "unsupported cache type",
  );
  expect(
    report.results.find((item) => item.id === "ubatch-1024")?.error,
  ).toBeNull();
});
