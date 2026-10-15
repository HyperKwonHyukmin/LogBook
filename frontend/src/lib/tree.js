/**
 * 파일 순서 순위 — 해석 모델을 맨 위에 둬 목록에서 바로 열어 보게 한다(백엔드 entries.service.file_rank 와 같은 규칙).
 * 0 = 변환 대상 모델(본 BDF, model 정보가 있음) · 1 = 그 밖의 모델 파일(INCLUDE 등) · 2 = 나머지.
 */
export function fileRank(f) {
  if (f.model) return 0;
  return f.kind === 'model' ? 1 : 2;
}

/** rel_path 목록 → 폴더 트리. 같은 단계에서는 모델(을 품은 폴더)이 먼저, 그다음 폴더 먼저·이름순. */
export function buildTree(files) {
  const root = { children: new Map() };
  for (const f of files) {
    const parts = f.rel_path.split('/');
    let node = root;
    parts.slice(0, -1).forEach((part, i) => {
      if (!node.children.has(`d:${part}`)) {
        node.children.set(`d:${part}`, { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map() });
      }
      node = node.children.get(`d:${part}`);
    });
    node.children.set(`f:${f.id}`, { name: parts[parts.length - 1], path: f.rel_path, file: f });
  }
  // 폴더의 순위 = 안에 든 파일 중 가장 높은 순위
  const rankOf = (n) => (n.file ? fileRank(n.file) : Math.min(...[...n.children.values()].map(rankOf)));
  const finish = (node) => [...node.children.values()]
    .map((n) => ({ n, rank: rankOf(n) }))
    .sort((a, b) => a.rank - b.rank || (a.n.file ? 1 : 0) - (b.n.file ? 1 : 0) || a.n.name.localeCompare(b.n.name, 'ko'))
    .map(({ n }) => (n.file ? n : { ...n, children: finish(n) }));
  return finish(root);
}
