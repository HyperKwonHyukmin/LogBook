import { ArrowLeft } from 'lucide-react';
import Button from './Button.jsx';
import { useGoBack } from '../../lib/useGoBack.js';

/** 상세 화면 머리의 '이전 화면' 단추 — 앱 안 이전 화면이 없으면 fallback(기본 검색)으로. */
export default function BackButton({ fallback = '/', className = '' }) {
  const goBack = useGoBack(fallback);
  return (
    <Button variant="ghost" size="icon-sm" onClick={goBack} aria-label="이전 화면" title="이전 화면 (마우스 뒤로 버튼)"
            className={className}>
      <ArrowLeft size={16} aria-hidden="true" />
    </Button>
  );
}
