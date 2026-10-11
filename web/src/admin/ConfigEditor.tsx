import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchNui, type AdminConfig, type Result } from '../nui';
import { makeT, type T } from '../i18n';
import { Brand, Icon } from '../fx';
import { ErrorLine, Toggle } from '../ui';
import { configureSound, play } from '../sound';

/* /bankconfig: an editor generated from the config's own shape. Booleans become toggles,
 * numbers and strings inputs, lists of rows tables, lists of values comma lists.
 * The server re-validates everything against config.lua before saving. */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const SECTIONS: [string, string[]][] = [
  ['general', ['bankName', 'accent', 'currency', 'locale']],
  ['features', ['features', 'sound']],
  ['cards', ['cards']],
  ['savings', ['savingsRates']],
  ['loans', ['loans']],
  ['accounts', ['accounts', 'business', 'receipts']],
  ['world', ['interaction', 'blips', 'atmModels', 'atmSpots', 'banks']],
  ['logs', ['logs']],
];

const clone = <V,>(v: V): V => JSON.parse(JSON.stringify(v));
const humanize = (k: string) => {
  const s = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s[0].toUpperCase() + s.slice(1);
};
const isObj = (v: Json): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

// Lua tables arrive in hash order; show plain fields first, then groups, then by name.
const COLUMNS = ['id', 'name', 'label', 'min', 'max', 'rate', 'adjust', 'x', 'y', 'z', 'heading'];
const byKind = (o: Obj) => (a: string, b: string) => Number(typeof o[a] === 'object') - Number(typeof o[b] === 'object') || a.localeCompare(b);
const byColumn = (a: string, b: string) => COLUMNS.indexOf(a) - COLUMNS.indexOf(b);

function setIn(root: Obj, path: (string | number)[], value: Json): Obj {
  const next = clone(root);
  let o: any = next;
  path.slice(0, -1).forEach((k) => (o = o[k]));
  o[path[path.length - 1]] = value;
  return next;
}

export function ConfigEditor({ data, setData, onClose }: { data: AdminConfig; setData: (d: AdminConfig) => void; onClose: () => void }) {
  const t = useMemo(() => makeT(data.ui), [data.ui]);
  const [draft, setDraft] = useState<Obj>(() => clone(data.values) as Obj);
  const [section, setSection] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.values);

  const label = (k: string) => (t('cfg_' + k) !== 'cfg_' + k ? t('cfg_' + k) : humanize(k));
  const hint = (k: string) => (t('cfg_hint_' + k) !== 'cfg_hint_' + k ? t('cfg_hint_' + k) : '');
  const update = (path: (string | number)[], v: Json) => {
    setDraft((d) => setIn(d, path, v));
    setSaved(false);
  };

  // Sound settings apply while editing, with a tick, so the admin hears the new volume.
  const sound = JSON.stringify(draft.sound);
  const first = useRef(true);
  useEffect(() => {
    configureSound(JSON.parse(sound));
    if (!first.current) play('tap');
    first.current = false;
  }, [sound]);

  const send = async (event: 'adminConfigSave' | 'adminConfigReset', payload?: unknown) => {
    setBusy(true);
    setError('');
    const r = await fetchNui<Result<AdminConfig>>(event, payload).catch(() => ({ ok: false as const, error: t('cfg_failed') }));
    setBusy(false);
    setConfirmReset(false);
    if (!r.ok) {
      setError(r.error);
      return play('error');
    }
    setData(r.data);
    setDraft(clone(r.data.values) as Obj);
    setSaved(true);
    play('chime');
  };

  const ctx: FieldCtx = { t, label, hint, update, defaults: data.defaults as Obj };
  const [id, keys] = SECTIONS[section];

  return (
    <div className="bank cfg">
      <header className="hud hud-top">
        <Brand name={String(draft.bankName || 'Bank')} suffix={t('cfg_title')} />
        <div className="mono muted" data-hud>
          {dirty ? t('cfg_unsaved') : saved ? t('cfg_saved') : ''}
        </div>
        <button className="mono esc" onClick={onClose} data-hud>
          <kbd>Esc</kbd> {t('close')}
        </button>
      </header>

      <div className="cfg-stage" data-stage>
        <div className="panel cfg-panel">
          <nav className="cfg-nav" aria-label={t('cfg_title')}>
            {SECTIONS.map(([s], i) => (
              <button key={s} className="cfg-tab" aria-current={i === section ? 'page' : undefined} onClick={() => setSection(i)}>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span> {t('cfg_section_' + s)}
              </button>
            ))}
            <div className="cfg-actions">
              <ErrorLine error={error} />
              <button className="btn btn-primary btn-block" disabled={!dirty || busy} aria-busy={busy} onClick={() => send('adminConfigSave', draft)}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="check" />} {t('cfg_save')}
              </button>
              {dirty && (
                <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setDraft(clone(data.values) as Obj)}>
                  {t('cfg_discard')}
                </button>
              )}
              <button
                className={`btn btn-ghost btn-block ${confirmReset ? 'is-danger' : ''}`}
                disabled={busy}
                onClick={() => (confirmReset ? send('adminConfigReset') : setConfirmReset(true))}
                onBlur={() => setConfirmReset(false)}
              >
                {t(confirmReset ? 'cfg_reset_confirm' : 'cfg_reset')}
              </button>
            </div>
          </nav>

          <div className="cfg-body" key={id}>
            <h2 className="cfg-heading">{t('cfg_section_' + id)}</h2>
            {hint('section_' + id) && <p className="muted cfg-wide">{hint('section_' + id)}</p>}
            {fields(keys, draft, data.defaults as Obj).map(({ name, path, value, template }) => (
              <Field key={path.join('.')} ctx={ctx} name={name} path={path} value={value} template={template} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A section's top-level fields; a section that is one group (Cards, Loans) shows its insides directly. */
function fields(keys: string[], draft: Obj, defaults: Obj) {
  const only = draft[keys[0]];
  if (keys.length === 1 && isObj(only)) {
    const tpl = defaults[keys[0]] as Obj;
    return Object.keys(only)
      .sort(byKind(only))
      .map((k) => ({ name: k, path: [keys[0], k], value: only[k], template: tpl?.[k] }));
  }
  return keys.map((k) => ({ name: k, path: [k], value: draft[k], template: defaults[k] }));
}

interface FieldCtx {
  t: T;
  label: (k: string) => string;
  hint: (k: string) => string;
  update: (path: (string | number)[], v: Json) => void;
  defaults: Obj;
}

function Field({ ctx, name, path, value, template }: { ctx: FieldCtx; name: string; path: (string | number)[]; value: Json; template: Json }) {
  const { label, hint, update } = ctx;
  const h = hint(name);

  if (isObj(value)) {
    return (
      <fieldset className="cfg-group">
        <legend className="mono muted">{label(name)}</legend>
        {h && <p className="muted small">{h}</p>}
        <div className="cfg-grid">
          {Object.keys(value).sort(byKind(value)).map((k) => (
            <Field key={k} ctx={ctx} name={k} path={[...path, k]} value={value[k]} template={isObj(template) ? template[k] : value[k]} />
          ))}
        </div>
      </fieldset>
    );
  }

  if (Array.isArray(value)) {
    const row = (Array.isArray(template) && template[0]) ?? value[0];
    if (isObj(row)) return <RowTable ctx={ctx} name={name} path={path} rows={value as Obj[]} row={row} />;
    return <ListField ctx={ctx} name={name} path={path} value={value} numeric={typeof row === 'number'} />;
  }

  if (typeof value === 'boolean') {
    return (
      <div className="cfg-field cfg-toggle">
        <Toggle checked={value} label={label(name)} onChange={(v) => update(path, v)} />
        {h && <span className="muted small">{h}</span>}
      </div>
    );
  }

  return (
    <label className="cfg-field">
      <span className="mono muted">{label(name)}</span>
      <span className="cfg-input">
        {(name === 'accent' || name === 'cardColor') && <input type="color" className="cfg-color" value={String(value)} onChange={(e) => update(path, e.target.value)} aria-label={label(name)} />}
        {name === 'volume' && typeof value === 'number' ? (
          <input type="range" className="range" min={0} max={1} step={0.05} value={value} aria-label={label(name)} onChange={(e) => update(path, Number(e.target.value))} />
        ) : (
          <ScalarInput value={value} onChange={(v) => update(path, v)} />
        )}
      </span>
      {h && <span className="muted small">{h}</span>}
    </label>
  );
}

function ScalarInput({ value, onChange, label }: { value: Json; onChange: (v: Json) => void; label?: string }) {
  if (typeof value === 'number') {
    return <input className="input" type="number" step="any" value={value} aria-label={label} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />;
  }
  if (typeof value === 'boolean') {
    return <input type="checkbox" className="cfg-check" checked={value} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
  }
  return <input className="input" value={String(value ?? '')} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
}

/** Lists of plain values (ATM models, loan terms) as one comma separated input. */
function ListField({ ctx, name, path, value, numeric }: { ctx: FieldCtx; name: string; path: (string | number)[]; value: Json[]; numeric: boolean }) {
  const [text, setText] = useState(value.join(', '));
  const commit = () => {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    ctx.update(path, numeric ? parts.map(Number).filter((n) => !Number.isNaN(n)) : parts);
  };
  return (
    <label className="cfg-field cfg-wide">
      <span className="mono muted">{ctx.label(name)}</span>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      <span className="muted small">{ctx.hint(name) || ctx.t('cfg_list_hint')}</span>
    </label>
  );
}

/** Lists of rows (loan plans, credit bands, bank locations) as an editable table. */
function RowTable({ ctx, name, path, rows, row }: { ctx: FieldCtx; name: string; path: (string | number)[]; rows: Obj[]; row: Obj }) {
  const { t, label, update } = ctx;
  const cols = Object.keys(row).sort(byColumn);
  const add = (r: Obj) => update(path, [...rows, r]);
  const here = async () => {
    const pos = await fetchNui<Obj>('adminHere').catch(() => null);
    if (!pos) return;
    const next: Obj = { ...clone(row) };
    for (const k of Object.keys(next)) if (k in pos) next[k] = pos[k];
    if ('label' in next) next.label = t('cfg_new_bank');
    add(next);
  };
  return (
    <fieldset className="cfg-group cfg-wide">
      <legend className="mono muted">{label(name)}</legend>
      {ctx.hint(name) && <p className="muted small">{ctx.hint(name)}</p>}
      <table className="cfg-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} className="mono muted">
                {label(c)}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>
                  <ScalarInput value={r[c] ?? row[c]} label={`${label(c)} ${i + 1}`} onChange={(v) => update([...path, i, c], v)} />
                </td>
              ))}
              <td>
                <button className="icon-btn" aria-label={t('remove_name', { name: String(r.label ?? r.name ?? r.id ?? i + 1) })} onClick={() => update(path, rows.filter((_, j) => j !== i))}>
                  <Icon name="trash" size={1} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cfg-row-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => add(clone(rows[rows.length - 1] ?? row))}>
          <Icon name="plus" size={1} /> {t('cfg_add_row')}
        </button>
        {(name === 'banks' || name === 'atmSpots') && (
          <button className="btn btn-ghost btn-sm" onClick={here}>
            <Icon name={name === 'banks' ? 'bank' : 'card'} size={1} /> {t('cfg_add_here_' + name)}
          </button>
        )}
      </div>
    </fieldset>
  );
}
