import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { test, expect } from './browser-fixtures';

let fixture: string, styles: string;
test.beforeAll(async () => {
  styles = await readFile('src/styles.css', 'utf8');
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
        import { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Select } from './src/components/Select';
        const initial = [
          {value:'all',label:'All disciplines'},
          {value:'archived',label:'Archived track',disabled:true},
          {value:'code',label:'Coding'},
          {value:'design',label:'System design'},
          {value:'behavioral',label:'Behavioral practice'},
          ...Array.from({length:25},(_,index)=>({value:'topic-'+index,label:'Topic '+index+' with a long descriptive name'})),
        ];
        function Fixture() {
          const [value,setValue]=useState('all'),[options,setOptions]=useState(initial);
          const [disabled,setDisabled]=useState(false),[submitted,setSubmitted]=useState('');
          return <main className="app" style={{padding:20,maxWidth:420}}>
            <form id="selection-form" style={{overflow:'hidden'}} onSubmit={event=>{
              event.preventDefault();setSubmitted(String(new FormData(event.currentTarget).get('track')));
            }}>
              <label>Focus track<Select aria-label="Focus track" name="track" value={value} options={options} disabled={disabled} onValueChange={setValue}/></label>
              <label>After selection<input required/></label>
              <button className="button">Save selection</button>
            </form>
            <button onClick={()=>setDisabled(current=>!current)}>Toggle disabled</button>
            <button onClick={()=>setOptions([{value:'design',label:'Updated system design'},{value:7,label:'Seven days'}])}>Replace options</button>
            <button onClick={()=>setOptions([])}>Clear options</button>
            <p data-testid="selected">{value}</p><p data-testid="submitted">{submitted}</p>
            <div style={{position:'fixed',bottom:8,right:8,width:160}}>
              <span id="bottom-label" className="sr-only">Bottom selection</span>
              <Select aria-labelledby="bottom-label" value={value} options={options} onValueChange={setValue}/>
            </div>
          </main>;
        }
        createRoot(document.getElementById('fixture')).render(<Fixture/>);
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  fixture = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<!doctype html><html><head></head><body><div id="fixture"></div></body></html>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: fixture });
});

test('keyboard selection preserves labels, skips disabled options and does not submit forms', async ({ page }) => {
  const control = page.getByRole('combobox', { name: 'Focus track', exact: true });
  await expect(control).toHaveText('All disciplines');
  await control.focus();
  await control.press('Space');
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('listbox')).toHaveAccessibleName('Focus track');
  await control.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Coding', exact: true })).toHaveAttribute('data-active', 'true');
  await expect(control).toHaveAttribute('aria-activedescendant', /-2$/);
  await expect(page.getByTestId('selected')).toHaveText('all');
  await control.press('Escape');
  await expect(control).toBeFocused();
  await expect(control).toHaveText('All disciplines');
  await control.press('s');
  await expect(control).toHaveText('System design');
  await control.press('ArrowDown');
  await control.press('Home');
  await control.press('Tab');
  await expect(page.getByLabel('After selection', { exact: true })).toBeFocused();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(control).toHaveText('All disciplines');
  await expect(page.getByTestId('submitted')).toHaveText('');
  await page.getByLabel('After selection', { exact: true }).fill('Ready');
  await page.getByRole('button', { name: 'Save selection' }).click();
  await expect(page.getByTestId('submitted')).toHaveText('all');
  await expect(page.locator('select')).toHaveCount(0);
});

test('portaled menus scroll the active option, flip at viewport edges and dismiss outside', async ({ page }) => {
  const control = page.getByRole('combobox', { name: 'Bottom selection', exact: true });
  await control.click();
  const popup = page.getByRole('listbox');
  await expect(popup).toHaveAccessibleName('Bottom selection');
  expect(await popup.evaluate(element => element.parentElement === document.body)).toBe(true);
  const menu = await popup.boundingBox(), button = await control.boundingBox();
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(button!.y);
  await control.press('End');
  const last = page.getByRole('option').last();
  const option = await last.boundingBox(), bounds = await popup.boundingBox();
  expect(option!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(option!.y + option!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
  await control.press('Enter');
  await expect(control).toContainText('Topic 24');
  await control.click();
  await page.setViewportSize({ width: 320, height: 640 });
  await expect.poll(async () => {
    const box = await popup.boundingBox();
    return box ? box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 : false;
  }).toBe(true);
  await page.getByLabel('After selection', { exact: true }).click();
  await expect(popup).toHaveCount(0);
  const topControl = page.getByRole('combobox', { name: 'Focus track', exact: true });
  await topControl.click();
  await page.evaluate(() => { document.body.style.minHeight = '2000px'; window.scrollTo(0, 600); });
  await expect(topControl).toHaveAttribute('aria-expanded', 'false');
  await expect(popup).toHaveCount(0);
});

test('disabled and changing options keep the controlled value honest', async ({ page }) => {
  const control = page.getByRole('combobox', { name: 'Focus track', exact: true });
  await control.click();
  await page.getByRole('option', { name: 'Archived track' }).click({ force: true });
  await expect(control).toHaveText('All disciplines');
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Toggle disabled' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(control).toBeDisabled();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle disabled' }).click();
  await page.getByRole('button', { name: 'Replace options' }).click();
  await expect(control).toHaveText('Select an option');
  await expect(page.getByTestId('selected')).toHaveText('all');
  await control.click();
  await page.getByRole('option', { name: 'Seven days' }).click();
  await expect(control).toHaveText('Seven days');
  await expect(page.getByTestId('selected')).toHaveText('7');
  await page.getByRole('button', { name: 'Clear options' }).click();
  await expect(control).toBeDisabled();
  await expect(control).toHaveText('No options available');
});

test('typeahead previews, repeated letters and upward navigation preserve selection rules', async ({ page }) => {
  await page.clock.install();
  const control = page.getByRole('combobox', { name: 'Focus track', exact: true });
  await control.focus();
  await control.press('s');
  await expect(control).toHaveText('System design');
  await control.press('ArrowDown');
  await control.press('t');
  await expect(page.getByRole('option', { name: 'Topic 0 with a long descriptive name', exact: true })).toHaveAttribute('data-active', 'true');
  await control.press('t');
  await expect(page.getByRole('option', { name: 'Topic 1 with a long descriptive name', exact: true })).toHaveAttribute('data-active', 'true');
  await expect(control).toHaveText('System design');
  await control.press('Escape');
  await control.press('t');
  await expect(control).toContainText('Topic 0');
  await page.clock.fastForward(750);
  await control.press('c');
  await expect(control).toHaveText('Coding');
  await control.press('ArrowUp');
  await control.press('ArrowUp');
  await expect(page.getByRole('option', { name: 'All disciplines', exact: true })).toHaveAttribute('data-active', 'true');
  await control.press('Alt+ArrowUp');
  await expect(control).toHaveText('All disciplines');
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('popup text and active options retain AA contrast in both themes', async ({ page }, testInfo) => {
  const control = page.getByRole('combobox', { name: 'Focus track', exact: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await control.click();
    const ratios = await page.getByRole('listbox').evaluate(popup => {
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
          const channel = Number(value) / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
      };
      const styles = [getComputedStyle(popup), getComputedStyle(popup.querySelector('[data-active="true"]')!)];
      return styles.map(style => {
        const a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
    });
    for (const ratio of ratios) expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath(`select-${theme}.png`) });
    await control.press('Escape');
  }
});

test.describe('touch selection', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 700 } });
  test('touch targets, long menus and forced colors remain usable', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    const control = page.getByRole('combobox', { name: 'Focus track', exact: true });
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await control.tap();
    const first = page.getByRole('option', { name: 'All disciplines', exact: true });
    expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const last = page.getByRole('option').last();
    await last.scrollIntoViewIfNeeded();
    await last.tap();
    await expect(control).toContainText('Topic 24');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
