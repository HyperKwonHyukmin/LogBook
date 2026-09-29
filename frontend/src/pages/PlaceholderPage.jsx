import { Anchor, Search, Tag } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState.jsx';

const PAGES = {
  search: { icon: Search, title: '검색', body: '호선·제목·보고서 본문 검색은 03 단계에서 제공됩니다.' },
  hulls: { icon: Anchor, title: '호선', body: '호선별 해석 타임라인은 03 단계에서 제공됩니다.' },
  tags: { icon: Tag, title: '태그', body: '태그·동의어 관리는 03 단계에서 제공됩니다.' },
};

export default function PlaceholderPage({ kind }) {
  const p = PAGES[kind];
  return <EmptyState icon={p.icon} title={p.title}>{p.body}</EmptyState>;
}
