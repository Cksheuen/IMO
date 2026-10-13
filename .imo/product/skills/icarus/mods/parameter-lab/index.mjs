// Declarative numeric experiments. No eval, dynamic code, network or world mutation.
const own = (object, key) => Object.hasOwn(object, key);
const finite = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite number');
  return value;
};

export function expression(node, values, depth = 0, budget = { left: 512 }) {
  if (depth > 24 || --budget.left < 0) throw new Error('Expression complexity limit exceeded');
  if (typeof node === 'number') return finite(node);
  if (typeof node === 'string') {
    if (!own(values, node)) throw new Error(`Unknown or forward reference: ${node}`);
    return finite(values[node]);
  }
  if (!Array.isArray(node) || node.length < 2 || node.length > 33) throw new Error('Invalid expression');
  const [op, ...args] = node;
  const xs = args.map(arg => expression(arg, values, depth + 1, budget));
  const arity = (n) => { if (xs.length !== n) throw new Error(`Invalid arity: ${op}`); };
  let result;
  switch (op) {
    case 'add': result = xs.reduce((a, b) => a + b, 0); break;
    case 'mul': result = xs.reduce((a, b) => a * b, 1); break;
    case 'min': result = Math.min(...xs); break;
    case 'max': result = Math.max(...xs); break;
    case 'sub': arity(2); result = xs[0] - xs[1]; break;
    case 'div': arity(2); if (xs[1] === 0) throw new Error('Division by zero'); result = xs[0] / xs[1]; break;
    case 'pow': arity(2); result = xs[0] ** xs[1]; break;
    case 'exp': arity(1); result = Math.exp(xs[0]); break;
    case 'abs': arity(1); result = Math.abs(xs[0]); break;
    default: throw new Error(`Unsupported operator: ${op}`);
  }
  return finite(result);
}

export function compute(config, overrides = {}) {
  if (config.schema !== 'icarus-parameter-lab/v1' || !Array.isArray(config.parameters) ||
      config.parameters.length > 24 || !Array.isArray(config.derived) || config.derived.length > 128 ||
      !Array.isArray(config.outputs) || config.outputs.length > 32) throw new Error('Invalid experiment schema');
  const values = Object.create(null);
  const reserve = (id) => {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(id) || own(values, id)) throw new Error('Invalid or duplicate value id');
  };
  for (const p of config.parameters) {
    reserve(p.id);
    finite(p.min); finite(p.max); finite(p.step);
    if (p.min > p.max || p.step <= 0) throw new Error('Invalid parameter bounds');
    const value = finite(own(overrides, p.id) ? overrides[p.id] : p.value);
    if (value < p.min || value > p.max) throw new Error(`Parameter out of range: ${p.id}`);
    values[p.id] = value;
  }
  for (const id of Object.keys(overrides)) if (!own(values, id)) throw new Error(`Unknown parameter: ${id}`);
  for (const d of config.derived) {
    reserve(d.id);
    values[d.id] = expression(d.expr, values);
  }
  for (const out of config.outputs) {
    if (!own(values, out.id)) throw new Error(`Unknown output: ${out.id}`);
    if (out.precision != null && (!Number.isInteger(out.precision) || out.precision < 0 || out.precision > 6)) throw new Error('Invalid precision');
  }
  return values;
}

const css = `.plab{font:15px/1.7 system-ui,sans-serif;color:#163f3d;padding:24px;border:1px solid #b9d5ce;border-radius:16px;background:#f1f8f4;margin:22px 0}.plab h3{font-size:23px;margin:0 0 8px}.plab p{margin:8px 0 18px}.plab .plab-presets{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.plab button{border:1px solid #97b9ad;background:white;color:#163f3d;padding:8px 12px;border-radius:8px;cursor:pointer;font:inherit}.plab button:hover{background:#dcefe4}.plab .plab-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px}.plab label{display:grid;gap:5px;font-size:13px}.plab label b{font-size:16px;font-variant-numeric:tabular-nums}.plab input{width:100%;accent-color:#28745d}.plab .plab-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}.plab .plab-result{background:#fff;padding:14px;border-radius:10px;border:1px solid #d6e6dd}.plab .plab-result span{display:block;font-size:12px}.plab .plab-result output{font-size:25px;font-weight:650;font-variant-numeric:tabular-nums}.plab small{display:block;font-size:12px;line-height:1.6;color:#55716b}.plab [role=alert]{color:#9b3333}.plab .plab-formula{white-space:pre-wrap;font:14px/1.8 ui-monospace,monospace;padding:12px;background:#e0eee5;border-radius:8px;overflow-wrap:anywhere}`;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export default {
  id: 'parameter-lab', apiVersion: 1, requires: [],
  mount({ root, signal, onCleanup }) {
    for (const target of root.querySelectorAll('[data-parameter-lab]')) {
      const source = target.querySelector('script[data-parameter-lab-config]');
      if (!source) throw new Error('Missing parameter-lab config');
      const config = JSON.parse(source.textContent);
      compute(config);
      for (const preset of config.presets ?? []) compute(config, preset.values);
      const panel = el('section', null, 'plab');
      panel.dataset.icarusMod = 'parameter-lab';
      panel.dataset.reviewTarget = target.id || config.id;
      panel.setAttribute('aria-label', config.title);
      target.append(panel);
      onCleanup(() => panel.remove());
      const fallback = target.querySelector('[data-parameter-lab-fallback]');
      if (fallback) {
        const before = fallback.hidden;
        fallback.hidden = true;
        onCleanup(() => { fallback.hidden = before; });
      }
      panel.append(el('style', css), el('h3', config.title), el('p', config.description));
      const presets = el('div', null, 'plab-presets');
      const controls = el('div', null, 'plab-controls');
      const results = el('div', null, 'plab-results');
      const error = el('p'); error.setAttribute('role', 'alert');
      panel.append(presets, controls, results, el('div', config.formula, 'plab-formula'), el('small', config.note), error);
      const fields = new Map();
      const outputs = new Map();
      for (const p of config.parameters) {
        const label = el('label'); const caption = el('span', p.label); const value = el('b');
        const input = el('input'); input.type = 'range'; input.min = p.min; input.max = p.max; input.step = p.step; input.value = p.value;
        input.setAttribute('aria-label', p.label);
        label.append(caption, value, input); controls.append(label);
        fields.set(p.id, { input, value, p });
      }
      for (const out of config.outputs) {
        const card = el('div', null, 'plab-result');
        const output = el('output'); output.dataset.valueId = out.id;
        card.append(el('span', out.label), output, el('small', out.unit || '无量纲'));
        results.append(card); outputs.set(out.id, { output, out });
      }
      const render = () => {
        try {
          const values = compute(config, Object.fromEntries([...fields].map(([id, field]) => [id, Number(field.input.value)])));
          for (const [id, { value, p }] of fields) value.textContent = `${values[id]} ${p.unit || ''}`;
          for (const [id, { output, out }] of outputs) output.textContent = values[id].toFixed(out.precision ?? 3);
          error.textContent = '';
        } catch (cause) {
          for (const { output } of outputs.values()) output.textContent = '—';
          error.textContent = `无法计算：${cause.message}`;
        }
      };
      for (const { input } of fields.values()) input.addEventListener('input', render, { signal });
      for (const preset of config.presets ?? []) {
        const button = el('button', preset.label); button.type = 'button';
        button.addEventListener('click', () => {
          for (const [id, field] of fields) field.input.value = own(preset.values, id) ? preset.values[id] : field.p.value;
          render();
        }, { signal });
        presets.append(button);
      }
      render();
    }
  },
};
