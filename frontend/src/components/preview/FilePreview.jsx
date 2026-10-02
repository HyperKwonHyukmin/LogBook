import { useEffect, useRef, useState } from 'react';
import { Copy, Download, FileWarning } from 'lucide-react';
import { api } from '../../api/client.js';
import { copyText, downloadFile, fileLink, uncPath } from '../../lib/files.js';
import { EXTRACT_LABELS, errorText, formatBytes } from '../../lib/labels.js';
import Button from '../ui/Button.jsx';
import { Bar } from '../ui/Skeleton.jsx';
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

const Skeleton = ({ className = 'h-40' }) => <div className="appear-late" aria-hidden="true"><Bar className={className} /></div>;
const LoadError = ({ error }) => (
  <p role="alert" className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-ui text-err">{error}</p>
);

/** 미리 볼 수 없을 때 — 사유 한 줄 + 내려받기. */
function Fallback({ children, file, canDownload = true }) {
  const [err, setErr] = useState('');
  return (
    <div className="flex flex-col items-center rounded-md bg-n-0 px-6 py-10 text-center shadow-sm">
      <FileWarning size={20} strokeWidth={1.75} className="text-n-400" aria-hidden="true" />
      <p className="mt-3 max-w-[440px] text-ui text-n-600">{children}</p>
      {canDownload && file && (
        <Button variant="secondary" size="sm" className="mt-4"
                onClick={async () => { setErr(''); try { await downloadFile(file); } catch (e) { setErr(errorText(e, '내려받지 못했습니다.')); } }}>
          <Download size={14} aria-hidden="true" />내려받아 열기
        </Button>
      )}
      {err && <p role="alert" className="mt-2 text-meta text-err">{err}</p>}
    </div>
  );
}

/** iframe 에는 우리 파일 주소만 넣는다(다른 스킴·출처가 섞여 들어오면 막는다). */
async function inlineLink(fileId) {
  const url = await fileLink(fileId, { inline: true });
  if (typeof url !== 'string' || !url.startsWith('/api/files/')) throw new Error('bad_link');
  return url;
}

/** 브라우저에 PDF 보기 기능이 꺼져 있으면(정책·헤드리스) iframe 이 빈 흰 상자가 된다 — 미리 알린다. */
const pdfViewerOff = () => typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === false;

function PdfView({ file }) {
  const off = pdfViewerOff();
  const { data: url, error } = useLoad(() => (off ? Promise.resolve(null) : inlineLink(file.id)), [file.id]);
  const [loaded, setLoaded] = useState(false);
  if (off) {
    return <Fallback file={file}>이 브라우저에서는 PDF 를 바로 미리 볼 수 없습니다. 내려받아 여세요.</Fallback>;
  }
  if (error) return <LoadError error={error} />;
  return (
    <div className="relative h-[70vh] min-h-[420px] overflow-hidden rounded-md bg-n-0 shadow-sm">
      {!loaded && (
        <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-n-0">
          <div className="animate-skeleton aspect-[1/1.414] h-[55%] rounded-sm bg-n-100" />
          <span className="text-meta text-n-500">PDF 여는 중…</span>
        </div>
      )}
      {url && (
        <iframe title="PDF 미리보기" src={url} onLoad={() => setLoaded(true)}
                className={`h-full w-full border-0 bg-n-0 transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0'}`} />
      )}
    </div>
  );
}

function SlidesView({ file }) {
  const { data, error } = useLoad(() => api(`/files/${file.id}/text`), [file.id]);
  if (error) return <LoadError error={error} />;
  if (!data) return <Skeleton className="aspect-[16/9] w-full" />;
  const titles = data.summary?.slide_titles || [];
  const slides = new Map();
  for (const c of data.chunks) {
    const [kind, n] = c.locator.split(':');
    if (kind !== 'slide' && kind !== 'notes') continue;
    const s = slides.get(n) || { n, body: '', notes: '' };
    if (kind === 'slide') s.body = c.text; else s.notes = c.text;
    slides.set(n, s);
  }
  if (slides.size === 0) return <Fallback file={file}>추출된 슬라이드 본문이 없습니다.</Fallback>;
  return (
    <ol className="flex flex-col gap-3">
      {[...slides.values()].map((s) => (
        <li key={s.n} className="rounded-md bg-n-0 p-4 text-ui shadow-sm">
          <h4 className="mb-1.5 flex items-baseline gap-2 text-meta font-semibold text-n-600">
            <span aria-hidden="true" className="font-mono font-normal text-n-500">{s.n}</span>{titles[Number(s.n) - 1] || `슬라이드 ${s.n}`}
          </h4>
          <p className="whitespace-pre-wrap text-n-800">{s.body}</p>
          {s.notes && <p className="mt-3 whitespace-pre-wrap border-t border-n-200 pt-2 text-meta text-n-500">{s.notes}</p>}
        </li>
      ))}
    </ol>
  );
}

function TextView({ file }) {
  const { data, error } = useLoad(() => api(`/files/${file.id}/text`), [file.id]);
  if (error) return <LoadError error={error} />;
  if (!data) return <Skeleton className="aspect-[1/1.414] w-full" />;
  const text = data.chunks.map((c) => c.text).join('\n\n');
  return text ? <div className="whitespace-pre-wrap rounded-md bg-n-0 p-5 text-ui text-n-800 shadow-sm">{text}</div>
    : <Fallback file={file}>추출된 본문이 없습니다.</Fallback>;
}

const NUMERIC = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][-+]?\d+)?%?$/;

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
    <div role="tablist" aria-label="시트" className="mb-3 flex h-9 flex-wrap items-stretch gap-x-5 border-b border-n-200">
      {sheets.map((s) => (
        <button key={s} type="button" role="tab" aria-selected={s === active} onClick={() => setPick({ id: file.id, name: s })}
                className={`-mb-px border-b-2 px-0.5 text-ui font-medium transition-colors duration-120 ease-out
                  ${s === active ? 'border-n-900 text-n-900' : 'border-transparent text-n-500 hover:text-n-900'}`}>
          {s}
        </button>
      ))}
    </div>
  );
  if (error) return <div>{tabs}<LoadError error={error} /></div>;
  if (!data) return <div>{tabs}<Skeleton className="h-60" /></div>;
  return (
    <div>
      {tabs}
      <div className="max-h-[65vh] overflow-auto rounded-md bg-n-0 shadow-sm">
        <table className="border-collapse text-meta">
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className={i === 0 ? 'bg-n-25 font-medium text-n-700' : 'text-n-800'}>
                <th scope="row" className="sticky left-0 border-b border-r border-n-200 bg-n-25 px-2 text-right font-mono font-normal text-n-500">{i + 1}</th>
                {row.map((v, j) => {
                  const num = typeof v === 'number' || (typeof v === 'string' && NUMERIC.test(v.trim()));
                  return (
                    <td key={j} className={`max-w-60 truncate border-b border-r border-n-200 px-2 py-1 ${num ? 'text-right font-mono' : ''}`}>{v}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.truncated && <p className="mt-2 text-meta text-n-500">앞 200행만 표시합니다. 전체는 내려받아 열어 주세요.</p>}
    </div>
  );
}

const VIEWS = { '.pdf': PdfView, '.pptx': SlidesView, '.docx': TextView, '.xlsx': SheetView, '.xlsm': SheetView };

/** 휴지통·경로 규칙(미리보기와 동작 단추가 같은 판단을 쓴다). */
export function fileState(file, { vaultUnc, trashed = false } = {}) {
  const inTrash = trashed || file.location === 'trash';
  return { inTrash, path: inTrash ? '' : uncPath(vaultUnc, file.rel_path) };
}

/** 내려받기·경로 복사 단추 + 결과 한 줄. showPath: 경로 끝부분을 옆에 보인다. */
export function FileActions({ file, vaultUnc, trashed = false, showPath = false, className = '' }) {
  const { inTrash, path } = fileState(file, { vaultUnc, trashed });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setStatus(''); setError(''); }, [file.id]);
  if (inTrash) return null;

  async function onDownload() {
    setError('');
    try { await downloadFile(file); } catch (err) { setError(errorText(err, '내려받지 못했습니다.')); }
  }
  async function onCopy() {
    setStatus((await copyText(path)) ? '경로를 복사했습니다.' : '복사하지 못했습니다. 경로를 직접 선택해 주세요.');
  }
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`}>
      <Button variant="secondary" size="sm" onClick={onDownload}><Download size={14} aria-hidden="true" />내려받기</Button>
      {path && <Button variant="secondary" size="sm" onClick={onCopy} title={path}><Copy size={14} aria-hidden="true" />경로 복사</Button>}
      {status && <span role="status" className="animate-fade text-meta text-n-600">{status}</span>}
      {error && <span role="alert" className="text-meta text-err">{error}</span>}
      {showPath && path && !status && !error && (
        <span dir="rtl" title={path} className="ml-auto min-w-0 flex-1 truncate text-left font-mono text-micro text-n-500">
          <bdi>{path}</bdi>
        </span>
      )}
    </div>
  );
}

/**
 * 파일 미리보기(설계 §6.3) — 형식별 본문. toolbar=true 면 위에 크기·동작 줄을 둔다
 * (파일 이름은 옆 파일 목록에 이미 있어 되풀이하지 않는다). hideTitles: 요약에서 뺄 제목들.
 */
export default function FilePreview({ file, vaultUnc, trashed = false, toolbar = true, hideTitles = [] }) {
  const ext = extOf(file.name);
  const notice = extractNotice(file.extract);
  // DRM 파일은 서버가 본문을 못 읽는다(시트 API 도 409). 미리보기 대신 사유와 내려받기만 보인다.
  const blocked = file.drm_encrypted || (file.extract?.state === 'skipped' && file.extract?.error === 'drm');
  // 휴지통의 파일은 서버가 내주지 않는다(404). 복원 전에는 미리보기·내려받기·경로 복사를 숨긴다.
  const { inTrash } = fileState(file, { vaultUnc, trashed });
  const View = !blocked && !inTrash && VIEWS[ext];

  return (
    <div className="flex flex-col gap-3">
      {toolbar && !inTrash && (
        <div className="flex min-h-7 items-center gap-3">
          <span className="shrink-0 font-mono text-meta text-n-500">{formatBytes(file.size)}</span>
          <FileActions file={file} vaultUnc={vaultUnc} trashed={trashed} className="ml-auto justify-end" />
        </div>
      )}
      {inTrash && <p className="rounded-md bg-n-100 px-3 py-2 text-ui text-n-700">{EXTRACT_LABELS.trashed}</p>}
      {notice && !inTrash && <p className="rounded-md border border-wait-line bg-wait-bg px-3 py-2 text-ui text-wait">{notice}</p>}
      {!inTrash && <SummaryCard summary={file.extract?.summary} hideTitles={hideTitles} />}
      {inTrash ? null : (
        <div className="rounded-lg bg-n-50 p-3">
          {View ? <View file={file} /> : (
            <Fallback file={file}>
              {blocked ? 'DRM 암호화 파일은 미리 볼 수 없습니다. 내려받아 열어 주세요.' : '이 형식은 미리보기를 지원하지 않습니다. 내려받아 열어 주세요.'}
            </Fallback>
          )}
        </div>
      )}
    </div>
  );
}
