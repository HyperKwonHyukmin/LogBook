/** 파일 목록(rel_path) → 폴더 트리. 폴더 먼저, 같은 층은 이름순. */
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
  const finish = (node) => [...node.children.values()]
    .sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name, 'ko'))
    .map((n) => (n.file ? n : { ...n, children: finish(n) }));
  return finish(root);
}
