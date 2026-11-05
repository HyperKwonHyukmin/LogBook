/**
 * 52 — 폴더째 올리기 목록. 올리기 전에 파일을 폴더별로 보여 주고 체크한 것만 보낸다.
 * 서버 규칙(GET /api/uploads/rules): excluded_patterns = 서버가 늘 지우는 임시 파일(목록에 넣지 않고 개수만),
 * skip_by_default = 처음에 체크를 풀어 두는 형식(사람이 체크하면 올라간다).
 */

/** 서버가 못 줄 때 쓰는 값 — backend/app/ingest/rules.py 와 같게 둔다. */
export const FALLBACK_RULES = {
  excluded_patterns: ['~$*', 'thumbs.db', 'desktop.ini', '*.master', '*.dball', '*.scratch', '*.tmp',
    '.ds_store', '._*', '*.crdownload', '*.part'],
  skip_by_default: ['.op2', '.f06', '.xdb', '.h5', '.h3d', '.mvw', '.hwsession', '.pch', '.asm', '.plt', '.obd'],
};

/** fnmatch 의 * 만 쓰는 무늬(대소문자 무시) — 서버 is_excluded 와 같은 판정. */
function globMatch(pattern, name) {
  const re = new RegExp(`^${pattern.toLowerCase().split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(name.toLowerCase());
}

export const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
};
const baseName = (relPath) => relPath.slice(relPath.lastIndexOf('/') + 1);
const dirOf = (relPath) => (relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '');

/** 폴더에서 온 파일이 하나라도 있으면 목록을 띄운다(파일만 몇 개 고른 것은 바로 올린다). */
export const isFolderUpload = (items) => items.some((it) => it.relPath.includes('/'));

/**
 * items [{file, relPath}] → { root, files, junk, groups }
 * files: [{relPath, name, size, ext, dir, skip}] — skip = 처음에 체크를 풀어 둘 형식.
 * groups: [{dir, files}] 폴더 경로 순. junk: 서버가 지울 임시 파일 경로(목록에 넣지 않음).
 * 묶는 단위 기본값은 늘 '폴더 전체를 자료 1건'(2026-11-05 사용자 결정) — 하위 폴더마다 나누기는 사람이 고른다.
 */
export function planFolder(items, rules = FALLBACK_RULES) {
  const skipExts = new Set(rules.skip_by_default || []);
  const patterns = rules.excluded_patterns || [];
  const files = [];
  const junk = [];
  for (const it of items) {
    if (!it.file) continue; // 읽을 수 없는 파일은 올리기가 '건너뜀'으로 알린다
    const name = baseName(it.relPath);
    if (patterns.some((p) => globMatch(p, name))) { junk.push(it.relPath); continue; }
    const ext = extOf(name);
    files.push({ relPath: it.relPath, name, size: it.file.size || 0, ext, dir: dirOf(it.relPath), skip: skipExts.has(ext) });
  }
  const byDir = new Map();
  for (const f of files) {
    if (!byDir.has(f.dir)) byDir.set(f.dir, []);
    byDir.get(f.dir).push(f);
  }
  const groups = [...byDir.keys()].sort((a, b) => a.localeCompare(b, 'ko'))
    .map((dir) => ({ dir, files: byDir.get(dir).sort((a, b) => a.name.localeCompare(b.name, 'ko')) }));

  const tops = new Set(items.map((it) => it.relPath.split('/')[0]));
  const root = tops.size === 1 && items.every((it) => it.relPath.includes('/')) ? [...tops][0] : '';
  return { root, files, junk, groups };
}

/** 처음 체크 상태 — 제외 추천 형식만 푼다. → Set(relPath) */
export const initialChecked = (plan) => new Set(plan.files.filter((f) => !f.skip).map((f) => f.relPath));

/**
 * 체크한 파일로 만들어질 초안 미리보기 — 서버 propose(split_top) 와 같은 규칙.
 * split: 고른 폴더 바로 아래 폴더마다 1건, 그 폴더 바로 아래 낱개는 고른 폴더 이름으로 1건. 아니면 전체 1건.
 * → [{name, count, size}]
 */
export function previewDrafts(plan, checked, split) {
  const chosen = plan.files.filter((f) => checked.has(f.relPath));
  if (!chosen.length) return [];
  const label = (name) => name.replaceAll('_', ' ').trim();
  if (!split || !plan.root) {
    return [{ name: label(plan.root) || `파일 ${chosen.length}개`, count: chosen.length,
      size: chosen.reduce((s, f) => s + f.size, 0) }];
  }
  const out = new Map();
  for (const f of chosen) {
    const parts = f.relPath.split('/');
    const key = parts.length > 2 ? parts[1] : parts[0];
    const cur = out.get(key) || { name: label(key), count: 0, size: 0 };
    cur.count += 1;
    cur.size += f.size;
    out.set(key, cur);
  }
  return [...out.values()];
}

/** 체크하지 않은 제외 추천 형식 요약 — [{ext, count}] 많은 순. */
export function skippedByExt(plan, checked) {
  const counts = new Map();
  for (const f of plan.files) {
    if (f.skip && !checked.has(f.relPath)) counts.set(f.ext, (counts.get(f.ext) || 0) + 1);
  }
  return [...counts.entries()].map(([ext, count]) => ({ ext, count })).sort((a, b) => b.count - a.count);
}
