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

/** 화면 캡처 — 2배 해상도로 찍어 두었다. 누르면 새 탭에서 원래 크기로(좁은 칸에서 글자가 작을 때). */
function Figure({ img, className = 'mt-3' }) {
  const src = noteImageSrc(img.src);
  // 2배로 찍은 캡처를 화면 크기 그대로(절반 폭) — 작은 캡처가 칸 폭만큼 늘어나 흐려지지 않게, 큰 캡처는 칸에 맞춰 줄인다
  const [w, setW] = useState(null);
  return (
    <figure className={className}>
      <a href={src} target="_blank" rel="noreferrer" title="원래 크기로 보기"
         className="inline-block max-w-full cursor-zoom-in overflow-hidden rounded-md border border-n-200 bg-n-50 align-top transition-colors duration-150 ease-out hover:border-n-300">
        <img src={src} alt={img.alt || ''} loading="lazy" onLoad={(e) => setW(Math.round(e.currentTarget.naturalWidth / 2))}
             style={w ? { width: w } : undefined} className="block h-auto max-w-full" />
      </a>
      {img.caption && <figcaption className="mt-1.5 text-meta leading-5 text-n-600">{img.caption}</figcaption>}
    </figure>
  );
}

const stepText = (s) => (typeof s === 'string' ? s : s.text);

function Section({ s }) {
  const images = [...(s.image ? [s.image] : []), ...(s.images || [])];
  return (
    <section className="mt-9 first:mt-7">
      {s.heading && <h3 className="text-body font-semibold text-n-900">{s.heading}</h3>}
      {(s.body || []).map((p) => <p key={p} className="mt-2 text-body text-n-700">{p}</p>)}
      {s.steps?.length > 0 && (
        <ol className="mt-3 flex flex-col gap-4">
          {s.steps.map((st, i) => (
            <li key={stepText(st)} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5">
              <span aria-hidden="true" className="mt-px inline-flex h-6 w-6 items-center justify-center rounded-full bg-n-100 font-mono text-meta font-medium text-n-700">{i + 1}</span>
              <div className="min-w-0">
                <p className="pt-px text-body text-n-800"><span className="sr-only">{i + 1}. </span>{stepText(st)}</p>
                {typeof st === 'object' && st.image && <Figure img={st.image} className="mt-2" />}
              </div>
            </li>
          ))}
        </ol>
      )}
      {images.map((img) => <Figure key={img.src} img={img} />)}
      {s.facts?.length > 0 && (
        <dl className="mt-3 grid grid-cols-[minmax(112px,max-content)_minmax(0,1fr)] gap-x-5 gap-y-2.5 border-y border-n-200 py-3 text-body max-[640px]:grid-cols-1 max-[640px]:gap-y-0.5">
          {s.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="font-medium text-n-800 max-[640px]:mt-2">{f.label}</dt>
              <dd className="text-n-700">{f.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {s.points?.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-body text-n-700 marker:text-n-400">
          {s.points.map((t) => <li key={t} className="mt-1.5 first:mt-0">{t}</li>)}
        </ul>
      )}
      {s.note && <p className="mt-3 rounded-md bg-n-50 px-3 py-2 text-ui text-n-700">{s.note}</p>}
    </section>
  );
}

/** 안내 한 건 — 머리(날짜, 분류, 제목, 무엇이 좋아졌나, 화면 열기와 링크 복사)와 구획. */
export default function NoteArticle({ note }) {
  return (
    <article aria-labelledby="note-title" className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-meta text-n-500">
        <span className="font-mono">{note.date}</span>
        <KindBadge kind={note.kind} />
      </div>
      <h2 id="note-title" className="mt-1.5 text-title font-semibold tracking-[-0.018em] text-n-900 [text-wrap:balance]">{note.title}</h2>
      {note.summary && <p className="mt-2 text-body text-n-700">{note.summary}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
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
