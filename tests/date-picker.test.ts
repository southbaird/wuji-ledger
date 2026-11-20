import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/date-picker.ts', import.meta.url), 'utf8');

describe('date picker selector stability inside Obsidian modals', () => {
  it('mounts the popover inside the active modal focus scope instead of directly under body', () => {
    expect(source).toContain("anchor.closest<HTMLElement>('.modal-container')");
    expect(source).toContain('this.portalHost.appendChild(this.root)');
    expect(source).not.toContain('this.doc.body.appendChild(this.root)');
  });

  it('repositions on viewport changes instead of unconditionally closing native selects', () => {
    expect(source).toContain("this.doc.addEventListener('scroll', this.onViewportChange");
    expect(source).toContain('private readonly onViewportChange = (): void => {\n    this.position();');
    expect(source).not.toContain('private readonly onViewportChange = (): void => {\n    this.close(false);');
  });
});
