import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { inputClass } from './Field.jsx';

/**
 * 21 — 프로젝트 입력(자료당 하나). 자유 값 + 이미 쓴 이름 자동완성(`/api/suggest?kind=project`).
 * 같은 이름은 대소문자·공백이 달라도 서버가 기존 이름으로 맞춘다. 비우면 프로젝트를 지운다.
 */
export default function ProjectInput({ value, onChange, disabled = false, label = '프로젝트', placeholder = '프로젝트 이름(없으면 비움)' }) {
  const [options, setOptions] = useState([]);
  const listId = useId();
  const requestRef = useRef(0);
  const text = value || '';

  useEffect(() => {
    const q = text.trim();
    const id = ++requestRef.current;   // 늦게 온 옛 응답은 버린다
    if (!q || disabled) { setOptions([]); return undefined; }
    const t = setTimeout(() => {
      api(`/suggest?kind=project&q=${encodeURIComponent(q)}`)
        .then((rows) => { if (id === requestRef.current) setOptions(rows.filter((r) => r !== q)); })
        .catch(() => { if (id === requestRef.current) setOptions([]); });
    }, 150);
    return () => clearTimeout(t);
  }, [text, disabled]);

  return (
    <>
      <input aria-label={label} className={inputClass()} value={text} disabled={disabled} maxLength={100}
             list={listId} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );
}
