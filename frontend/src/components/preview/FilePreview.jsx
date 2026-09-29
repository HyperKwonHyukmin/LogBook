import { useEffect, useRef, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { api } from '../../api/client.js';
import { copyText, downloadFile, fileLink, uncPath } from '../../lib/files.js';
import { EXTRACT_LABELS, errorText, formatBytes } from '../../lib/labels.js';
import Button from '../ui/Button.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import SummaryCard from './SummaryCard.jsx';

const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
};

function extractNotice(x) {
  if (!x || x.state === 'done') return '';
  if (x.state === 'skipped') return EXTRACT_LABELS[x.error] || '';
  return EXTRACT_LABELS[x.state] || '';
}

/** 요청 번호로 늦게 온 옛 응답을 버리는 비동기 불러오기. */
function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: '' });
  const idRef = useRef(0);
  useEffect(() => {
    const id = ++idRef.current;
    setState({ data: null, error: '' });
    load().then((data) => { if (id === idRef.current) setState({ data, error: '' }); })
      .catch((err) => { if (id === idRef.current) setState({ data: null, error: errorText(err, '미리보기를 불러오지 못했습니다.') }); });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

const Skeleton = ({ className = 'h-40' }) => <div className={`${className} animate-pulse rounded-lg bg-zinc-100`} />;
const LoadError = ({ error }) => <p role="alert" className="text-[13px] text-err">{error}</p>;

/** iframe 에는 우리 파일 주소만 넣는다(다른 스킴·출처가 섞여 들어오면 막는다). */
async function inlineLink(fileId) {
  const url = await fileLink(fileId, { inline: true });
  if (typeof url !== 'string' || !url.startsWith('/api/files/')) throw new Error('bad_link');
  return url;
}

function PdfView({ file }) {
  const { data: url, error } = useLoad(() => inlineLink(file.id), [file.id]);
  if (error) return <LoadError error={error} />;
  if (!url) return <Skeleton className="h-[70vh]" />;
  return <iframe title="PDF 미리보기" src={url} className="h-[70vh] w-full rounded-lg border border-line bg-white" />;
}

function SlidesView({ file }) {
  const { data, error } = useLoad(() => api(`/files/${file.id}/text`), [file.id]);
  if (error) return <LoadError error={error} />;
  if (!data) return <Skeleton />;
  const titles = data.summary?.slide_titles || [];
  const slides = new Map();
  for (const c of data.chunks) {
    const [kind, n] = c.locator.split(':');
    if (kind !== 'slide' && kind !== 'notes') continue;
    const s = slides.get(n) || { n, body: '', notes: '' };
    if (kind === 'slide') s.body = c.text; else s.notes = c.text;
    slides.set(n, s);
  }
  if (slides.size === 0) return <p className="text-[13px] text-zinc-500">추출된 슬라이드 본문이 없습니다.</p>;
  return (
    <ol className="space-y-2">
      {[...slides.values()].map((s) => (
        <li key={s.n} className="rounded-lg border border-line bg-white p-3 text-[13px]">
          <h4 className="mb-1 text-xs font-semibold text-zinc-500">
            <span aria-hidden="true" className="mr-2 font-mono">{s.n}</span>{titles[Number(s.n) - 1] || `슬라이드 ${s.n}`}
          </h4>
          <p className="whitespace-pre-wrap text-zinc-800">{s.body}</p>
          {s.notes && <p className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-xs text-zinc-500">{s.notes}</p>}
        </li>
      ))}
    </ol>
  );
}

function TextView({ file }) {
  const { data, error } = useLoad(() => api(`/files/${file.id}/text`), [file.id]);
  if (error) return <LoadError error={error} />;
  if (!data) return <Skeleton />;
  const text = data.chunks.map((c) => c.text).join('\n\n');
  return text ? <div className="whitespace-pre-wrap rounded-lg border border-line bg-white p-4 text-[13px] text-zinc-800">{text}</div>
    : <p className="text-[13px] text-zinc-500">추출된 본문이 없습니다.</p>;
}

function SheetView({ file }) {
  // 고른 시트는 파일 번호와 함께 둔다 — 파일이 바뀌면 따로 되돌리지 않아도 첫 시트로 돌아간다.
  const [pick, setPick] = useState({ id: file.id, name: null });
  const name = pick.id === file.id ? pick.name : null;
  const { data, error } = useLoad(
    () => api(`/files/${file.id}/sheet${name ? `?name=${encodeURIComponent(name)}` : ''}`), [file.id, name]);
  // 마지막으로 받은 시트 목록 — 다른 시트를 불러오는 중이거나 실패해도 탭을 남겨 다시 고를 수 있게 한다.
  const [known, setKnown] = useState(null);
  useEffect(() => { if (data) setKnown({ id: file.id, sheets: data.sheets }); }, [data, file.id]);
  const sheets = data?.sheets || (known?.id === file.id ? known.sheets : null);
  const active = data?.name ?? name;
  const tabs = sheets && (
    <div role="tablist" aria-label="시트" className="mb-2 flex flex-wrap gap-1">
      {sheets.map((s) => (
        <button key={s} type="button" role="tab" aria-selected={s === active} onClick={() => setPick({ id: file.id, name: s })}
                className={`h-7 rounded-md px-2.5 text-xs ${s === active ? 'bg-brand-tint font-semibold text-brand' : 'text-zinc-600 hover:bg-zinc-100'}`}>
          {s}
        </button>
      ))}
    </div>
  );
  if (error) return <div>{tabs}<LoadError error={error} /></div>;
  if (!data) return <div>{tabs}<Skeleton /></div>;
  return (
    <div>
      {tabs}
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-line bg-white">
        <table className="border-collapse font-mono text-xs">
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className={i === 0 ? 'bg-zinc-50 font-semibold' : ''}>
                <th scope="row" className="sticky left-0 border-b border-r border-line bg-zinc-50 px-2 text-right font-normal text-zinc-400">{i + 1}</th>
                {row.map((v, j) => <td key={j} className="max-w-60 truncate border-b border-r border-line px-2 py-1">{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.truncated && <p className="mt-1 text-xs text-zinc-500">앞 200행만 표시합니다. 전체는 내려받아 열어 주세요.</p>}
    </div>
  );
}

const VIEWS = { '.pdf': PdfView, '.pptx': SlidesView, '.docx': TextView, '.xlsx': SheetView, '.xlsm': SheetView };

/** 파일 미리보기(설계 §6.3) — 형식별 본문 + 내려받기·경로 복사. */
export default function FilePreview({ file, vaultUnc, trashed = false }) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setStatus(''); setError(''); }, [file.id]);
  const ext = extOf(file.name);
  const notice = extractNotice(file.extract);
  // DRM 파일은 서버가 본문을 못 읽는다(시트 API 도 409) — 미리보기 대신 사유와 내려받기만 보인다.
  const blocked = file.drm_encrypted || (file.extract?.state === 'skipped' && file.extract?.error === 'drm');
  // 휴지통의 파일은 서버가 내주지 않는다(404) — 복원 전에는 미리보기·내려받기·경로 복사를 숨긴다.
  const inTrash = trashed || file.location === 'trash';
  const View = !blocked && !inTrash && VIEWS[ext];
  const path = inTrash ? '' : uncPath(vaultUnc, file.rel_path);

  async function onDownload() {
    setError('');
    try { await downloadFile(file); } catch (err) { setError(errorText(err, '내려받지 못했습니다.')); }
  }
  async function onCopy() {
    setStatus((await copyText(path)) ? '경로를 복사했습니다.' : '복사하지 못했습니다. 경로를 직접 선택해 주세요.');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <KindBadge kind={file.kind} name={file.name} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={file.rel_path}>{file.name}</span>
        <span className="font-mono text-xs text-zinc-500">{formatBytes(file.size)}</span>
        {!inTrash && <Button variant="secondary" size="sm" onClick={onDownload}><Download size={13} aria-hidden="true" />내려받기</Button>}
        {path && <Button variant="secondary" size="sm" onClick={onCopy} title={path}><Copy size={13} aria-hidden="true" />경로 복사</Button>}
      </div>
      {status && <p role="status" className="text-xs text-ok">{status}</p>}
      {error && <p role="alert" className="text-xs text-err">{error}</p>}
      {inTrash && <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700">{EXTRACT_LABELS.trashed}</p>}
      {notice && !inTrash && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-wait">{notice}</p>}
      {!inTrash && <SummaryCard summary={file.extract?.summary} />}
      {inTrash ? null : View ? <View file={file} /> : (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-[13px] text-zinc-500">
          {blocked ? 'DRM 암호화 파일은 미리 볼 수 없습니다. 내려받아 열어 주세요.' : '이 형식은 미리보기를 지원하지 않습니다. 내려받아 열어 주세요.'}
        </p>
      )}
    </div>
  );
}
