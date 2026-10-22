import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('import UI terminal status', () => {
  it('shows failed jobs as interrupted and preserves their partial line count', () => {
    const page = readFileSync(new URL('../public/import.html', import.meta.url), 'utf8');
    const translations = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');

    expect(page).toContain('hasFailures: jobs.some(function (job) { return job.status === "failed"; })');
    expect(page).toContain('tr("import.interrupted_title", "Import interrompu")');
    expect(page).toContain('processed.toLocaleString() + (isActive ? " traitées…" : " traitées")');
    expect(translations).toContain("'import.interrupted_title': 'Import interrompu'");
    expect(translations).toContain("'import.interrupted_title': 'Import interrupted'");
  });
});
