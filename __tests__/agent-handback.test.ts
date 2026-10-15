import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const agentsDirectory = join(__dirname, '..', 'harness/kiko/agents');
const agentFiles = readdirSync(agentsDirectory).filter((name) => name.endsWith('.md'));

describe('harness agent hand-back', () => {
  it.each(agentFiles)('%s names the SubagentHandback tool', (name) => {
    expect(readFileSync(join(agentsDirectory, name), 'utf8')).toContain('SubagentHandback');
  });

  it('ops does not run on haiku', () => {
    const frontmatter = readFileSync(join(agentsDirectory, 'ops.md'), 'utf8').split('---')[1];

    expect(frontmatter).not.toMatch(/^model:\s*haiku\s*$/m);
  });
});
