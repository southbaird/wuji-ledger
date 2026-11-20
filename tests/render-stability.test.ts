import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function sourceBetween(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    throw new Error(`Could not locate source range: ${start} -> ${end}`);
  }
  return source.slice(from, to);
}

describe('render stability', () => {
  it('refreshes saved record data without rebuilding the header or toolbar', () => {
    const ledgerView = sourceBetween('class AssetLedgerView', 'class AssetWidgetView');
    const refresh = sourceBetween('refreshData(): void', 'private attachBloub');
    const pluginRefresh = sourceBetween(
      'refreshDataViews(): void',
      '\n}\n\nclass AssetLedgerView',
    );

    expect(ledgerView).toContain('private renderDataLayout(');
    expect(refresh).toContain('this.renderDataLayout(shell, previousLayout)');
    expect(refresh).toContain('this.updateRecordCount(records.length)');
    expect(refresh).not.toContain('root.empty()');
    expect(refresh.indexOf('this.render()')).toBeLessThan(
      refresh.indexOf('this.updateRecordCount(records.length)'),
    );
    expect(pluginRefresh).toContain('leaf.view.refreshData()');
    expect(pluginRefresh).toContain('leaf.view instanceof AssetWidgetView');
  });

  it('switches gallery and inline edit without rebuilding the whole view', () => {
    const viewTab = sourceBetween('private renderViewTab', 'private syncViewModeUi');

    expect(viewTab).toContain('if (mode === this.viewMode)');
    expect(viewTab).toContain('this.syncViewModeUi()');
    expect(viewTab).not.toContain('this.render()');
  });

  it('reattaches the existing Bloub controller instead of rerolling on a full redraw', () => {
    const ledgerView = sourceBetween('class AssetLedgerView', 'class AssetWidgetView');
    const render = ledgerView.slice(
      ledgerView.indexOf('render(): void'),
      ledgerView.indexOf('private attachBloub'),
    );
    const attach = ledgerView.slice(
      ledgerView.indexOf('private attachBloub'),
      ledgerView.indexOf('private disposeBloubControllers'),
    );

    expect(ledgerView).toContain(
      'private readonly bloubControllers = new Map<string, BloubAvatarController>()',
    );
    expect(attach).toContain('let controller = this.bloubControllers.get(slot)');
    expect(attach).toContain('if (!controller)');
    expect(attach).toContain('this.plugin.createBloubController(slot, options)');
    expect(attach).toContain('this.bloubControllers.set(slot, controller)');
    expect(attach).toContain('controller.attach(host)');
    expect(render).not.toContain('this.disposeBloubControllers()');
    expect(render).not.toContain('this.plugin.rerollBloub(');
  });
});
