import { Link } from 'react-router-dom';
import { ArrowUpRight, Link2 } from 'lucide-react';
import { useState } from 'react';
import { buttonClass } from '../ui/Button.jsx';
import { copyText } from '../../lib/files.js';
import { noteImageSrc, noteUrl } from '../../lib/updateNotes.js';

/** 70 — 안내 분류 칩. */
export function KindBadge({ kind }) {
  if (!kind) return null;
  const tone = kind === '새 기능' ? 'bg-brand-subtle text-brand' : 'bg-n-100 text-n-700';
  return <span className={`inline-flex h-[18px] shrink-0 items-center rounded-xs px-1.5 text-micro font-medium ${tone}`}>{kind}</span>;
}

/** 공유 주소 복사 단추 — 사내 http 주소는 clipboard API 가 막혀 있을 수 있어 실패하면 주소를 직접 쓰라고 알린다. */
export function CopyLinkButton({ id, label = '링크 복사', className = '' }) {
  const [msg, setMsg] = useState('');
  async function onClick() {
    const ok = await copyText(noteUrl(id));
    setMsg(ok ? '복사됨' : '주소 표시줄의 주소를 쓰세요');
    setTimeout(() => setMsg(''), 1800);
  }
  return (
    <button type="button" onClick={onClick} title={noteUrl(id)} className={buttonClass('secondary', 'sm', className)}>
      <Link2 size={14} aria-hidden="true" />{msg || label}
    </button>
  );
}

function Figure({ img }) {
  return (
    <figure className="mt-3">
      <img src={noteImageSrc(img.src)} alt={img.alt || ''} loading="lazy"
           className="w-full rounded-md border border-n-200 bg-n-50" />
      {img.caption && <figcaption className="mt-1.5 text-meta text-n-600">{img.caption}</figcaption>}
    </figure>
  );
}

function Section({ s }) {
  const images = [...(s.image ? [s.image] : []), ...(s.images || [])];
  return (
    <section className="mt-8 first:mt-6">
      {s.heading && <h3 className="text-body font-semibold text-n-900">{s.heading}</h3>}
      {(s.body || []).map((p) => <p key={p} className="mt-2 text-ui leading-6 text-n-700">{p}</p>)}
      {s.facts?.length > 0 && (
        <dl className="mt-3 grid grid-cols-[minmax(120px,max-content)_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-n-200 py-3 text-ui max-[640px]:grid-cols-1 max-[640px]:gap-y-0.5">
          {s.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="font-medium text-n-800 max-[640px]:mt-2">{f.label}</dt>
              <dd className="text-n-700">{f.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {s.steps?.length > 0 && (
        <ol className="mt-2 list-decimal pl-5 text-ui leading-6 text-n-700 marker:font-mono marker:text-meta marker:text-n-500">
          {s.steps.map((t) => <li key={t} className="mt-1 pl-1 first:mt-0">{t}</li>)}
        </ol>
      )}
      {s.points?.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-ui leading-6 text-n-700 marker:text-n-400">
          {s.points.map((t) => <li key={t} className="mt-1 first:mt-0">{t}</li>)}
        </ul>
      )}
      {images.map((img) => <Figure key={img.src} img={img} />)}
      {s.note && <p className="mt-3 border-l-2 border-n-300 bg-n-0 py-1.5 pl-3 pr-2 text-meta leading-5 text-n-700">{s.note}</p>}
    </section>
  );
}

/** 안내 한 건 — 머리(날짜, 분류, 제목, 요약, 화면 열기와 링크 복사)와 구획. */
export default function NoteArticle({ note }) {
  return (
    <article aria-labelledby="note-title" className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-meta text-n-500">
        <span className="font-mono">{note.date}</span>
        <KindBadge kind={note.kind} />
      </div>
      <h2 id="note-title" className="mt-1.5 text-[20px] leading-7 font-semibold tracking-[-0.01em] text-n-900 [text-wrap:balance]">{note.title}</h2>
      {note.summary && <p className="mt-2 text-ui leading-6 text-n-700">{note.summary}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(note.links || []).map((l) => (
          <Link key={l.path} to={l.path} className={buttonClass('primary', 'sm')}>
            {l.label} 열기<ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        ))}
        <CopyLinkButton id={note.id} />
      </div>
      {(note.sections || []).map((s, i) => <Section key={s.heading || i} s={s} />)}
    </article>
  );
}
