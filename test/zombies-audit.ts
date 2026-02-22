import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';

const ZOMBIES_TAGS = ['Z', 'O', 'M', 'B', 'I', 'E', 'S'] as const;
const TAG_SET = new Set<string>(ZOMBIES_TAGS);
const TEST_ROOTS = ['src', 'convex', 'test', 'web/src'];
const STACKED_TAG_PREFIX = /^(\[[ZOMBIES]\]){2,}/;
const TAGGED_TITLE_PREFIX = /^\[([ZOMBIES])\]\s+(.+)/;
const ASSERTION_PATTERN = /\b(expect\s*\(|assert\.)/;

type ZombieTag = (typeof ZOMBIES_TAGS)[number];

type Violation = {
  code: string;
  file: string;
  line: number;
  describeTitle: string;
  message: string;
};

type TestCase = {
  title: string;
  line: number;
  bodyText: string;
  tag: ZombieTag | null;
  describeTitle: string;
};

type DescribeBlock = {
  title: string;
  line: number;
  tests: TestCase[];
};

const TAG_KEYWORDS: Record<ZombieTag, RegExp> = {
  Z: /(zero|empt|none|null|missing|absent|minim|default|unknown|no-op|without|start|initial)/,
  O: /(one|single|first|minim|exact|valid|transition|resolv|append|map|treat|assign|accept|extract|provided|look_around|import-time)/,
  M: /(many|multi|multiple|full|complex|across|queued|parallel|retry|ordered|larger|conversation|graph|support|preserv|mutation|attempt|batch|repeat|block)/,
  B: /(boundary|bound|limit|edge|threshold|capacity|range|clamp|max|min|out-of-range|exceed|high-score|missing_entry|empty-string|absent|large|exhaust|escape|index|progress|escaped)/,
  I: /(interface|invariant|contract|shape|field|method|schema|type|wire|diagnostic|derived|fallback|persist|record|array|result|context|prompt|validation|component|fixture|request)/,
  E: /(error|throw|reject|invalid|malformed|fail|exception|unreachable|missing|block|safe|tolerat|skip|wrap|negative|before)/,
  S: /(simple|standard|stable|deterministic|happy|nominal|success|flow|follow|return|produc|comput|deriv|reset|available|idempotent|ordinary|safe|range)/,
};

function collectTestFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const results: string[] = [];
  const entries = readdirSync(root);
  for (const entry of entries) {
    const absolute = join(root, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      results.push(...collectTestFiles(absolute));
      continue;
    }
    if (absolute.endsWith('.test.ts') || absolute.endsWith('.test.tsx')) {
      results.push(absolute);
    }
  }
  return results;
}

function isNamedCall(node: ts.CallExpression, names: string[]): boolean {
  const { expression } = node;
  if (ts.isIdentifier(expression)) {
    return names.includes(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return names.includes(expression.expression.text);
  }
  return false;
}

function getLiteralText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function getCallback(node: ts.CallExpression): ts.ArrowFunction | ts.FunctionExpression | null {
  for (let i = node.arguments.length - 1; i >= 0; i -= 1) {
    const arg = node.arguments[i];
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
  }
  return null;
}

function lineNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function extractBodyText(
  sourceFile: ts.SourceFile,
  callback: ts.ArrowFunction | ts.FunctionExpression | null,
): string {
  if (!callback) return '';
  return callback.body.getText(sourceFile).toLowerCase();
}

function parseFile(
  absoluteFilePath: string,
): { describes: DescribeBlock[]; violations: Violation[]; testCount: number } {
  const content = readFileSync(absoluteFilePath, 'utf8');
  const scriptKind = extname(absoluteFilePath) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(absoluteFilePath, content, ts.ScriptTarget.Latest, true, scriptKind);
  const relativePath = relative(process.cwd(), absoluteFilePath);
  const rootDescribe: DescribeBlock = { title: '<root>', line: 1, tests: [] };
  const describes: DescribeBlock[] = [];
  const violations: Violation[] = [];
  let testCount = 0;

  const pushViolation = (
    code: string,
    message: string,
    describeTitle: string,
    node: ts.Node,
  ): void => {
    violations.push({
      code,
      file: relativePath,
      line: lineNumber(sourceFile, node),
      describeTitle,
      message,
    });
  };

  const recordTest = (title: string, callback: ts.ArrowFunction | ts.FunctionExpression | null, node: ts.CallExpression, describe: DescribeBlock): void => {
    testCount += 1;
    const describeTitle = describe.title;
    const normalized = title.trim();

    if (STACKED_TAG_PREFIX.test(normalized)) {
      pushViolation('ZA002', `test title "${normalized}" stacks multiple tag prefixes`, describeTitle, node);
      describe.tests.push({
        title: normalized,
        line: lineNumber(sourceFile, node),
        bodyText: extractBodyText(sourceFile, callback),
        tag: null,
        describeTitle,
      });
      return;
    }

    const taggedMatch = normalized.match(TAGGED_TITLE_PREFIX);
    if (!taggedMatch) {
      pushViolation(
        'ZA001',
        `test title "${normalized}" must begin with a single tag prefix like "[Z] ..."` ,
        describeTitle,
        node,
      );
      describe.tests.push({
        title: normalized,
        line: lineNumber(sourceFile, node),
        bodyText: extractBodyText(sourceFile, callback),
        tag: null,
        describeTitle,
      });
      return;
    }

    const [, tagLetter] = taggedMatch;
    const tag = TAG_SET.has(tagLetter) ? (tagLetter as ZombieTag) : null;
    describe.tests.push({
      title: normalized,
      line: lineNumber(sourceFile, node),
      bodyText: extractBodyText(sourceFile, callback),
      tag,
      describeTitle,
    });
  };

  const walk = (node: ts.Node, currentDescribe: DescribeBlock): void => {
    if (ts.isCallExpression(node) && isNamedCall(node, ['describe'])) {
      const describeName = getLiteralText(node.arguments[0]);
      const callback = getCallback(node);
      if (!describeName) {
        pushViolation(
          'ZA004',
          'describe title must be a static string literal for deterministic auditing',
          currentDescribe.title,
          node,
        );
      }
      const nextDescribe: DescribeBlock = {
        title: describeName ?? '<anonymous describe>',
        line: lineNumber(sourceFile, node),
        tests: [],
      };
      describes.push(nextDescribe);
      if (!callback) {
        pushViolation(
          'ZA005',
          `describe "${nextDescribe.title}" is missing a callback body`,
          currentDescribe.title,
          node,
        );
        return;
      }
      if (ts.isBlock(callback.body)) {
        for (const statement of callback.body.statements) {
          walk(statement, nextDescribe);
        }
      } else {
        walk(callback.body, nextDescribe);
      }
      return;
    }

    if (ts.isCallExpression(node) && isNamedCall(node, ['it', 'test'])) {
      const title = getLiteralText(node.arguments[0]);
      const callback = getCallback(node);
      if (!title) {
        pushViolation(
          'ZA003',
          'test title must be a static string literal for deterministic auditing',
          currentDescribe.title,
          node,
        );
      } else {
        recordTest(title, callback, node, currentDescribe);
      }
      return;
    }

    ts.forEachChild(node, (child) => {
      walk(child, currentDescribe);
    });
  };

  walk(sourceFile, rootDescribe);

  const allDescribes = [...describes];
  if (rootDescribe.tests.length > 0) {
    allDescribes.push(rootDescribe);
  }

  for (const describeBlock of allDescribes) {
    const tagCoverage = new Set<ZombieTag>();

    for (const testCase of describeBlock.tests) {
      if (testCase.tag) {
        tagCoverage.add(testCase.tag);
      }
      if (!ASSERTION_PATTERN.test(testCase.bodyText)) {
        violations.push({
          code: 'ZA020',
          file: relativePath,
          line: testCase.line,
          describeTitle: testCase.describeTitle,
          message: `test "${testCase.title}" does not appear to contain an assertion`,
        });
      }
      if (testCase.tag) {
        const searchable = `${testCase.title.toLowerCase()} ${testCase.bodyText}`;
        if (!TAG_KEYWORDS[testCase.tag].test(searchable)) {
          violations.push({
            code: 'ZA030',
            file: relativePath,
            line: testCase.line,
            describeTitle: testCase.describeTitle,
            message: `test "${testCase.title}" is tagged [${testCase.tag}] but is missing expected ${testCase.tag} semantic hints`,
          });
        }
      }
    }

    const missing = ZOMBIES_TAGS.filter((tag) => !tagCoverage.has(tag));
    if (describeBlock.tests.length > 0 && missing.length > 0) {
      violations.push({
        code: 'ZA010',
        file: relativePath,
        line: describeBlock.line,
        describeTitle: describeBlock.title,
        message: `describe "${describeBlock.title}" is missing tag coverage for: ${missing.map((tag) => `[${tag}]`).join(', ')}`,
      });
    }
  }

  return { describes: allDescribes, violations, testCount };
}

const allFiles = TEST_ROOTS.flatMap(collectTestFiles).sort();

if (allFiles.length === 0) {
  console.error('No deterministic test files found for ZOMBIES audit.');
  process.exit(1);
}

const violations: Violation[] = [];
let testCount = 0;

for (const file of allFiles) {
  const parsed = parseFile(file);
  violations.push(...parsed.violations);
  testCount += parsed.testCount;
}

if (testCount === 0) {
  console.error('No deterministic test cases found for ZOMBIES audit.');
  process.exit(1);
}

if (violations.length > 0) {
  const sortedViolations = [...violations].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.describeTitle !== b.describeTitle) return a.describeTitle.localeCompare(b.describeTitle);
    if (a.line !== b.line) return a.line - b.line;
    return a.code.localeCompare(b.code);
  });
  const grouped = new Map<string, Violation[]>();
  for (const violation of sortedViolations) {
    const key = `${violation.file}::${violation.describeTitle}`;
    const list = grouped.get(key) ?? [];
    list.push(violation);
    grouped.set(key, list);
  }

  console.error('ZOMBIES audit failed.\n');
  for (const [key, group] of grouped) {
    const [file, describeTitle] = key.split('::');
    console.error(file);
    console.error(`  describe: ${describeTitle}`);
    for (const violation of group) {
      console.error(`  - [${violation.code}] L${String(violation.line)} ${violation.message}`);
    }
    console.error('');
  }
  process.exit(1);
}

console.log(
  `ZOMBIES audit passed for ${String(allFiles.length)} test file(s) and ${String(testCount)} test case(s).`,
);
