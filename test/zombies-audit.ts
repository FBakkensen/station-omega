import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REQUIRED_TAGS = ['[Z]', '[O]', '[M]', '[B]', '[I]', '[E]', '[S]'] as const;
const TEST_ROOTS = ['src', 'convex', 'test', 'web/src'];

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

const allFiles = TEST_ROOTS.flatMap(collectTestFiles).sort();

if (allFiles.length === 0) {
  console.error('No deterministic test files found for ZOMBIES audit.');
  process.exit(1);
}

const violations: string[] = [];

for (const file of allFiles) {
  const content = readFileSync(file, 'utf8');
  const missing = REQUIRED_TAGS.filter((tag) => !content.includes(tag));
  if (missing.length > 0) {
    violations.push(`${relative(process.cwd(), file)} missing tags: ${missing.join(', ')}`);
  }
}

if (violations.length > 0) {
  console.error('ZOMBIES audit failed.\n');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`ZOMBIES audit passed for ${String(allFiles.length)} test file(s).`);
