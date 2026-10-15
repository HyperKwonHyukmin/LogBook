import { buildTree } from './tree.js';

test('rel_path 를 폴더 트리로 — 폴더 먼저, 이름순', () => {
  const files = [{ id: 1, rel_path: 'b.pdf' }, { id: 2, rel_path: 'model/m.bdf' }, { id: 3, rel_path: 'model/inc/x.bdf' },
                 { id: 4, rel_path: 'a.pdf' }];
  const t = buildTree(files);
  expect(t.map((n) => n.name)).toEqual(['model', 'a.pdf', 'b.pdf']);
  expect(t[0].children.map((n) => n.name)).toEqual(['inc', 'm.bdf']);
  expect(t[0].children[0].children[0].file.id).toBe(3);
  expect(t[0].path).toBe('model');
});

test('해석 모델이 맨 위 — 변환 모델 > 다른 모델 파일 > 나머지, 모델을 품은 폴더도 먼저', () => {
  const files = [{ id: 1, rel_path: 'a_report.pdf', kind: 'report' },
                 { id: 2, rel_path: 'docs/memo.docx', kind: 'report' },
                 { id: 3, rel_path: 'b_part.dat', kind: 'model' },
                 { id: 4, rel_path: 'z_main.bdf', kind: 'model', model: { state: 'done' } },
                 { id: 5, rel_path: 'run/sub.bdf', kind: 'model', model: { state: 'done' } }];
  const t = buildTree(files);
  expect(t.map((n) => n.name)).toEqual(['run', 'z_main.bdf', 'b_part.dat', 'docs', 'a_report.pdf']);
  expect(t[0].children.map((n) => n.name)).toEqual(['sub.bdf']);
});
