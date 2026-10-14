import { createTaskProposal } from './taskProposal';
import { createQualityTaskLines } from './qualityPipeline';
import { extractTasks } from './taskExtraction';
import { setSummaryEngineMode, getSummaryEngineMode } from './summaryEngine';

jest.mock('./qualityPipeline', () => ({ createQualityTaskLines: jest.fn() }));
jest.mock('./taskExtraction', () => ({ extractTasks: jest.fn() }));

const mockCreateQualityTaskLines = jest.mocked(createQualityTaskLines);
const mockExtractTasks = jest.mocked(extractTasks);

describe('createTaskProposal routing', () => {
  const originalMode = getSummaryEngineMode();

  beforeEach(() => {
    jest.resetAllMocks();
    setSummaryEngineMode('points');
  });

  afterEach(() => {
    setSummaryEngineMode(originalMode);
  });

  it('routes Polish+points mode to createQualityTaskLines', async () => {
    mockCreateQualityTaskLines.mockResolvedValueOnce({
      tasks: ['Task A', 'Task B'],
      warnings: ['warning'],
    });

    const result = await createTaskProposal('source', () => {}, 'pl', undefined);

    expect(mockCreateQualityTaskLines).toHaveBeenCalledTimes(1);
    expect(mockExtractTasks).not.toHaveBeenCalled();
    expect(result.tasks).toEqual(['Task A', 'Task B']);
    expect(result.warnings).toEqual(['warning']);
  });

  it('deduplicates case-insensitively in points mode', async () => {
    mockCreateQualityTaskLines.mockResolvedValueOnce({
      tasks: ['Task A', 'task a', 'Task B'],
      warnings: [],
    });

    const result = await createTaskProposal('source', () => {}, 'pl', undefined);

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks).toContain('Task A');
    expect(result.tasks).toContain('Task B');
  });

  it('drops meta tasks like "Test nowej notatki" in points mode', async () => {
    mockCreateQualityTaskLines.mockResolvedValueOnce({
      tasks: ['Task A', 'Test nowej notatki głosowej', 'Task B', 'Sprawdzenie transkrypcji aplikacji'],
      warnings: [],
    });

    const result = await createTaskProposal('source', () => {}, 'pl', undefined);

    expect(result.tasks).toEqual(['Task A', 'Task B']);
    expect(result.tasks).not.toContain('Test nowej notatki głosowej');
  });

  it('passes warnings through in points mode', async () => {
    mockCreateQualityTaskLines.mockResolvedValueOnce({
      tasks: ['Task A'],
      warnings: ['Warning 1', 'Warning 2'],
    });

    const result = await createTaskProposal('source', () => {}, 'pl', undefined);

    expect(result.warnings).toEqual(['Warning 1', 'Warning 2']);
  });

  it('routes English+points to legacy extractTasks', async () => {
    mockExtractTasks.mockResolvedValueOnce(['Task A', 'Task B']);

    const result = await createTaskProposal('source', () => {}, 'en', undefined);

    expect(mockExtractTasks).toHaveBeenCalledTimes(1);
    expect(mockCreateQualityTaskLines).not.toHaveBeenCalled();
    expect(result.tasks).toEqual(['Task A', 'Task B']);
  });

  it('routes auto mode+Polish to legacy extractTasks', async () => {
    setSummaryEngineMode('auto');
    mockExtractTasks.mockResolvedValueOnce(['Task A']);

    await createTaskProposal('source', () => {}, 'pl', undefined);

    expect(mockExtractTasks).toHaveBeenCalledTimes(1);
    expect(mockCreateQualityTaskLines).not.toHaveBeenCalled();
  });

  it('deduplicates legacy extractTasks results case-insensitively', async () => {
    mockExtractTasks.mockResolvedValueOnce(['Kupić mleko', 'kupić mleko', 'Zapłacić rachunek']);

    const result = await createTaskProposal('source', () => {}, 'en', undefined);

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map(t => t.toLowerCase())).toContain('kupić mleko');
  });

  it('drops meta tasks from legacy extractTasks', async () => {
    mockExtractTasks.mockResolvedValueOnce(['Task A', 'Test nagrania', 'Task B']);

    const result = await createTaskProposal('source', () => {}, 'en', undefined);

    expect(result.tasks).not.toContain('Test nagrania');
  });

  it('collects warnings from legacy extractTasks onWarning callback', async () => {
    mockExtractTasks.mockImplementationOnce(async (_source, _onStatus, _lang, context) => {
      context?.onWarning?.('Warning from extract');
      return ['Task A'];
    });

    const result = await createTaskProposal('source', () => {}, 'en', undefined);

    expect(result.warnings).toContain('Warning from extract');
  });
});
