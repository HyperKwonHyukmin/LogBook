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
