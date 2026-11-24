import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { apiBlob } from '../../api/client.js';
import Button from '../ui/Button.jsx';

/** 받은 Blob 을 파일로 저장(인증 머리가 필요한 GET 이라 링크 대신). */
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 과제 엑셀 양식 내려받기(2026-11-24) — 팀 통합과제 엑셀이 없어도 과제 엑셀로 초안 만들기(68)를 해 볼 수 있게.
 * 양식은 서버가 올해 연도와 지금 분류 목록으로 만든다(GET /api/batches/task-template).
 */
export default function TaskTemplateButton({ variant = 'ghost', size = 'sm', className = '' }) {
  const [state, setState] = useState('');   // '' | 'busy' | 'fail'
  async function onClick() {
    setState('busy');
    try {
      saveBlob(await apiBlob('/batches/task-template'), `과제엑셀_양식_${new Date().getFullYear()}.xlsx`);
      setState('');
    } catch {
      setState('fail');
      setTimeout(() => setState(''), 2500);
    }
  }
  return (
    <Button variant={variant} size={size} className={className} loading={state === 'busy'} onClick={onClick}
            title="한 줄에 과제 하나씩 적어 이 화면에 올리면 과제마다 초안이 생깁니다">
      <FileSpreadsheet size={14} aria-hidden="true" />{state === 'fail' ? '양식을 받지 못했습니다' : '과제 엑셀 양식'}
    </Button>
  );
}
