import type { ChangeEvidence, FileCategory, StagedFile } from './types.js';

/**
 * Path patterns, most specific first — the first match wins.
 * Order matters: `.github/workflows/ci.yml` is CI, not config, and
 * `package.json` is a dependency manifest, not config.
 */
const CATEGORY_PATTERNS: readonly [RegExp, FileCategory][] = [
  // Lockfiles and dependency manifests
  [
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|uv\.lock)$/,
    'deps',
  ],
  [
    /(^|\/)(package\.json|go\.mod|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|Pipfile|Gemfile|composer\.json|pubspec\.yaml)$/,
    'deps',
  ],

  // CI / release automation
  [/(^|\/)\.github\/(workflows|actions)\//, 'ci'],
  [/(^|\/)(\.gitlab-ci\.yml|\.travis\.yml|appveyor\.yml|azure-pipelines\.yml|Jenkinsfile)$/, 'ci'],
  [/(^|\/)\.(circleci|woodpecker|drone)\//, 'ci'],

  // Build output and generated code
  [/(^|\/)(dist|build|out|coverage|node_modules|\.next|\.nuxt|target|vendor)\//, 'generated'],
  [/\.min\.(js|css)$/, 'generated'],
  [/\.(map|lock)$/, 'generated'],
  [/(^|\/)__snapshots__\//, 'generated'],
  [/\.(generated|g)\.[a-z]+$/, 'generated'],
  [/(_pb2\.py|\.pb\.go|\.gen\.go)$/, 'generated'],

  // Tests
  [/(^|\/)(test|tests|spec|__tests__|e2e|cypress|playwright)\//, 'test'],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, 'test'],
  [/(_test\.(go|py|rb|dart)|_spec\.rb|Test\.(java|kt|cs)|Tests\.(cs|swift))$/, 'test'],
  [/(^|\/)conftest\.py$/, 'test'],

  // Docs
  [/\.(md|mdx|rst|adoc|txt)$/, 'docs'],
  [/(^|\/)(docs?|documentation)\//, 'docs'],
  [/(^|\/)(README|CHANGELOG|LICEN[CS]E|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|AUTHORS)(\.[a-z]+)?$/i, 'docs'],

  // Binary-ish assets
  [
    /\.(png|jpe?g|gif|svg|ico|webp|avif|bmp|mp4|mov|webm|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf|zip|tar|t?gz|bz2|7z|jar|wasm)$/i,
    'asset',
  ],

  // Config and tooling
  [/(^|\/)(Dockerfile|docker-compose\.ya?ml|Makefile|justfile|Procfile|\.dockerignore)$/i, 'config'],
  [
    /(^|\/)(tsconfig|jsconfig|eslint|prettier|babel|webpack|vite|rollup|tsup|jest|vitest|tailwind|postcss|nodemon|commitlint|lint-staged|renovate)[^/]*\.(json|ya?ml|js|cjs|mjs|ts|toml)$/,
    'config',
  ],
  [/(^|\/)\.[^/]+$/, 'config'], // dotfiles: .gitignore, .prettierrc, .env
  [/\.(json|ya?ml|toml|ini|conf|cfg|env|properties|editorconfig)$/, 'config'],
];

/** Buckets a path by what kind of file it is. Defaults to source code. */
export function categorize(path: string): FileCategory {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(path)) return category;
  }
  return 'source';
}

/** Categories that are noise in a commit message — trimmed hardest in the diff. */
export function isNoise(file: StagedFile): boolean {
  return (
    file.binary ||
    file.category === 'deps' ||
    file.category === 'generated' ||
    file.category === 'asset'
  );
}

/** Directory segments that say nothing useful as a scope. */
const SKIP_SEGMENTS = new Set([
  'src',
  'lib',
  'app',
  'apps',
  'packages',
  'source',
  'internal',
  'pkg',
  '',
]);

/**
 * Guesses a conventional-commit scope from the changed paths: the deepest
 * directory they share, or the file's own name when only one file changed.
 */
export function inferScope(files: StagedFile[]): string | undefined {
  const paths = files.filter((f) => !isNoise(f)).map((f) => f.path);
  if (paths.length === 0) return undefined;

  if (paths.length === 1) {
    const only = paths[0] ?? '';
    const dir = only.split('/').slice(0, -1).pop();
    if (dir && !SKIP_SEGMENTS.has(dir)) return dir;
    // Single top-level-ish file — use its own name, e.g. src/git.ts → git
    const base = (only.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
    return base && !SKIP_SEGMENTS.has(base) ? base : undefined;
  }

  const split = paths.map((p) => p.split('/').slice(0, -1));
  const first = split[0] ?? [];
  const common: string[] = [];

  for (let i = 0; i < first.length; i++) {
    const segment = first[i];
    if (segment === undefined) break;
    if (!split.every((parts) => parts[i] === segment)) break;
    common.push(segment);
  }

  for (let i = common.length - 1; i >= 0; i--) {
    const segment = common[i];
    if (segment && !SKIP_SEGMENTS.has(segment)) return segment;
  }

  return undefined;
}

/** Human-readable summary of a category set, e.g. "documentation". */
const CATEGORY_LABEL: Record<FileCategory, string> = {
  source: 'source code',
  test: 'test',
  docs: 'documentation',
  config: 'configuration or tooling',
  deps: 'dependency manifest or lockfile',
  ci: 'CI configuration',
  generated: 'generated or build-output',
  asset: 'binary asset',
};

/** Single-category file sets that pin the commit type down. */
const SINGLE_CATEGORY_TYPE: Partial<Record<FileCategory, string>> = {
  docs: 'docs',
  test: 'test',
  deps: 'build',
  ci: 'ci',
  config: 'chore',
};

/**
 * Reads the file list — not the code — and reports what it already proves.
 * Only claims a type when the evidence is unambiguous; a mixed change is left
 * for the model to judge from the diff.
 */
export function inferEvidence(files: StagedFile[]): ChangeEvidence {
  const notes: string[] = [];
  if (files.length === 0) return { notes };

  // Generated output rides along with real changes — ignore it when deciding.
  const meaningful = files.filter((f) => f.category !== 'generated');
  const considered = meaningful.length > 0 ? meaningful : files;
  const categories = new Set(considered.map((f) => f.category));

  const added = files.filter((f) => f.status === 'added');
  const deleted = files.filter((f) => f.status === 'deleted');
  const renamed = files.filter((f) => f.status === 'renamed');

  if (added.length > 0) {
    notes.push(
      `${String(added.length)} new file${added.length > 1 ? 's' : ''} added: ${added
        .map((f) => f.path)
        .slice(0, 4)
        .join(', ')}`,
    );
  }
  if (deleted.length > 0) {
    notes.push(
      `${String(deleted.length)} file${deleted.length > 1 ? 's' : ''} deleted: ${deleted
        .map((f) => f.path)
        .slice(0, 4)
        .join(', ')}`,
    );
  }
  for (const file of renamed.slice(0, 4)) {
    const churn = file.insertions + file.deletions;
    notes.push(
      `renamed ${file.oldPath ?? '?'} → ${file.path}` +
        (churn === 0 ? ' with no content change' : ` (+${String(file.insertions)} −${String(file.deletions)})`),
    );
  }

  const noisy = files.filter(isNoise);
  if (noisy.length > 0 && noisy.length < files.length) {
    notes.push(
      `${noisy.map((f) => f.path).slice(0, 3).join(', ')} ${
        noisy.length > 1 ? 'are' : 'is'
      } generated/dependency noise — describe the source change, not this`,
    );
  }

  let suggestedType: string | undefined;
  let reason: string | undefined;

  if (categories.size === 1) {
    const only = [...categories][0] as FileCategory;
    const mapped = SINGLE_CATEGORY_TYPE[only];
    if (mapped) {
      suggestedType = mapped;
      reason = `every changed file is ${CATEGORY_LABEL[only]} → \`${mapped}\``;
    }
  }

  if (!suggestedType && categories.size === 2 && categories.has('deps') && categories.has('config')) {
    suggestedType = 'build';
    reason = 'only dependency and build configuration changed → `build`';
  }

  // Pure moves: every file renamed, nothing rewritten inside them.
  if (
    !suggestedType &&
    renamed.length === considered.length &&
    considered.every((f) => f.insertions + f.deletions === 0)
  ) {
    suggestedType = 'refactor';
    reason = 'files were only moved or renamed, with no content change → `refactor`';
  }

  if (!suggestedType && categories.has('source') && categories.has('test')) {
    notes.push('source and tests changed together — judge the type from the source diff');
  }

  return { suggestedType, reason, suggestedScope: inferScope(files), notes };
}
