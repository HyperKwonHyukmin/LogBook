import { render, screen } from '@testing-library/react';
import ModelTraits, { defaultFile, representativeModel, traitParts } from './ModelTraits.jsx';
import { familyCounts, structureOf } from '../../lib/insight.js';

// 38 — 모델 특성 줄
const model = (id, counts, extra = {}) => ({ id, kind: 'model', name: `m${id}.bdf`, size: 10,
  model: { state: 'done', counts, bbox: { min: [0, 0, 0], max: [24000, 18200, 9600] } }, ...extra });

test('모델 구성 — 보·판 요소 유무로 빔·판·판+보강재', () => {
  expect(structureOf(familyCounts({ CBEAM: 10, GRID: 5 }))).toBe('beam');
  expect(structureOf(familyCounts({ CQUAD4: 10, CTRIA3: 2 }))).toBe('shell');
  expect(structureOf(familyCounts({ CQUAD4: 1000, CBAR: 3 }))).toBe('stiffened');
  expect(structureOf(familyCounts({ RBE2: 4, CONM2: 1 }))).toBeNull();
});

test('대표 BDF = 변환이 끝난 모델 중 절점이 가장 많은 것', () => {
  const files = [model(1, { GRID: 10, CBEAM: 5 }), model(2, { GRID: 900, CQUAD4: 800 }),
    { id: 3, kind: 'model', model: { state: 'include' } }, { id: 4, kind: 'report' }];
  expect(representativeModel(files).id).toBe(2);
});

test('특성 조각 — 구성·절점·크기·판·선형', () => {
  const entry = {
    files: [model(2, { GRID: 12431, CQUAD4: 800, CBEAM: 40 })],
    revisions: [{ key: 's', items: [{ file_id: 1, display: 'R1', is_latest: false }, { file_id: 2, display: 'R2', is_latest: true }] }],
    hulls: [{ hull_no: '3496', ship_type: '174K LNG' }],
  };
  expect(traitParts(entry).map((p) => p.text)).toEqual(['판+보강재', '절점 12,431', '24,000 × 18,200 × 9,600', 'R2 최신', '174K LNG']);
  render(<ModelTraits entry={entry} />);
  expect(screen.getByLabelText('모델 특성')).toHaveTextContent('판+보강재·절점 12,431');
});

test('모델도 선종도 없으면 그리지 않는다', () => {
  const { container } = render(<ModelTraits entry={{ files: [{ id: 1, kind: 'report' }], hulls: [] }} />);
  expect(container).toBeEmptyDOMElement();
});

test('처음 볼 파일 — 변환된 BDF(최신 판) > 첫 문서 > 첫 파일', () => {
  const report = { id: 9, kind: 'report', name: 'r.pdf' };
  const r0 = model(1, { GRID: 2000, CQUAD4: 10 });
  const r2 = model(2, { GRID: 1500, CQUAD4: 10 });
  const revisions = [{ key: 's', items: [{ file_id: 1, display: 'R0', is_latest: false }, { file_id: 2, display: 'R2', is_latest: true }] }];
  expect(defaultFile({ files: [report, r0, r2], revisions }).id).toBe(2);   // 절점이 적어도 최신 판
  expect(defaultFile({ files: [report, r0, r2] }).id).toBe(1);              // 판 묶음이 없으면 절점 최다
  const queued = { id: 3, kind: 'model', model: { state: 'queued' } };
  expect(defaultFile({ files: [queued, report] }).id).toBe(9);              // 변환 전 BDF 뿐이면 문서
  expect(defaultFile({ files: [queued] }).id).toBe(3);
});
