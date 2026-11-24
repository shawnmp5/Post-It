import { Fragment, useMemo } from 'react';
import { parseBody } from '../blocks.js';

/** Wrap occurrences of `query` in <mark> so search hits are visible on the wall. */
export function highlight(text, query) {
  if (!query || !text) return text;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const out = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const j = lower.indexOf(q, i);
    if (j < 0) break;
    if (j > i) out.push(text.slice(i, j));
    out.push(<mark key={k++}>{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

/**
 * Read-only, formatted view of a note body. Every text-bearing element carries
 * `data-offset` (its position in the raw text) so a click can put the caret
 * in the right place when the note switches to editing.
 */
export function NoteBody({ body, images, query, onToggleCheck }) {
  const blocks = useMemo(() => parseBody(body), [body]);

  // Group consecutive list items so they render as one list.
  const groups = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (['bullet', 'number', 'check'].includes(b.type) && last?.type === `${b.type}-list`) last.items.push(b);
    else if (['bullet', 'number', 'check'].includes(b.type)) groups.push({ type: `${b.type}-list`, items: [b], offset: b.offset });
    else groups.push(b);
  }

  const T = (b) => highlight(b.text, query);

  return groups.map((g) => {
    const key = `${g.type}-${g.offset}`;
    switch (g.type) {
      case 'h1':
      case 'h2':
      case 'h3':
        return (
          <div key={key} className={`nb-${g.type}`} data-offset={g.offset}>
            {T(g) || ' '}
          </div>
        );
      case 'bullet-list':
        return (
          <ul key={key} className="nb-ul">
            {g.items.map((b) => (
              <li key={b.offset} data-offset={b.offset}>
                {T(b)}
              </li>
            ))}
          </ul>
        );
      case 'number-list':
        return (
          <ol key={key} className="nb-ol" start={g.items[0].n}>
            {g.items.map((b) => (
              <li key={b.offset} data-offset={b.offset} value={b.n}>
                {T(b)}
              </li>
            ))}
          </ol>
        );
      case 'check-list':
        return (
          <ul key={key} className="nb-checks">
            {g.items.map((b) => (
              <li key={b.offset} className={b.checked ? 'is-done' : ''}>
                <button
                  type="button"
                  className="nb-box"
                  role="checkbox"
                  aria-checked={b.checked}
                  aria-label={b.checked ? 'Mark as not done' : 'Mark as done'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCheck(b.mark);
                  }}
                />
                <span data-offset={b.offset}>{T(b)}</span>
              </li>
            ))}
          </ul>
        );
      case 'quote':
        return (
          <blockquote key={key} className="nb-quote" data-offset={g.offset}>
            {T(g) || ' '}
          </blockquote>
        );
      case 'hr':
        return <hr key={key} className="nb-hr" data-offset={g.offset} />;
      case 'code':
        return (
          <pre key={key} className="nb-code" data-offset={g.offset}>
            {highlight(g.text, query) || ' '}
          </pre>
        );
      case 'table':
        return (
          <div key={key} className="nb-table-wrap" data-offset={g.offset}>
            <table className="nb-table">
              <thead>
                <tr>
                  {g.header.map((c, i) => (
                    <th key={i}>{highlight(c, query)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, ri) => (
                  <tr key={ri}>
                    {g.header.map((_, ci) => (
                      <td key={ci}>{highlight(r[ci] ?? '', query)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'image': {
        const src = g.src.startsWith('img:') ? images?.[g.src.slice(4)] : /^(https?:|data:image\/)/.test(g.src) ? g.src : null;
        return src ? (
          <img key={key} className="nb-img" src={src} alt={g.alt} draggable={false} data-offset={g.offset} />
        ) : (
          <div key={key} className="nb-img-missing" data-offset={g.offset}>
            Image not found
          </div>
        );
      }
      default:
        return (
          <Fragment key={key}>
            <div className="nb-p" data-offset={g.offset}>
              {g.text ? T(g) : <br />}
            </div>
          </Fragment>
        );
    }
  });
}
