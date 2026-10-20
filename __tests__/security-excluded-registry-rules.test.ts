import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// Four groups of Semgrep registry rules cannot match this repository: the 30 express rules, the
// express cors-misconfiguration rule, the sequelize express rule, and the react
// unsanitized-method rule. No sink is reachable from a handler-shaped function (any 2- or
// 3-parameter (request, response[, next]) function reading a parameter's query, body, params,
// cookies, headers or files; for express-res-sendfile, any function with a string-typed
// parameter), no sink package they import is imported, no file holds the text of a
// document.write, document.writeln or insertAdjacentHTML call (react-unsanitized-method matches
// that text in any file, a jest test included), and there is no DOM target, so
// scripts/checks/security.sh excludes them by their full check_id; every kiko-* rule keeps
// running on every file.
const SCRIPT = join(__dirname, '../scripts/checks/security.sh');
const LIBRARY = join(__dirname, '../scripts/checks/_lib.sh');
const REPOSITORY_ROOT = join(__dirname, '..');

const SEQUELIZE_EXPRESS_ID =
  'javascript.sequelize.security.audit.sequelize-injection-express.express-sequelize-injection';

const REACT_UNSANITIZED_METHOD_ID =
  'typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method';
const REACT_UNSANITIZED_PROPERTY_ID =
  'typescript.react.security.audit.react-unsanitized-property.react-unsanitized-property';
const EXPRESS_SSRF_FULL_ID = 'javascript.express.security.audit.express-ssrf.express-ssrf';
const EXPRESS_SSRF_SHORT_ID = 'javascript.express.security.audit.express-ssrf';

const EXCLUDED_RULE_IDS = [
  'javascript.express.security.audit.express-check-directory-listing.express-check-directory-listing',
  'javascript.express.security.audit.express-cookie-settings.express-cookie-session-default-name',
  'javascript.express.security.audit.express-cookie-settings.express-cookie-session-no-domain',
  'javascript.express.security.audit.express-cookie-settings.express-cookie-session-no-expires',
  'javascript.express.security.audit.express-cookie-settings.express-cookie-session-no-httponly',
  'javascript.express.security.audit.express-cookie-settings.express-cookie-session-no-path',
  'javascript.express.security.audit.express-cookie-settings.express-cookie-session-no-secure',
  'javascript.express.security.audit.express-jwt-not-revoked.express-jwt-not-revoked',
  'javascript.express.security.audit.express-libxml-noent.express-libxml-noent',
  'javascript.express.security.audit.express-open-redirect.express-open-redirect',
  'javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal',
  'javascript.express.security.audit.express-res-sendfile.express-res-sendfile',
  'javascript.express.security.audit.express-session-hardcoded-secret.express-session-hardcoded-secret',
  'javascript.express.security.audit.express-ssrf.express-ssrf',
  'javascript.express.security.audit.express-third-party-object-deserialization.express-third-party-object-deserialization',
  'javascript.express.security.audit.express-xml2json-xxe-event.express-xml2json-xxe-event',
  'javascript.express.security.audit.res-render-injection.res-render-injection',
  'javascript.express.security.audit.xss.direct-response-write.direct-response-write',
  'javascript.express.security.cors-misconfiguration.cors-misconfiguration',
  'javascript.express.security.express-expat-xxe.express-expat-xxe',
  'javascript.express.security.express-insecure-template-usage.express-insecure-template-usage',
  'javascript.express.security.express-jwt-hardcoded-secret.express-jwt-hardcoded-secret',
  'javascript.express.security.express-phantom-injection.express-phantom-injection',
  'javascript.express.security.express-puppeteer-injection.express-puppeteer-injection',
  'javascript.express.security.express-sandbox-injection.express-sandbox-code-injection',
  'javascript.express.security.express-vm-injection.express-vm-injection',
  'javascript.express.security.express-vm2-injection.express-vm2-injection',
  'javascript.express.security.express-xml2json-xxe.express-xml2json-xxe',
  'javascript.express.security.injection.raw-html-format.raw-html-format',
  'javascript.express.security.require-request.require-request',
  'javascript.express.security.x-frame-options-misconfiguration.x-frame-options-misconfiguration',
  SEQUELIZE_EXPRESS_ID,
  REACT_UNSANITIZED_METHOD_ID,
];

const EXPECTED_CONFIGS = [
  'p/typescript',
  'p/react',
  'p/secrets',
  join(REPOSITORY_ROOT, 'rules/semgrep-mobile.yml'),
  join(REPOSITORY_ROOT, 'rules/semgrep-prewrite.yml'),
];

function createStub() {
  const stubDirectory = createTemporaryDirectory('kiko-security-exclude-stub-');
  const stateDirectory = createTemporaryDirectory('kiko-security-exclude-state-');
  const logPath = join(stubDirectory, 'invocations.log');
  const stubPath = join(stubDirectory, 'semgrep');
  writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> "${logPath}"`,
      `printf '%s' '${JSON.stringify({ results: [], errors: [] })}'`,
      '',
    ].join('\n'),
  );
  chmodSync(stubPath, 0o755);
  const environment = {
    ...process.env,
    PATH: `${stubDirectory}:${process.env.PATH}`,
    TMPDIR: stateDirectory,
  };

  return {
    environment,
    invocations: () =>
      existsSync(logPath)
        ? readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : [],
    run: (target: string) =>
      spawnSync('bash', [SCRIPT, target], {
        encoding: 'utf8',
        cwd: REPOSITORY_ROOT,
        env: environment,
      }),
  };
}

function flagValues(argumentLine: string, flag: string): string[] {
  const words = argumentLine.split(' ');

  return words.flatMap((word, index) => (word === flag ? [words[index + 1]] : []));
}

function ruleFileIds(relativePath: string): string[] {
  return [
    ...readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8').matchAll(/^\s*- id:\s*(\S+)/gm),
  ].map((match) => match[1]);
}

afterEach(() => {
  removeTemporaryDirectories();
});

describe('scripts/checks/security.sh excluded registry rules', () => {
  it('excludes exactly the pinned express, cors, sequelize and react ids, keeps every config', () => {
    const stub = createStub();
    const target = join(REPOSITORY_ROOT, 'package.json');

    expect(stub.run(target).status).toBe(0);

    expect(stub.invocations()).toHaveLength(1);
    const line = stub.invocations()[0];
    expect(new Set(flagValues(line, '--exclude-rule'))).toEqual(new Set(EXCLUDED_RULE_IDS));
    expect(flagValues(line, '--exclude-rule')).toHaveLength(EXCLUDED_RULE_IDS.length);
    expect(flagValues(line, '--config')).toEqual(EXPECTED_CONFIGS);
    expect(flagValues(line, '--exclude')).toEqual(['fixtures']);
  });

  it('pins only express rules, the sequelize express rule, or the react method rule', () => {
    const outsideScope = EXCLUDED_RULE_IDS.filter(
      (id) =>
        !id.startsWith('javascript.express.') &&
        id !== SEQUELIZE_EXPRESS_ID &&
        id !== REACT_UNSANITIZED_METHOD_ID,
    );

    expect(EXCLUDED_RULE_IDS).toHaveLength(33);
    expect(outsideScope).toEqual([]);
  });

  it('keeps the react unsanitized-property rule running', () => {
    const stub = createStub();

    expect(stub.run(join(REPOSITORY_ROOT, 'package.json')).status).toBe(0);

    expect(EXCLUDED_RULE_IDS).not.toContain(REACT_UNSANITIZED_PROPERTY_ID);
    expect(flagValues(stub.invocations()[0], '--exclude-rule')).not.toContain(
      REACT_UNSANITIZED_PROPERTY_ID,
    );
  });

  it('passes the full check_id form, never the short form', () => {
    const stub = createStub();

    expect(stub.run(join(REPOSITORY_ROOT, 'package.json')).status).toBe(0);

    const excluded = flagValues(stub.invocations()[0], '--exclude-rule');
    expect(excluded).toContain(EXPRESS_SSRF_FULL_ID);
    expect(excluded).not.toContain(EXPRESS_SSRF_SHORT_ID);
  });

  it('never pins a kiko rule', () => {
    expect(EXCLUDED_RULE_IDS.filter((id) => id.includes('kiko'))).toEqual([]);
  });

  it.each(['rules/semgrep-mobile.yml', 'rules/semgrep-prewrite.yml'])(
    'keeps every rule id in %s out of the exclusion list',
    (relativePath) => {
      const ids = ruleFileIds(relativePath);

      expect(ids.length).toBeGreaterThan(0);
      expect(
        ids.filter((id) =>
          EXCLUDED_RULE_IDS.some((excluded) => excluded.endsWith(`.${id}`) || excluded === id),
        ),
      ).toEqual([]);
    },
  );

  it('pins full-form ids with at least five dotted segments and no duplicate', () => {
    expect(EXCLUDED_RULE_IDS.filter((id) => id.split('.').length < 5)).toEqual([]);
    expect(new Set(EXCLUDED_RULE_IDS).size).toBe(EXCLUDED_RULE_IDS.length);
  });

  it('does not let a pass recorded before the exclusion list vouch for the same file', () => {
    const stub = createStub();
    const target = join(REPOSITORY_ROOT, 'package.json');
    // The fingerprint security.sh computed before it passed any exclusion list.
    const recordLegacyPass = [
      `source "${LIBRARY}"`,
      `root="${REPOSITORY_ROOT}"`,
      `target="${target}"`,
      'dkey="security:$(printf \'%s\\n\' "$target" | harness_hash)"',
      'fp="$( { shasum "$target"; shasum "$root/rules/semgrep-mobile.yml"; shasum "$root/rules/semgrep-prewrite.yml"; } | harness_hash )"',
      'harness_mark_pass "$root" "$dkey" "$fp"',
    ].join('\n');

    const seeded = spawnSync('bash', ['-c', recordLegacyPass], {
      encoding: 'utf8',
      env: stub.environment,
    });
    const result = stub.run(target);

    expect(seeded.status).toBe(0);
    expect(result.stderr).not.toContain('SKIPPED');
    expect(stub.invocations()).toHaveLength(1);
  });
});
