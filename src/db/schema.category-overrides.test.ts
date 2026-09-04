import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('category_overrides migration', () => {
  const migrationsDir = join(__dirname, '../../drizzle/migrations');
  const sqlFiles = (): string[] =>
    readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(join(migrationsDir, name), 'utf8'));

  it('creates the category_overrides table', () => {
    const combined = sqlFiles().join('\n');

    expect(combined).toContain('CREATE TABLE `category_overrides`');
    expect(combined).toContain('`normalized_name`');
    expect(combined).toContain('`category`');
    expect(combined).toContain('`display_name`');
  });

  it('registers the new migration in the migrations index', () => {
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(index).toContain('0007');
  });
});
