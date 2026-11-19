import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Pencil, Plus } from 'lucide-react';
import { api } from '../../api/client.js';
import { errorText, formatDateTime } from '../../lib/labels.js';
import { renderMarkdown } from '../../lib/markdown.js';
import Button from '../ui/Button.jsx';
import { SectionTitle } from '../ui/Page.jsx';

/**
 * 64 — 자료 화면의 '나의 메모'(개인 지식 노트, 나만 본다). 마크다운으로 쓰고 보기에서는 변환해 보인다.
 * 저장: [저장] 단추, Ctrl+Enter(맥은 Cmd+Enter), 편집 칸을 벗어날 때(단추를 누르러 가는 것은 벗어남이 아니다).
 * 셋 다 저장 뒤 보기로 돌아간다. [취소]는 고친 것을 버린다. 화면을 떠날 때 저장 안 한 글이 있으면 저장한다.
 * 빈 본문을 저장하면 메모를 지운다(서버). 모아 보기는 왼쪽 메뉴 '나의 메모'(/notes).
 */
export default function EntryNote({ entryId }) {
  const [note, setNote] = useState(null);          // {body, updated_at} | null(불러오는 중)
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const boxRef = useRef(null);
  const areaRef = useRef(null);
  const pending = useRef(null);                    // 화면을 떠날 때 저장할 글(편집 중이고 바뀌었을 때만)

  useEffect(() => {
    let live = true;
    setNote(null); setEditing(false); setError('');
    api(`/entries/${entryId}/note`)
      .then((n) => { if (live) setNote(n); })
      .catch(() => { if (live) setNote({ body: '', updated_at: null }); });
    return () => { live = false; };
  }, [entryId]);

  // 편집 중 바뀐 글은 화면을 떠날 때도 저장한다(칸을 벗어나지 않고 다른 메뉴를 누른 경우)
  useEffect(() => {
    pending.current = editing && note && draft.trim() !== (note.body || '') ? draft : null;
  }, [editing, draft, note]);
  useEffect(() => () => {
    if (pending.current !== null) {
      api(`/entries/${entryId}/note`, { method: 'PUT', body: { body: pending.current } }).catch(() => {});
    }
  }, [entryId]);

  useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [saved]);

  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  function open() {
    setDraft(note?.body || '');
    setError('');
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    if (draft.trim() === (note?.body || '')) { setEditing(false); return; }   // 바뀐 것이 없으면 닫기만
    setSaving(true); setError('');
    try {
      const n = await api(`/entries/${entryId}/note`, { method: 'PUT', body: { body: draft } });
      setNote(n); setEditing(false); setSaved(true);
    } catch (err) {
      setError(errorText(err, '메모를 저장하지 못했습니다. 글은 그대로 있으니 다시 저장해 주세요.'));
    } finally { setSaving(false); }
  }

  function cancel() {
    setDraft(note?.body || '');
    setEditing(false); setError('');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    }
  }

  // 편집 칸 밖으로 포커스가 나가면 저장(같은 상자 안의 [저장]·[취소] 단추로 가는 것은 제외)
  function onBlur(e) {
    if (boxRef.current?.contains(e.relatedTarget)) return;
    save();
  }

  const body = note?.body || '';
  return (
    <section aria-label="나의 메모" className="mt-5 border-t border-n-200 pt-4">
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle>나의 메모</SectionTitle>
        <span className="inline-flex items-center gap-1 text-meta text-n-500" title="다른 사람과 관리자에게도 보이지 않습니다">
          <Lock size={11} aria-hidden="true" />나만 보임
        </span>
        {saved && <span role="status" className="text-meta text-ok">저장됨</span>}
        {!editing && body && (
          <Button variant="ghost" size="sm" className="-my-1 ml-auto" onClick={open} aria-label="메모 고치기">
            <Pencil size={13} aria-hidden="true" />고치기
          </Button>
        )}
      </div>
      {note === null && <p className="text-meta text-n-500">불러오는 중…</p>}
      {note !== null && !editing && !body && (
        <button type="button" onClick={open}
                className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-n-250 px-3 py-2 text-left text-ui text-n-600 transition-colors duration-150 hover:border-n-300 hover:bg-n-50 hover:text-n-900">
          <Plus size={14} aria-hidden="true" />메모 쓰기
          <span className="ml-auto text-meta text-n-500">마크다운</span>
        </button>
      )}
      {note !== null && !editing && body && (
        <>
          {/* 변환된 HTML 은 renderMarkdown 이 DOMPurify 로 거른 것이다 */}
          <div className="md-body max-h-[50vh] overflow-y-auto" data-testid="note-view"
               dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
          <p className="mt-2 flex items-center gap-2 text-meta text-n-500">
            <span className="font-mono">{formatDateTime(note.updated_at)}</span>
            <Link to="/notes" className="ml-auto hover:text-brand hover:underline underline-offset-2">나의 메모 모아 보기</Link>
          </p>
        </>
      )}
      {editing && (
        <div ref={boxRef}>
          <textarea ref={areaRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onBlur={onBlur}
                    aria-label="나의 메모 (마크다운)" rows={8} maxLength={20000}
                    placeholder={'마크다운으로 적습니다.\n## 제목, **굵게**, - 목록, - [ ] 할 일, | 표 |, `코드`, [링크](주소)'}
                    className="field block max-h-[60vh] min-h-32 w-full resize-y rounded-md border border-n-250 bg-n-0 px-2.5 py-2 text-ui text-n-900 placeholder:text-n-500 hover:border-n-300 focus:outline-none" />
          {error && <p role="alert" className="mt-1.5 text-meta text-err">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-meta text-n-500"><kbd className="font-mono">Ctrl</kbd>+<kbd className="font-mono">Enter</kbd> 저장 · 칸을 벗어나도 저장</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={cancel} disabled={saving}>취소</Button>
            <Button variant="primary" size="sm" onClick={save} loading={saving}>저장</Button>
          </div>
        </div>
      )}
    </section>
  );
}
