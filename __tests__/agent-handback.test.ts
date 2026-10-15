import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const agentsDirectory = join(__dirname, '..', 'harness/kiko/agents');
const agentFiles = readdirSync(agentsDirectory).filter((name) => name.endsWith('.md'));

const denyRule =
  /^- If a hook or the permission system denies a command, stop and report it; never route around it/m;

const hasBashTool = (text: string): boolean =>
  /^tools:.*\bBash\b/m.test(text.split('---')[1] ?? '');

const meetsDenyRule = (text: string): boolean => !hasBashTool(text) || denyRule.test(text);

const bashAgentFiles = agentFiles.filter((name) =>
  hasBashTool(readFileSync(join(agentsDirectory, name), 'utf8')),
);

describe('harness agent deny rule', () => {
  it('finds the agents that can run Bash', () => {
    expect(bashAgentFiles.length).toBeGreaterThan(0);
  });

  it.each(agentFiles)('%s carries the deny stop-and-report rule when it has Bash', (name) => {
    expect(meetsDenyRule(readFileSync(join(agentsDirectory, name), 'utf8'))).toBe(true);
  });

  it('rejects a Bash agent whose deny rule is missing', () => {
    const text = '---\ntools: Read, Bash\n---\n- Some other rule.\n';

    expect(meetsDenyRule(text)).toBe(false);
  });

  it('requires nothing of an agent without Bash', () => {
    expect(meetsDenyRule('---\ntools: Read, Grep\n---\nbody\n')).toBe(true);
  });
});

describe('harness agent hand-back', () => {
  it.each(agentFiles)('%s names the SubagentHandback tool', (name) => {
    expect(readFileSync(join(agentsDirectory, name), 'utf8')).toContain('SubagentHandback');
  });

  it('ops does not run on haiku', () => {
    const frontmatter = readFileSync(join(agentsDirectory, 'ops.md'), 'utf8').split('---')[1];

    expect(frontmatter).not.toMatch(/^model:\s*haiku\s*$/m);
  });
});
