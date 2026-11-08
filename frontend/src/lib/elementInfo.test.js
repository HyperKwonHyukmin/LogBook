import { buildGeometry } from './modelGeometry.js';
import { sampleModel } from '../test/modelFixtures.js';
import { elementInfo, sectionLabel } from './elementInfo.js';

test('1D 요소 정보', () => {
  const m = sampleModel();
  const info = elementInfo(m, buildGeometry(m), 0);
  expect(info).toEqual({ eid: 10, card: 'CBEAM', pid: 1, section: 'PBEAML L 100x100x10x10', thickness: null,
                         material: 'MAT1 E206000 ν0.3', nodes: [1, 2], length: 1000 });
});

test('쉘 요소 정보', () => {
  const m = sampleModel();
  const info = elementInfo(m, buildGeometry(m), 2);
  expect(info.eid).toBe(20);
  expect(info.card).toBe('CQUAD4');
  expect(info.section).toBe('PSHELL t12');
  expect(info.thickness).toBe(12);
  expect(info.nodes).toEqual([1, 2, 3, 4]);
  expect(info.length).toBeNull();
});

test('CONROD 와 속성 없는 요소', () => {
  const m = sampleModel();
  m.blocks.beam_cards = new Uint8Array([3]);
  m.header.conrods = { 10: { mid: 1, A: 25 } };
  const info = elementInfo(m, buildGeometry(m), 0);
  expect(info.card).toBe('CONROD');
  expect(info.section).toBe('CONROD A25');
  expect(sectionLabel(undefined)).toBe('');
});

test('61 — Abaqus 단면 라벨은 묶음이름·형상·원값', () => {
  expect(sectionLabel({ abaqus: true, card: 'BEAM SECTION', name: 'LINE1', section: 'PIPE', kind: 'BEAM', data: [36.5, 14] }))
    .toBe('LINE1 PIPE 36.5,14');
  expect(sectionLabel({ abaqus: true, card: 'ELSET', name: 'SP', kind: 'ELSET' })).toBe('SP ELSET');
});
