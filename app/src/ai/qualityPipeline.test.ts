import { processNoteQuality, createQualityTaskLines } from './qualityPipeline';
import { generatePointSummary } from './pointSummary';
import { generateTitleAndTags } from './titleTags';
import { prepareSpokenSource } from './spokenSource';
import { extractTaskLines } from './taskLines';
import { findSpokenCorrections } from './spokenCorrections';
import type { SummaryDocument } from '../domain/summary';

jest.mock('./pointSummary', () => ({ generatePointSummary: jest.fn() }));
jest.mock('./titleTags', () => ({ generateTitleAndTags: jest.fn() }));
jest.mock('./spokenSource', () => ({ prepareSpokenSource: jest.fn() }));
jest.mock('./taskLines', () => ({ extractTaskLines: jest.fn() }));
jest.mock('./spokenCorrections', () => ({
  ...jest.requireActual('./spokenCorrections'),
  findSpokenCorrections: jest.fn(),
}));
jest.mock('../domain/summary', () => ({
  renderSummaryDocument: (doc: any) => doc ? `summary: ${JSON.stringify(doc)}` : '',
}));

const mockGeneratePointSummary = jest.mocked(generatePointSummary);
const mockGenerateTitleAndTags = jest.mocked(generateTitleAndTags);
const mockPrepareSpokenSource = jest.mocked(prepareSpokenSource);
const mockExtractTaskLines = jest.mocked(extractTaskLines);
const mockFindSpokenCorrections = jest.mocked(findSpokenCorrections);

describe('processNoteQuality', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPrepareSpokenSource.mockResolvedValue(null);
    mockFindSpokenCorrections.mockResolvedValue([]);
  });

  it('returns title, categories as tags, and summary from document in happy path', async () => {
    const doc: SummaryDocument = {
      version: 1,
      source: 'test',
      format: 'bullets',
      points: [{ text: 'First point', sources: [] }, { text: 'Second point', sources: [] }],
    };
    mockGeneratePointSummary.mockResolvedValueOnce({
      points: [{ text: 'First point', sourceIds: [1] }, { text: 'Second point', sourceIds: [2] }],
      document: doc,
      warnings: [],
      literalFallbackCount: 0,
    });
    mockGenerateTitleAndTags.mockResolvedValueOnce({
      title: 'Test Title',
      categories: ['Praca', 'Nauka'],
      titleFallback: false,
    });

    const progress: string[] = [];
    const result = await processNoteQuality('test content', (p) => {
      progress.push(p.phase);
    }, 'pl', undefined);

    expect(result.title).toBe('Test Title');
    expect(result.tags).toEqual(['Praca', 'Nauka']);
    expect(result.summary).toContain('First point');
    expect(result.summaryDocument).toBe(doc);
    expect(result.warnings).toBeUndefined();
    expect(result.failedFields).toBeUndefined();
    expect(progress).toContain('summary');
    expect(progress).toContain('title');
  });

  it('adds failedFields and warning when summary points are empty', async () => {
    mockGeneratePointSummary.mockResolvedValueOnce({
      points: [],
      document: null,
      warnings: [],
      literalFallbackCount: 0,
    });
    mockGenerateTitleAndTags.mockResolvedValueOnce({
      title: 'Test Title',
      categories: ['Praca'],
      titleFallback: false,
    });

    const result = await processNoteQuality('test content', () => {}, 'pl', undefined);

    expect(result.failedFields).toContain('summary');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain('podsumowania');
  });

  it('adds failedFields and warning when categories are empty', async () => {
    mockGeneratePointSummary.mockResolvedValueOnce({
      points: [{ text: 'Point', sourceIds: [1] }],
      document: { version: 1, source: 'test', format: 'bullets', points: [] },
      warnings: [],
      literalFallbackCount: 0,
    });
    mockGenerateTitleAndTags.mockResolvedValueOnce({
      title: 'Test Title',
      categories: [],
      titleFallback: false,
    });

    const result = await processNoteQuality('test content', () => {}, 'pl', undefined);

    expect(result.failedFields).toContain('tags');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings?.[0]).toContain('kategorii');
  });

  it('falls back title when generateTitleAndTags throws', async () => {
    mockGeneratePointSummary.mockResolvedValueOnce({
      points: [{ text: 'Point', sourceIds: [1] }],
      document: { version: 1, source: 'test', format: 'bullets', points: [] },
      warnings: [],
      literalFallbackCount: 0,
    });
    mockGenerateTitleAndTags.mockRejectedValueOnce(new Error('Generation failed'));

    const result = await processNoteQuality('test content', () => {}, 'pl', undefined);

    expect(result.failedFields).toContain('title');
    expect(result.failedFields).toContain('tags');
    expect(result.title).toBeTruthy();
    expect(result.title.length).toBeGreaterThan(0);
  });

  it('includes summary warnings in result warnings', async () => {
    mockGeneratePointSummary.mockResolvedValueOnce({
      points: [{ text: 'Point', sourceIds: [1] }],
      document: { version: 1, source: 'test', format: 'bullets', points: [] },
      warnings: ['Custom warning from summary'],
      literalFallbackCount: 0,
    });
    mockGenerateTitleAndTags.mockResolvedValueOnce({
      title: 'Test Title',
      categories: ['Praca'],
      titleFallback: false,
    });

    const result = await processNoteQuality('test content', () => {}, 'pl', undefined);

    expect(result.warnings).toContain('Custom warning from summary');
  });

  it('sends English warning when language is en', async () => {
    mockGeneratePointSummary.mockResolvedValueOnce({
      points: [],
      document: null,
      warnings: [],
      literalFallbackCount: 0,
    });
    mockGenerateTitleAndTags.mockResolvedValueOnce({
      title: 'Test Title',
      categories: ['Praca'],
      titleFallback: false,
    });

    const result = await processNoteQuality('test content', () => {}, 'en', undefined);

    expect(result.warnings?.[0]).toContain('reliable summary');
  });

  it('calls progress callbacks with phases in correct order', async () => {
    const phases: string[] = [];
    mockGeneratePointSummary.mockResolvedValueOnce({
      points: [{ text: 'Point', sourceIds: [1] }],
      document: { version: 1, source: 'test', format: 'bullets', points: [] },
      warnings: [],
      literalFallbackCount: 0,
    });
    mockGenerateTitleAndTags.mockResolvedValueOnce({
      title: 'Test Title',
      categories: ['Praca'],
      titleFallback: false,
    });

    await processNoteQuality('test content', (p) => {
      phases.push(p.phase);
    }, 'pl', undefined);

    const summaryIdx = phases.indexOf('summary');
    const titleIdx = phases.indexOf('title');
    expect(summaryIdx).toBeLessThan(titleIdx);
  });
});

describe('createQualityTaskLines', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockFindSpokenCorrections.mockResolvedValue([]);
    mockPrepareSpokenSource.mockResolvedValue(null);
  });

  it('returns tasks and warnings from extractTaskLines', async () => {
    mockExtractTaskLines.mockResolvedValueOnce({
      tasks: [],
      rendered: ['Task A', 'Task B'],
      warnings: ['warning text'],
    });

    const result = await createQualityTaskLines('source text', 'pl', undefined);

    expect(result.tasks).toEqual(['Task A', 'Task B']);
    expect(result.warnings).toEqual(['warning text']);
  });

  it('calls extractTaskLines with units from qualitySourceUnits', async () => {
    mockExtractTaskLines.mockResolvedValueOnce({
      tasks: [],
      rendered: [],
      warnings: [],
    });

    await createQualityTaskLines('source text', 'pl', undefined);

    expect(mockExtractTaskLines).toHaveBeenCalledTimes(1);
    const units = mockExtractTaskLines.mock.calls[0][0];
    expect(Array.isArray(units)).toBe(true);
  });

  it('extracts tasks from the note with the corrections applied', async () => {
    mockFindSpokenCorrections.mockResolvedValueOnce([{ old: 'cztery', new: 'sześć' }]);
    mockExtractTaskLines.mockResolvedValueOnce({ tasks: [], rendered: [], warnings: [] });

    await createQualityTaskLines('Kupić piwo, cztery, nie, sześć, na sobotę.', 'pl', undefined);

    const units = mockExtractTaskLines.mock.calls[0][0];
    expect(units.map(unit => unit.text).join(' ')).toContain('piwo, sześć, na sobotę');
    expect(units.map(unit => unit.text).join(' ')).not.toContain('cztery');
  });
});
